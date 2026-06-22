// Railway guided-install e2e guard (non-dry-run, fully self-contained).
//
// Unlike interactive.mjs (which runs --dry-run and stops before apply), this drives
// the REAL apply path for the Railway provider end-to-end — without a real Railway
// account or any cost — by stubbing two boundaries:
//   - a fake `railway` CLI on PATH (returns canned whoami/deploy/domain/variable)
//   - the mock AutoMem server (so /health + authed /recall actually pass verify)
//
// It runs in a throwaway HOME + cwd with AUTOMEM_* and RAILWAY_* stripped, so it
// never touches real config, real Railway auth, or reads a real .env.
//
// Scope: this exercises the BROWSER FALLBACK apply path. The installer first tries the
// terminal fast path (railway init → status → GraphQL templateDeployV2), but the
// throwaway HOME has no CLI token, so the provider falls back to the browser flow this
// fake drives. The fast path's GraphQL deploy is covered by unit tests
// (src/cli/cloud/railway-api.test.ts, railway.test.ts), where network and CLI
// boundaries are injected directly.
//
//   node tests/e2e/railway-guided-install.mjs           # quiet: prints pass/FAIL
//   node tests/e2e/railway-guided-install.mjs --watch   # stream installer UI
//   (build first: npm run build)

import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-automem.mjs';

const DIST = path.resolve(fileURLToPath(new URL('../../dist/index.js', import.meta.url)));
if (!existsSync(DIST)) {
  console.error(`FATAL: ${DIST} missing — run \`npm run build\` first.`);
  process.exit(2);
}

function ensureSpawnHelperExecutable() {
  if (process.platform === 'win32') return;
  const helper = path.resolve(
    fileURLToPath(new URL('../../node_modules/node-pty/prebuilds/', import.meta.url)),
    `${process.platform}-${process.arch}`,
    'spawn-helper'
  );
  try {
    if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755);
  } catch {
    /* best effort */
  }
}
ensureSpawnHelperExecutable();

let spawn;
try {
  ({ spawn } = await import('node-pty'));
} catch (err) {
  console.error(`FATAL: node-pty not available (${err.message}). Run \`npm install\`.`);
  process.exit(2);
}

const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const strip = (s) => s.replace(ANSI, '');
const KEY = { enter: '\r' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = 'railway-guard-token';
const WATCH = process.argv.includes('--watch') || process.env.RAILWAY_GUARD_WATCH === '1';

// A fake `railway` CLI. `--version` answers the installer's CLI-presence probe so it
// treats the CLI as installed. The installer then
// tries the terminal fast path (init → status → GraphQL deploy); with no token in the
// throwaway HOME, readAccessToken returns undefined, so the provider falls back to the
// browser flow this fake supports (login/link) — and domain/variable hand back the
// LOCAL mock URL + token so verify passes. init/status are still answered so the fast
// path reaches the (token) failure point that triggers the fallback rather than
// erroring early.
function writeFakeRailway(binDir, mockUrl) {
  const script = `#!/usr/bin/env bash
case "$1 $2" in
  "--version"*)        echo "railway 3.x (fake)";;
  "whoami "*)          echo '{"name":"guard","workspaces":[{"id":"ws-guard","name":"Guard"}]}';;
  "login "*|"login ")  echo "Logged in (fake)";;
  "init "*)            echo '{"id":"proj-guard","name":"automem"}';;
  "status "*|"status") echo '{"id":"proj-guard","environments":{"edges":[{"node":{"id":"env-guard","name":"production"}}]}}';;
  "link "*|"link ")    echo "Linked (fake)";;
  "domain "*)          echo '{"domain":"${mockUrl}"}';;
  "variable list"*)    echo '{"AUTOMEM_API_TOKEN":"${TOKEN}"}';;
  *) echo "{}";;
esac
exit 0
`;
  const file = path.join(binDir, 'railway');
  writeFileSync(file, script, { mode: 0o755 });
}

async function run() {
  const mock = await createMock({ mode: 'healthy', expectToken: TOKEN });
  const home = mkdtempSync(path.join(os.tmpdir(), 'automem-railway-guard-home-'));
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'automem-railway-guard-cwd-'));
  const bin = path.join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFakeRailway(bin, mock.url); // mock.url is http://127.0.0.1:PORT (scheme kept as-is)

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    CI: '1',
    FORCE_COLOR: '1',
  };
  for (const k of Object.keys(env)) {
    if (k.startsWith('AUTOMEM_') || k.startsWith('RAILWAY_')) delete env[k];
  }
  env.AUTOMEM_NO_ANIM = '1';
  env.AUTOMEM_NO_BROWSER = '1'; // never pop a real browser for the Deploy-Now hand-off

  const term = spawn(
    process.execPath,
    [DIST, 'install', '--target', 'cloud', '--cloud-provider', 'railway', '--no-agent-install', '--yes'],
    { name: 'xterm-color', cols: 100, rows: 40, cwd, env }
  );

  if (WATCH) {
    process.stdout.write(
      `\n[railway-guard] Running the real installer against a fake railway CLI + mock AutoMem (${mock.url}).\n` +
        `[railway-guard] Auto-answering: confirm the deferred deploy, then confirm it's live.\n\n`
    );
  }
  let buf = '';
  term.onData((d) => {
    buf += d;
    if (WATCH) process.stdout.write(d);
  });
  let exitCode = null;
  const exited = new Promise((res) => term.onExit(({ exitCode: c }) => {
    exitCode = c;
    res();
  }));

  const waitFor = async (re, timeout = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (re.test(strip(buf))) return true;
      await sleep(40);
    }
    return false;
  };

  try {
    // Apply runs because --yes skips the plan approval; drive the two apply prompts.
    if (await waitFor(/Continue\?|billing is deferred/)) {
      await sleep(120);
      term.write(KEY.enter); // confirm the (deferred-billing) deploy
    }
    if (await waitFor(/deploy live on Railway|finished deploying/)) {
      await sleep(120);
      term.write(KEY.enter); // confirm the browser deploy is live → link + capture
    }
    await Promise.race([exited, sleep(15000)]);

    const out = strip(buf);
    const healthHit = mock.requests.some((r) => r.path === '/health');
    const recallAuthed = mock.requests.some((r) => r.path === '/recall' && r.token === TOKEN);
    const checks = [
      ['exited cleanly', exitCode === 0],
      ['verified endpoint', /Endpoint verified|Verify endpoint/.test(out) && !/Couldn't verify/.test(out)],
      ['wrote .env', /Wrote /.test(out)],
      ['mock got /health', healthHit],
      ['mock got authed /recall', recallAuthed],
    ];
    const failed = checks.filter(([, ok]) => !ok);
    return { ok: failed.length === 0, failed: failed.map(([n]) => n), out, exitCode };
  } finally {
    try {
      term.kill();
    } catch {
      /* already exited */
    }
    await mock.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

const result = await run();
if (result.ok) {
  console.log('▶ railway guided install (mock) … pass');
  process.exit(0);
} else {
  console.log('▶ railway guided install (mock) … FAIL');
  console.log(`   failed checks: ${result.failed.join(' | ')}`);
  console.log(`   exit: ${result.exitCode}`);
  console.log(`   tail:\n${strip(result.out).split('\n').slice(-25).map((l) => '     ' + l).join('\n')}`);
  process.exit(1);
}

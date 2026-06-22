// Railway guided-install DEMO + e2e guard (non-dry-run, fully self-contained).
//
// Unlike interactive.mjs (which runs --dry-run and stops before apply), this drives
// the REAL apply path for the Railway provider end-to-end — without a real Railway
// account or any cost — by stubbing two boundaries:
//   - a fake `railway` CLI on PATH (returns canned whoami/deploy/domain/variable)
//   - the mock AutoMem server (so /health + authed /recall actually pass verify)
//
// It runs in a throwaway HOME + cwd with AUTOMEM_* stripped, so it never touches
// your real config or reads your real .env. Use it to WATCH the flow go green, and
// as a CI guard for the interactive apply path.
//
//   node tests/e2e/demo-railway.mjs           # quiet (CI): just prints pass/FAIL
//   node tests/e2e/demo-railway.mjs --watch   # streams the live installer UI so you
//                                             # can WATCH the flow go green
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

const TOKEN = 'demo-railway-token';
const WATCH = process.argv.includes('--watch') || process.env.DEMO_WATCH === '1';

// A fake `railway` CLI: whoami succeeds (skip login), deploy/poll succeed, and
// domain/variable hand back the LOCAL mock URL + token so verify passes.
function writeFakeRailway(binDir, mockUrl) {
  const script = `#!/usr/bin/env bash
case "$1 $2" in
  "whoami "*)         echo '{"name":"demo"}';;
  "login "*|"login ") echo "Logged in (fake)";;
  "init "*)           echo '{}';;
  "deploy "*)         echo '{}';;
  "deployment list"*) echo '[{"status":"SUCCESS"}]';;
  "domain "*)         echo '{"domain":"${mockUrl}"}';;
  "variable list"*)   echo '{"AUTOMEM_API_TOKEN":"${TOKEN}"}';;
  *) echo "{}";;
esac
exit 0
`;
  const file = path.join(binDir, 'railway');
  writeFileSync(file, script, { mode: 0o755 });
}

async function run() {
  const mock = await createMock({ mode: 'healthy', expectToken: TOKEN });
  const home = mkdtempSync(path.join(os.tmpdir(), 'automem-demo-home-'));
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'automem-demo-cwd-'));
  const bin = path.join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFakeRailway(bin, mock.url); // mock.url is http://127.0.0.1:PORT (scheme kept as-is)

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    CI: '1',
    AUTOMEM_NO_ANIM: '1',
    FORCE_COLOR: '1',
  };
  for (const k of ['AUTOMEM_API_URL', 'AUTOMEM_ENDPOINT', 'AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN']) delete env[k];

  const term = spawn(
    process.execPath,
    [DIST, 'install', '--target', 'cloud', '--cloud-provider', 'railway', '--no-agent-install', '--yes'],
    { name: 'xterm-color', cols: 100, rows: 40, cwd, env }
  );

  if (WATCH) {
    process.stdout.write(
      `\n[demo] Running the real installer against a fake railway CLI + mock AutoMem (${mock.url}).\n` +
        `[demo] Auto-answering: blank embedding key, then confirm the deploy.\n\n`
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
    if (await waitFor(/Embedding provider API key/)) {
      await sleep(120);
      term.write(KEY.enter); // blank → FastEmbed
    }
    if (await waitFor(/Continue\?|billing is deferred/)) {
      await sleep(120);
      term.write(KEY.enter); // confirm the (deferred-billing) deploy
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

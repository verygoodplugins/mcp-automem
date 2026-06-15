// AutoMem installer — INTERACTIVE route harness.
//
// The scenario matrix in harness.mjs drives the headless (--yes / flags) path and
// never exercises the actual prompts. This harness spawns the real installer in a
// PTY (so prompts get a TTY), drives each route by sending keystrokes, and asserts
// the rendered plan — catching prompt-flow / rendering regressions before review.
//
// Every scenario runs `install --dry-run` in a throwaway HOME + cwd, so nothing is
// written and no Docker/agent side effects occur (dry-run short-circuits before
// any write). CI=1 disables the splash + reveal animation for deterministic output;
// the prompts themselves depend on the TTY, not CI, so they still run.
//
// Usage:
//   node tests/e2e/interactive.mjs            # all routes
//   node tests/e2e/interactive.mjs claude     # filter by name substring
//
// Requires a build first (uses dist/index.js) and node-pty (devDependency).

import { chmodSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(fileURLToPath(new URL('../../dist/index.js', import.meta.url)));
if (!existsSync(DIST)) {
  console.error(`FATAL: ${DIST} missing — run \`npm run build\` first.`);
  process.exit(2);
}

// node-pty's prebuilt macOS/Linux spawn-helper sometimes lands without its
// executable bit after install, which makes pty.fork throw "posix_spawnp failed".
// Restore it here so the harness survives a fresh `npm install`.
function ensureSpawnHelperExecutable() {
  if (process.platform === 'win32') return;
  const helper = path.resolve(
    fileURLToPath(new URL('../../node_modules/node-pty/prebuilds/', import.meta.url)),
    `${process.platform}-${process.arch}`,
    'spawn-helper'
  );
  try {
    if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) {
      chmodSync(helper, 0o755);
    }
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
const KEY = { enter: '\r', down: '\x1B[B', up: '\x1B[A', space: ' ' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENDPOINT = 'http://127.0.0.1:8001';

const SCENARIOS = [
  {
    name: 'existing-cursor',
    description: 'existing endpoint, full interactive: target select → URL → key → agents (cursor)',
    steps: [
      { waitFor: /Where should AutoMem run/, send: KEY.down }, // cloud → local
      { send: KEY.down }, // local → existing
      { send: KEY.enter },
      { waitFor: /AutoMem API URL/, send: ENDPOINT },
      { send: KEY.enter },
      { waitFor: /AutoMem API key/, send: KEY.enter }, // blank
      { waitFor: /which agents/, send: KEY.down }, // codex → claude-code
      { send: KEY.down }, // claude-code → cursor
      { send: KEY.space }, // check cursor
      { send: KEY.enter },
    ],
    expect: [/Install review/, /Cursor integration/, /Dry run only/],
    notExpect: [/mcp\.json/, /AutoMem install canceled/],
  },
  {
    name: 'existing-claude-plugin',
    description: 'existing + Claude Code → plugin sub-prompt (manual step, no settings write)',
    steps: [
      { waitFor: /Where should AutoMem run/, send: KEY.down },
      { send: KEY.down },
      { send: KEY.enter },
      { waitFor: /AutoMem API URL/, send: ENDPOINT },
      { send: KEY.enter },
      { waitFor: /AutoMem API key/, send: KEY.enter },
      { waitFor: /which agents/, send: KEY.down }, // codex → claude-code
      { send: KEY.space }, // check claude-code
      { send: KEY.enter },
      { waitFor: /integrate with Claude Code/, send: KEY.enter }, // plugin (default)
    ],
    expect: [/Install the Claude Code plugin/, /\/plugin install automem@verygoodplugins-mcp-automem/, /Dry run only/],
    notExpect: [/settings\.json/],
  },
  {
    name: 'existing-claude-settings',
    description: 'existing + Claude Code → settings sub-prompt (writes settings.json)',
    steps: [
      { waitFor: /Where should AutoMem run/, send: KEY.down },
      { send: KEY.down },
      { send: KEY.enter },
      { waitFor: /AutoMem API URL/, send: ENDPOINT },
      { send: KEY.enter },
      { waitFor: /AutoMem API key/, send: KEY.enter },
      { waitFor: /which agents/, send: KEY.down },
      { send: KEY.space },
      { send: KEY.enter },
      { waitFor: /integrate with Claude Code/, send: KEY.down }, // plugin → settings
      { send: KEY.enter },
    ],
    expect: [/Install Claude Code integration/, /settings\.json/, /Dry run only/],
    notExpect: [/Install the Claude Code plugin/],
  },
  {
    name: 'cloud',
    description: 'hosted cloud: shows the hosted note, then URL → key → no agents',
    steps: [
      { waitFor: /Where should AutoMem run/, send: KEY.enter }, // cloud (default)
      { waitFor: /AutoMem API URL/, send: ENDPOINT },
      { send: KEY.enter },
      { waitFor: /AutoMem API key/, send: KEY.enter },
      { waitFor: /which agents/, send: KEY.enter }, // none selected
    ],
    expect: [/Hosted setup/, /Install review/, /mode\s+cloud/, /Dry run only/],
    notExpect: [/AutoMem install canceled/],
  },
  {
    name: 'local',
    description: 'local docker: target → dir prompt → no agents (dry-run, no docker)',
    steps: [
      { waitFor: /Where should AutoMem run/, send: KEY.down }, // cloud → local
      { send: KEY.enter },
      { waitFor: /Local AutoMem server directory/, send: KEY.enter }, // accept default
      { waitFor: /which agents/, send: KEY.enter }, // none
    ],
    expect: [/Prepare local AutoMem server/, /mode\s+local/, /Dry run only/],
    notExpect: [/AutoMem install canceled/],
  },
];

async function run(scenario) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'automem-itest-home-'));
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'automem-itest-cwd-'));
  const env = { ...process.env, HOME: home, CI: '1', AUTOMEM_NO_ANIM: '1', FORCE_COLOR: '1' };
  delete env.NO_COLOR;
  delete env.CLAUDE_CODE;
  delete env.CODEX;

  const term = spawn(process.execPath, [DIST, 'install', '--dry-run'], {
    name: 'xterm-color',
    cols: 100,
    rows: 40,
    cwd,
    env,
  });

  let buf = '';
  term.onData((d) => {
    buf += d;
  });
  let exitCode = null;
  const exited = new Promise((res) => term.onExit(({ exitCode: c }) => {
    exitCode = c;
    res();
  }));

  const waitFor = async (re, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (re.test(strip(buf))) return;
      await sleep(40);
    }
    throw new Error(`timeout waiting for ${re}`);
  };

  try {
    for (const step of scenario.steps) {
      if (step.waitFor) await waitFor(step.waitFor);
      if (step.send !== undefined) {
        await sleep(90);
        term.write(step.send);
      }
    }
    await Promise.race([exited, sleep(10000)]);
    const out = strip(buf);
    const missing = (scenario.expect || []).filter((re) => !re.test(out));
    const unexpected = (scenario.notExpect || []).filter((re) => re.test(out));
    const ok = missing.length === 0 && unexpected.length === 0 && (exitCode === 0 || exitCode === null);
    return {
      name: scenario.name,
      ok,
      exitCode,
      missing: missing.map((r) => r.source),
      unexpected: unexpected.map((r) => r.source),
      tail: ok ? '' : out.slice(-700),
    };
  } finally {
    try {
      term.kill();
    } catch {
      /* already exited */
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

const filter = process.argv[2];
const selected = filter ? SCENARIOS.filter((s) => s.name.includes(filter)) : SCENARIOS;
let passed = 0;
let failed = 0;

for (const scenario of selected) {
  process.stdout.write(`▶ ${scenario.name} … `);
  let result;
  try {
    result = await run(scenario);
  } catch (err) {
    result = { name: scenario.name, ok: false, missing: [String(err.message)], unexpected: [], tail: '' };
  }
  if (result.ok) {
    passed += 1;
    console.log('pass');
  } else {
    failed += 1;
    console.log('FAIL');
    if (result.missing.length) console.log(`   missing: ${result.missing.join(' | ')}`);
    if (result.unexpected.length) console.log(`   unexpected: ${result.unexpected.join(' | ')}`);
    if (result.exitCode != null && result.exitCode !== 0) console.log(`   exit: ${result.exitCode}`);
    if (result.tail) console.log(`   tail:\n${result.tail.split('\n').map((l) => '     ' + l).join('\n')}`);
  }
}

console.log(`\nInteractive routes: ${selected.length}  passed: ${passed}  failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);

// Real installer + PTY, with isolated HOME, mock AutoMem and fake host launchers.
// No actual assistant session, clipboard, Cursor app, or user config is touched.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-automem.mjs';

const dist = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const { WELCOME_PROMPT } = await import('../../dist/cli/welcome.js');
const helper = fileURLToPath(
  new URL(
    `../../node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`,
    import.meta.url
  )
);
if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
const { spawn } = await import('node-pty');
const strip = (s) =>
  s
    .replace(/\x1B](?:[^\x07\x1B]|\x1B(?!\\))*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOKEN = 'welcome-test-token';
const runFile = promisify(execFile);

async function printWelcome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-welcome-print-'));
  try {
    const env = { PATH: process.env.PATH, HOME: root, NO_COLOR: '1', TERM: 'dumb' };
    for (const args of [
      ['welcome', '--print'],
      ['welcome', '--client', 'cursor'],
    ]) {
      const { stdout, stderr } = await runFile(process.execPath, [dist, ...args], {
        cwd: root,
        env,
        timeout: 10_000,
      });
      assert.equal(stdout, `${WELCOME_PROMPT}\n`);
      assert.equal(stderr, '');
    }
    assert.deepEqual(fs.readdirSync(root), []);
    console.log('welcome command (print) … pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function scenario(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-welcome-e2e-'));
  const home = path.join(root, 'home'),
    cwd = path.join(root, 'project'),
    bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  fs.mkdirSync(bin);
  const openLog = path.join(root, 'opened');
  const codexLog = path.join(root, 'codex-args');
  const clipboardLog = path.join(root, 'clipboard');
  fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\nprintf "%s" "$1" > "$FAKE_OPEN_LOG"\n', {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(bin, 'xdg-open'), '#!/bin/sh\nprintf "%s" "$1" > "$FAKE_OPEN_LOG"\n', {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(bin, 'pbcopy'), '#!/bin/sh\ncat > "$FAKE_CLIPBOARD_LOG"\n', {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(bin, 'wl-copy'), '#!/bin/sh\ncat > "$FAKE_CLIPBOARD_LOG"\n', {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(bin, 'codex'),
    `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === '--version') process.exit(0);
fs.writeFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({
  args: process.argv.slice(2),
  hasApiKey: Boolean(process.env.AUTOMEM_API_KEY || process.env.AUTOMEM_API_TOKEN),
}));
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const api = await createMock({ expectToken: TOKEN });
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: os.tmpdir(),
    TERM: 'xterm-color',
    NO_COLOR: '1',
    AUTOMEM_NO_ANIM: '1',
    CI: '1',
    FAKE_OPEN_LOG: openLog,
    FAKE_CODEX_LOG: codexLog,
    FAKE_CLIPBOARD_LOG: clipboardLog,
  };
  const client = kind === 'codex' ? 'codex' : 'cursor';
  if (kind === 'codex') env.AUTOMEM_API_KEY = 'unrelated-ambient-test-key';
  const args = [
    dist,
    'install',
    '--target',
    'existing',
    '--endpoint',
    api.url,
    '--api-key',
    TOKEN,
    '--clients',
    client,
  ];
  if (client === 'cursor') args.push('--cursor-mode', 'plugin');
  if (kind === 'no-welcome') args.push('--no-welcome');
  let term;
  let output = '';
  let exitCode;
  try {
    if (kind === 'headless') {
      ({ stdout: output } = await runFile(process.execPath, [...args, '--yes'], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 20_000,
      }));
      assert.doesNotMatch(output, /Start the AutoMem welcome conversation/);
      assert.equal(fs.existsSync(openLog), false);
      assert.equal(fs.existsSync(codexLog), false);
      assert.equal(fs.existsSync(clipboardLog), false);
      console.log('welcome guided install (headless) … pass');
      return;
    }
    term = spawn(process.execPath, args, { name: 'xterm-color', cols: 150, rows: 50, cwd, env });
    term.onData((data) => {
      output += data;
      if (process.argv.includes('--watch')) process.stdout.write(data);
    });
    const exited = new Promise((resolve) =>
      term.onExit(({ exitCode: code }) => {
        exitCode = code;
        resolve();
      })
    );
    async function waitFor(pattern, timeout = 20_000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (pattern.test(strip(output))) return;
        if (exitCode !== undefined) throw new Error(`Exit ${exitCode} before ${pattern}`);
        await sleep(40);
      }
      throw new Error(`Timed out waiting for ${pattern}`);
    }
    await waitFor(/Apply this AutoMem install plan/);
    await sleep(150);
    term.write('y\r');
    if (kind !== 'no-welcome') {
      await waitFor(/Start the AutoMem welcome conversation/);
      await sleep(150);
      if (kind === 'cancel') {
        term.write('\x03');
      } else {
        if (kind === 'skip') {
          term.write('\x1b[B');
          await sleep(120);
        }
        term.write('\r');
      }
    }
    let timer;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 20_000);
      }),
    ]);
    clearTimeout(timer);
    assert.equal(exitCode, 0);
    const clean = strip(output);
    assert.ok(!clean.includes(TOKEN), 'API key is not printed');
    if (kind === 'cursor') {
      assert.ok(fs.existsSync(openLog), 'Cursor deeplink was opened');
      const url = new URL(fs.readFileSync(openLog, 'utf8'));
      assert.equal(url.protocol, 'cursor:');
      assert.equal(url.searchParams.get('text'), WELCOME_PROMPT);
      assert.equal(url.searchParams.get('workspace'), 'project');
      assert.match(clean, /Review it and press Send/);
    } else if (kind === 'codex') {
      const launch = JSON.parse(fs.readFileSync(codexLog, 'utf8'));
      assert.deepEqual(launch.args, [
        '-c',
        'mcp_optional_startup_grace_ms=0',
        '-c',
        'mcp_servers.memory.startup_timeout_sec=60',
        WELCOME_PROMPT,
      ]);
      assert.equal(launch.hasApiKey, false);
      assert.ok(!launch.args.join(' ').includes(TOKEN));
      const config = fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8');
      assert.match(config, /\[mcp_servers\.memory\]/);
      assert.doesNotMatch(config, new RegExp(TOKEN));
      const connection = JSON.parse(
        fs.readFileSync(path.join(home, '.codex/automem/connection.json'), 'utf8')
      );
      assert.equal(connection.endpoint, api.url);
      assert.equal(connection.apiKey, TOKEN);
      assert.doesNotMatch(clean, /ensure AutoMem is registered/);
    } else {
      assert.equal(fs.existsSync(openLog), false);
      assert.equal(fs.existsSync(codexLog), false);
      assert.equal(fs.existsSync(clipboardLog), false);
      if (kind === 'skip' || kind === 'cancel') assert.match(clean, /Welcome conversation skipped/);
      if (kind === 'cancel') {
        assert.doesNotMatch(clean, /install canceled|no AutoMem files were changed/i);
        assert.ok(
          fs.existsSync(path.join(home, '.cursor/plugins/local/automem/cursor/connection.json')),
          'the completed Cursor installation remains in place'
        );
      }
      if (kind === 'no-welcome')
        assert.doesNotMatch(clean, /Start the AutoMem welcome conversation/);
    }
    console.log(`welcome guided install (${kind}) … pass`);
  } catch (error) {
    console.error(
      `welcome guided install (${kind}) … FAIL: ${error.message}\n${strip(output).slice(-4000)}`
    );
    throw error;
  } finally {
    try {
      term?.kill();
    } catch {
      /* already exited */
    }
    await api.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await printWelcome();
for (const kind of ['cursor', 'skip', 'cancel', 'no-welcome', 'codex', 'headless'])
  await scenario(kind);

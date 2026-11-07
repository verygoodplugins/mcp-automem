import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cursorWelcomeUrl, WELCOME_PROMPT } from '../../src/cli/welcome.js';

const CURSOR_DEEPLINK =
  '/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-deeplink/dist/main.js';

describe.skipIf(!fs.existsSync(CURSOR_DEEPLINK))('installed Cursor welcome deeplink', () => {
  it('passes the complete welcome message through Cursor’s own URI handler into chat prefill', () => {
    // Isolate the installed extension in a child process, with only the VS Code
    // plumbing mocked. It runs Cursor’s real URL parser and safety validator.
    const script = `
const Module = require('node:module');
const original = Module._load;
let handler;
const calls = [];
const vscode = {
  window: { registerUriHandler: (value) => { handler = value; return {}; },
    showErrorMessage: (message) => { throw new Error(message); } },
  commands: { registerCommand: () => ({}), executeCommand: async (...args) => { calls.push(args); } },
  workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/project' } }] },
};
Module._load = function(id, ...rest) { return id === 'vscode' ? vscode : original.call(this, id, ...rest); };
const extension = require(${JSON.stringify(CURSOR_DEEPLINK)});
(async () => {
  await extension.activate({ subscriptions: [] });
  const url = new URL(process.argv[1]);
  await handler.handleUri({ path: url.pathname, query: url.search.slice(1), toString: () => url.toString() });
  process.stdout.write(JSON.stringify(calls));
})().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
`;
    const result = spawnSync(process.execPath, ['-e', script, cursorWelcomeUrl('/tmp/project')], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { PATH: process.env.PATH, HOME: '/tmp' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      ['deeplink.prompt.prefill', { text: WELCOME_PROMPT }],
    ]);
  });
});

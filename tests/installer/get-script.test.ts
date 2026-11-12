import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../../get.sh');
let bin: string;

beforeEach(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-get-'));
});
afterEach(() => fs.rmSync(bin, { recursive: true, force: true }));

function stub(name: string, body: string) {
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function run(args: string[], pathDirs: string[]) {
  return spawnSync('/bin/sh', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: pathDirs.join(':') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('get.sh bootstrap', () => {
  it('is valid POSIX sh', () => {
    expect(spawnSync('/bin/sh', ['-n', SCRIPT]).status).toBe(0);
  });

  it('hands over to the guided installer and forwards arguments', () => {
    stub('npx', 'echo "npx $*"');
    const result = run(['--dry-run'], [bin, path.dirname(process.execPath)]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      'npx -y @verygoodplugins/mcp-automem@latest install --dry-run'
    );
  });

  it('stops with a plain explanation when Node.js is missing', () => {
    const result = run([], [bin]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('needs Node.js');
    expect(result.stderr).toContain('https://nodejs.org');
  });
});

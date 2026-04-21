import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const HELPER_PATH = path.resolve(__dirname, '../../templates/claude-code/scripts/python-command.sh');
const BASH_PATH = '/bin/bash';

function makeExecutable(dir: string, name: string, body: string) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `#!/bin/sh\n${body}\n`, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function runHelper(pathDir: string, command: string) {
  return spawnSync(
    BASH_PATH,
    ['-c', `source "${HELPER_PATH}"; ${command}`],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: pathDir,
      },
    }
  );
}

describe('python-command.sh', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  function createBinDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-python-helper-'));
    tempDirs.push(dir);
    return dir;
  }

  it('prefers python3 when available', () => {
    const dir = createBinDir();
    makeExecutable(dir, 'python3', 'printf "python3:%s\\n" "$*"');
    makeExecutable(dir, 'python', 'printf "python:%s\\n" "$*"');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).toBe(0);
    expect(label.stdout.trim()).toBe('python3');
  });

  it('falls back to python when python3 is unavailable', () => {
    const dir = createBinDir();
    makeExecutable(dir, 'python', 'printf "python:%s\\n" "$*"');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).toBe(0);
    expect(label.stdout.trim()).toBe('python');
  });

  it('uses py -3 when only the Windows launcher is available', () => {
    const dir = createBinDir();
    makeExecutable(dir, 'py', 'printf "py:%s\\n" "$*"');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).toBe(0);
    expect(label.stdout.trim()).toBe('py -3');

    const run = runHelper(dir, 'automem_run_python --version');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('py:-3 --version');
  });

  it('fails cleanly when no supported interpreter is available', () => {
    const dir = createBinDir();

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).not.toBe(0);
    expect(label.stdout.trim()).toBe('');
  });
});

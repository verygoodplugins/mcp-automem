import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const HELPER_PATH = path.resolve(__dirname, '../../templates/claude-code/scripts/python-command.sh');

// These tests require a Unix-like environment with bash (Linux/macOS/WSL/Git Bash).
function resolveBash(): string {
  const result = spawnSync('which', ['bash'], { encoding: 'utf8' });
  return result.stdout.trim() || '/bin/bash';
}

const BASH_PATH = resolveBash();

function makeExecutable(dir: string, name: string, body: string) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `#!/bin/sh\n${body}\n`, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

// Fake that passes automem_is_python3 (exits 0 on any invocation).
function makePython3Stub(dir: string, name: string) {
  makeExecutable(dir, name, 'exit 0');
}

// Fake that fails automem_is_python3 (exits 1 for any -c invocation, simulating Python 2).
function makePython2Stub(dir: string, name: string) {
  makeExecutable(dir, name, 'case "$1" in -c) exit 1 ;; esac; exit 0');
}

// Fake that always exits 1, shadowing any same-named system binary via PATH prepend.
function blockInterpreter(dir: string, name: string) {
  makeExecutable(dir, name, 'exit 1');
}

function runHelper(pathDir: string, command: string) {
  return spawnSync(
    BASH_PATH,
    ['-c', `source "${HELPER_PATH}"; ${command}`],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // Prepend the temp dir so our stubs shadow any system interpreters with the same name.
        PATH: pathDir + path.delimiter + (process.env.PATH || ''),
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
    makePython3Stub(dir, 'python3');
    makePython3Stub(dir, 'python');
    blockInterpreter(dir, 'py');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).toBe(0);
    expect(label.stdout.trim()).toBe('python3');
  });

  it('falls back to python when python3 is unavailable', () => {
    const dir = createBinDir();
    blockInterpreter(dir, 'python3');
    blockInterpreter(dir, 'py');
    makePython3Stub(dir, 'python');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).toBe(0);
    expect(label.stdout.trim()).toBe('python');
  });

  it('uses py -3 when only the Windows launcher is available', () => {
    const dir = createBinDir();
    blockInterpreter(dir, 'python3');
    // py stub must echo its arguments so automem_run_python output can be verified.
    makeExecutable(dir, 'py', 'printf "py:%s\\n" "$*"');
    blockInterpreter(dir, 'python');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).toBe(0);
    expect(label.stdout.trim()).toBe('py -3');

    const run = runHelper(dir, 'automem_run_python --version');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('py:-3 --version');
  });

  it('prefers py -3 over a python that is Python 2', () => {
    const dir = createBinDir();
    blockInterpreter(dir, 'python3');
    makePython3Stub(dir, 'py');
    makePython2Stub(dir, 'python');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).toBe(0);
    expect(label.stdout.trim()).toBe('py -3');
  });

  it('skips python when it fails the Python 3 version check', () => {
    const dir = createBinDir();
    blockInterpreter(dir, 'python3');
    blockInterpreter(dir, 'py');
    makePython2Stub(dir, 'python');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).not.toBe(0);
    expect(label.stdout.trim()).toBe('');
  });

  it('fails cleanly when no supported interpreter is available', () => {
    const dir = createBinDir();
    blockInterpreter(dir, 'python3');
    blockInterpreter(dir, 'py');
    blockInterpreter(dir, 'python');

    const label = runHelper(dir, 'automem_python_label');
    expect(label.status).not.toBe(0);
    expect(label.stdout.trim()).toBe('');
  });
});

/**
 * Copilot Uninstall Tests (US3: T025-T029)
 * Tests for uninstall copilot command behavior.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const CLI_PATH = path.resolve(__dirname, '../dist/index.js');

function createTempCopilotDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-uninstall-test-'));
  const hooksDir = path.join(dir, 'hooks');
  const scriptsDir = path.join(dir, 'scripts');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  return dir;
}

function installFakeHooks(dir: string) {
  const hooksDir = path.join(dir, 'hooks');
  const scriptsDir = path.join(dir, 'scripts');

  // Hook JSON files
  for (const hook of ['automem-session-start.json', 'automem-session-end.json', 'automem-build.json']) {
    fs.writeFileSync(path.join(hooksDir, hook), '{"version":1,"hooks":{}}', 'utf8');
  }

  // Support scripts
  for (const script of ['capture-build-result.sh', 'capture-build-result.ps1', 'session-memory.sh', 'session-memory.ps1', 'python-command.sh', 'python-command.ps1']) {
    fs.writeFileSync(path.join(scriptsDir, script), '# test', 'utf8');
  }

  // Memory queue
  fs.writeFileSync(path.join(scriptsDir, 'memory-queue.jsonl'), '', 'utf8');
}

function runCli(args: string[], env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, AUTOMEM_API_URL: 'http://localhost:9999', ...env },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
  }
}

describe('uninstall copilot', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempCopilotDir();
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // T025: uninstall removes all automem-*.json from hooks directory
  it('removes automem hook JSON files', () => {
    installFakeHooks(tempDir);
    const result = runCli(['uninstall', 'copilot', '--dir', tempDir, '--yes', '--quiet']);
    expect(result.exitCode).toBe(0);

    const remaining = fs.readdirSync(path.join(tempDir, 'hooks'))
      .filter(f => f.startsWith('automem-') && f.endsWith('.json') && !f.includes('.removed.'));
    expect(remaining).toHaveLength(0);
  });

  // T026: uninstall removes all AutoMem .sh and .ps1 scripts
  it('removes AutoMem support scripts', () => {
    installFakeHooks(tempDir);
    const result = runCli(['uninstall', 'copilot', '--dir', tempDir, '--yes', '--quiet']);
    expect(result.exitCode).toBe(0);

    const remaining = fs.readdirSync(path.join(tempDir, 'scripts'))
      .filter(f => {
        if (f.includes('.removed.')) return false;
        return f.includes('capture-') || f.includes('session-memory') || f.includes('python-command');
      });
    expect(remaining).toHaveLength(0);
  });

  // T027: --clean-all also removes AutoMem entry from mcp-config.json
  it('--clean-all removes entry from mcp-config.json', () => {
    installFakeHooks(tempDir);
    // Create a fake mcp-config.json
    const configPath = path.join(tempDir, 'mcp-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        memory: { command: 'npx', args: ['mcp-automem'] },
        other: { command: 'other-server' },
      },
    }, null, 2), 'utf8');

    const result = runCli(['uninstall', 'copilot', '--dir', tempDir, '--clean-all', '--yes', '--quiet']);
    expect(result.exitCode).toBe(0);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcpServers.memory).toBeUndefined();
    expect(config.mcpServers.other).toBeDefined();
  });

  // T028: --dry-run lists files without removing them
  it('--dry-run does not remove files', () => {
    installFakeHooks(tempDir);
    const beforeHooks = fs.readdirSync(path.join(tempDir, 'hooks'));

    const result = runCli(['uninstall', 'copilot', '--dir', tempDir, '--dry-run', '--yes']);
    expect(result.exitCode).toBe(0);

    const afterHooks = fs.readdirSync(path.join(tempDir, 'hooks'));
    expect(afterHooks).toEqual(beforeHooks);
  });

  // T029: no hooks installed reports clean exit
  it('reports no files found when nothing installed', () => {
    const result = runCli(['uninstall', 'copilot', '--dir', tempDir, '--yes']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No AutoMem files found');
  });
});

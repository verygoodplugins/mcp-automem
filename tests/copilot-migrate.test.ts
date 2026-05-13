/**
 * Copilot Migrate Tests (US4: T036-T039)
 * Tests for migrate --to/--from copilot command behavior.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const CLI_PATH = path.resolve(__dirname, '../dist/index.js');

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

describe('migrate to/from copilot', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-migrate-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // T036: migrate --from none --to copilot delegates to copilot installer
  it('--from none --to copilot installs hooks via dry-run', () => {
    const result = runCli([
      'migrate', '--from', 'none', '--to', 'copilot', '--dry-run', '--yes',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('copilot');
    expect(result.stdout).toContain('dry run');
  });

  // T037: migrate --from manual --to copilot analyzes then installs
  it('--from manual --to copilot analyzes and installs', () => {
    const result = runCli([
      'migrate', '--from', 'manual', '--to', 'copilot',
      '--dir', tempDir, '--dry-run', '--yes',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('manual');
  });

  // T038: migrate --from copilot --to claude-code analyzes copilot hooks
  it('--from copilot --to claude-code analyzes copilot hooks', () => {
    const result = runCli([
      'migrate', '--from', 'copilot', '--to', 'claude-code', '--dry-run', '--yes',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Copilot');
  });

  // T039: --to copilot --dry-run shows planned changes
  it('--to copilot --dry-run shows planned changes without modifying files', () => {
    const result = runCli([
      'migrate', '--from', 'none', '--to', 'copilot', '--dry-run', '--yes',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dry run');
  });

  // Argument validation tests
  it('rejects invalid --to value', () => {
    const result = runCli(['migrate', '--from', 'none', '--to', 'invalid']);
    expect(result.exitCode).not.toBe(0);
  });

  it('rejects invalid --from value', () => {
    const result = runCli(['migrate', '--from', 'invalid', '--to', 'copilot']);
    expect(result.exitCode).not.toBe(0);
  });

  it('accepts copilot as --from value', () => {
    const result = runCli([
      'migrate', '--from', 'copilot', '--to', 'copilot', '--dry-run', '--yes',
    ]);
    expect(result.exitCode).toBe(0);
  });
});

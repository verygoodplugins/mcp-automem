/**
 * Tests for templates/claude-code/hooks/automem-track-store.sh
 *
 * PostToolUse tracker for mcp__memory__store_memory: writes the
 * automem-stored-<session_id> sentinel that keeps automem-stop-nudge.sh
 * quiet once a store already happened. Side-effect only — any stdout here
 * would be injected into the conversation as PostToolUse context.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOOKS_DIR } from './helpers';

function runTrackStore(options: { input?: string; env?: NodeJS.ProcessEnv } = {}): {
  stdout: string;
  exitCode: number;
} {
  const hookPath = path.join(HOOKS_DIR, 'automem-track-store.sh');
  const result = spawnSync('bash', [hookPath], {
    encoding: 'utf8',
    timeout: 5000,
    input: options.input,
    env: options.env ?? process.env,
  });
  return { stdout: result.stdout ?? '', exitCode: result.status ?? 0 };
}

describe('automem-track-store.sh', () => {
  const tmpDirs: string[] = [];
  function tmpEnv(): NodeJS.ProcessEnv {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-track-store-'));
    tmpDirs.push(tmp);
    return { ...process.env, TMPDIR: tmp };
  }
  afterEach(() => {
    while (tmpDirs.length) {
      try {
        fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('writes the stored sentinel for the session and emits nothing', () => {
    const env = tmpEnv();
    const result = runTrackStore({
      input: JSON.stringify({ session_id: 'track-1', tool_name: 'mcp__memory__store_memory' }),
      env,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.existsSync(path.join(env.TMPDIR as string, 'automem-stored-track-1'))).toBe(true);
  });

  it('sanitizes the session_id used in the sentinel path', () => {
    const env = tmpEnv();
    runTrackStore({
      input: JSON.stringify({ session_id: '../evil/../id' }),
      env,
    });
    const entries = fs.readdirSync(env.TMPDIR as string);
    expect(entries).toEqual(['automem-stored-evilid']);
  });

  it('does nothing without a session_id', () => {
    const env = tmpEnv();
    const result = runTrackStore({ input: '', env });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.readdirSync(env.TMPDIR as string)).toEqual([]);
  });
});

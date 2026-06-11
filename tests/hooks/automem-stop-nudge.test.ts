/**
 * Tests for templates/claude-code/hooks/automem-stop-nudge.sh
 *
 * The Stop hook replaces the retired mechanical build/test/deploy capture
 * with an LLM-judged nudge: if no store_memory call happened this session
 * (tracked via the automem-stored-<session_id> sentinel written by
 * automem-track-store.sh), it emits hookSpecificOutput.additionalContext
 * asking Claude once to consider storing durable facts. The nudge names the
 * tool by short name so it stays correct under plugin-namespaced MCP
 * prefixes (mcp__plugin_automem_memory__*) as well as mcp__memory__*.
 *
 * The JSON shape is the load-bearing part: Claude Code rejects Stop-hook
 * JSON whose hookSpecificOutput lacks hookEventName ("Stop" | "SubagentStop").
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOOKS_DIR } from './helpers';

type StopHookOutput = {
  suppressOutput?: boolean;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
  };
};

function runStopNudge(options: { input?: string; env?: NodeJS.ProcessEnv } = {}): {
  stdout: string;
  exitCode: number;
} {
  const hookPath = path.join(HOOKS_DIR, 'automem-stop-nudge.sh');
  const result = spawnSync('bash', [hookPath], {
    encoding: 'utf8',
    timeout: 5000,
    input: options.input,
    env: options.env ?? process.env,
  });
  return { stdout: result.stdout ?? '', exitCode: result.status ?? 0 };
}

describe('automem-stop-nudge.sh', () => {
  const tmpDirs: string[] = [];
  function tmpEnv(): NodeJS.ProcessEnv {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-stop-nudge-'));
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

  it('emits schema-valid Stop JSON with hookEventName (the field Claude Code validates)', () => {
    const result = runStopNudge({
      input: JSON.stringify({ session_id: 'nudge-1', hook_event_name: 'Stop' }),
      env: tmpEnv(),
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StopHookOutput;
    // suppressOutput:true hides the nudge JSON from the user's transcript while
    // still injecting additionalContext into Claude's context.
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('Stop');
    // Short tool name: must hold for both mcp__memory__* and the plugin's
    // namespaced mcp__plugin_automem_memory__* tool set.
    expect(parsed.hookSpecificOutput?.additionalContext).toMatch(/store_memory/);
    expect(parsed.hookSpecificOutput?.additionalContext).not.toMatch(/mcp__memory__/);
  });

  it('echoes SubagentStop back when registered on that event', () => {
    const result = runStopNudge({
      input: JSON.stringify({ session_id: 'nudge-sub', hook_event_name: 'SubagentStop' }),
      env: tmpEnv(),
    });
    const parsed = JSON.parse(result.stdout) as StopHookOutput;
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('SubagentStop');
  });

  it('nudges the policy triggers and permits stopping without a store', () => {
    const result = runStopNudge({
      input: JSON.stringify({ session_id: 'nudge-text', hook_event_name: 'Stop' }),
      env: tmpEnv(),
    });
    const context = (JSON.parse(result.stdout) as StopHookOutput).hookSpecificOutput
      ?.additionalContext as string;
    expect(context).toMatch(/Preference/);
    expect(context).toMatch(/Decision/);
    expect(context).toMatch(/Pattern/);
    expect(context).toMatch(/Insight/);
    // Anti-noise guardrails: never store to perform attentiveness.
    expect(context).toMatch(/stop normally/i);
    expect(context).toMatch(/session summaries/i);
    // Bare-tag convention only — no namespace prefixes.
    expect(context).not.toMatch(/(project|lang)\//);
  });

  it('nudges at most once per session (re-entrant Stop stays silent)', () => {
    const env = tmpEnv();
    const input = JSON.stringify({ session_id: 'nudge-once', hook_event_name: 'Stop' });
    const first = runStopNudge({ input, env });
    expect(first.stdout).toMatch(/hookSpecificOutput/);
    const second = runStopNudge({ input, env });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe('');
  });

  it('stays silent when a store_memory call was tracked this session', () => {
    const env = tmpEnv();
    fs.writeFileSync(path.join(env.TMPDIR as string, 'automem-stored-nudge-stored'), '1');
    const result = runStopNudge({
      input: JSON.stringify({ session_id: 'nudge-stored', hook_event_name: 'Stop' }),
      env,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('stays silent without a session_id (no dedup -> nudge loop risk)', () => {
    const result = runStopNudge({ input: '', env: tmpEnv() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  // POSIX-only: relies on ENOTDIR when writing under a regular file. The primary
  // `test` CI job is POSIX; the win32 hook job has different FS semantics.
  const itPosix = process.platform === 'win32' ? it.skip : it;
  itPosix('stays silent when the nudge sentinel cannot be written (dedup impossible)', () => {
    // Point TMPDIR at a regular file so "${TMPDIR}/automem-stop-nudged-*" cannot
    // be created. The once-per-session guarantee is gone, so the hook must stay
    // silent rather than nudge on every Stop.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-stop-nudge-nodir-'));
    tmpDirs.push(dir);
    const fileAsTmp = path.join(dir, 'not-a-dir');
    fs.writeFileSync(fileAsTmp, 'x');
    const result = runStopNudge({
      input: JSON.stringify({ session_id: 'nudge-nowrite', hook_event_name: 'Stop' }),
      env: { ...process.env, TMPDIR: fileAsTmp },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

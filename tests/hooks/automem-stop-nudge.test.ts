/**
 * Tests for templates/claude-code/hooks/automem-stop-nudge.sh
 *
 * The Stop hook replaces the retired mechanical build/test/deploy capture
 * with an LLM-judged nudge: if no store_memory call happened this session
 * (tracked via the automem-stored-<session_id> sentinel written by
 * automem-track-store.sh) AND the transcript shows a substantive session,
 * it emits hookSpecificOutput.additionalContext asking Claude once to
 * consider storing durable facts.
 *
 * The Stop hook uses Claude Code's documented additionalContext channel. Its
 * wording stays factual rather than command-like so Claude Code is less likely
 * to surface it through prompt-injection defenses if the host supports hidden
 * Stop context.
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

/** Must match AUTOMEM_STOP_NUDGE_MIN_HUMAN_TURNS in src/memory-policy/shared.ts. */
const MIN_HUMAN_TURNS = 5;

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

/**
 * Build a transcript JSONL shaped like Claude Code's real session files:
 * human prompts are type:"user" entries; tool results are ALSO type:"user"
 * but carry tool_use_id; meta entries (command output, compact caveats)
 * carry isMeta:true. Only the first kind counts toward the gate.
 */
function transcriptLines(opts: {
  humanTurns: number;
  toolResults?: number;
  metaTurns?: number;
}): string[] {
  const lines: string[] = [];
  for (let i = 0; i < opts.humanTurns; i += 1) {
    lines.push(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: `prompt ${i}` },
        uuid: `human-${i}`,
      })
    );
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] },
        uuid: `assistant-${i}`,
      })
    );
  }
  for (let i = 0; i < (opts.toolResults ?? 0); i += 1) {
    lines.push(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, content: 'ok' }],
        },
        uuid: `tool-${i}`,
      })
    );
  }
  for (let i = 0; i < (opts.metaTurns ?? 0); i += 1) {
    lines.push(
      JSON.stringify({
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: `meta ${i}` },
        uuid: `meta-${i}`,
      })
    );
  }
  return lines;
}

describe('automem-stop-nudge.sh', () => {
  const tmpDirs: string[] = [];
  function makeTmpDir(prefix: string): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(tmp);
    return tmp;
  }
  function tmpEnv(): NodeJS.ProcessEnv {
    return { ...process.env, TMPDIR: makeTmpDir('automem-stop-nudge-') };
  }
  /** Forward slashes so the path survives JSON round-tripping on win32 too. */
  function writeTranscript(
    opts: { humanTurns: number; toolResults?: number; metaTurns?: number },
    dir = makeTmpDir('automem-stop-nudge-transcript-')
  ): string {
    const transcriptPath = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, `${transcriptLines(opts).join('\n')}\n`);
    return transcriptPath.replace(/\\/g, '/');
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
      input: JSON.stringify({
        session_id: 'nudge-1',
        hook_event_name: 'Stop',
        transcript_path: writeTranscript({ humanTurns: MIN_HUMAN_TURNS }),
      }),
      env: tmpEnv(),
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StopHookOutput;
    // suppressOutput:true hides the raw JSON stdout from transcript view; the
    // context itself stays neutral so hidden-capable hosts can pass it silently.
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('Stop');
    expect(parsed.hookSpecificOutput?.additionalContext).toMatch(/AutoMem status/);
    expect(parsed.hookSpecificOutput?.additionalContext).not.toMatch(/mcp__memory__/);
  });

  it('echoes SubagentStop back when registered on that event', () => {
    const result = runStopNudge({
      input: JSON.stringify({
        session_id: 'nudge-sub',
        hook_event_name: 'SubagentStop',
        transcript_path: writeTranscript({ humanTurns: MIN_HUMAN_TURNS }),
      }),
      env: tmpEnv(),
    });
    const parsed = JSON.parse(result.stdout) as StopHookOutput;
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('SubagentStop');
  });

  it('emits neutral factual context, not command-like chat text', () => {
    const result = runStopNudge({
      input: JSON.stringify({
        session_id: 'nudge-text',
        hook_event_name: 'Stop',
        transcript_path: writeTranscript({ humanTurns: MIN_HUMAN_TURNS }),
      }),
      env: tmpEnv(),
    });
    const context = (JSON.parse(result.stdout) as StopHookOutput).hookSpecificOutput
      ?.additionalContext as string;
    // Keep the context one line so any host that still surfaces Stop context
    // has minimal visible output.
    expect(context).not.toContain('\n');
    expect(context).toContain('AutoMem status: no memory has been stored this session.');
    expect(context).toContain(
      'Durable candidates: corrections, stabilized decisions, articulated patterns, and root-cause insights.'
    );
    expect(context).toContain(
      'Non-candidates: session summaries, progress notes, confirmations, and temporary output.'
    );
    expect(context).toMatch(/correction/i);
    expect(context).toMatch(/decision/i);
    expect(context).toMatch(/pattern/i);
    expect(context).toMatch(/insight/i);
    expect(context).not.toMatch(/store it now/i);
    expect(context).not.toMatch(/do not/i);
    expect(context).not.toMatch(/reply with exactly/i);
    expect(context).not.toMatch(/Nothing durable to store/);
    // Anti-noise guardrails: never store to perform attentiveness.
    expect(context).toMatch(/session summaries/i);
    // Bare-tag convention only — no namespace prefixes.
    expect(context).not.toMatch(/(project|lang)\//);
  });

  it('nudges at most once per session (re-entrant Stop stays silent)', () => {
    const env = tmpEnv();
    const input = JSON.stringify({
      session_id: 'nudge-once',
      hook_event_name: 'Stop',
      transcript_path: writeTranscript({ humanTurns: MIN_HUMAN_TURNS }),
    });
    const first = runStopNudge({ input, env });
    expect(first.stdout).toMatch(/hookSpecificOutput/);
    const second = runStopNudge({ input, env });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe('');
  });

  it('stays silent below the human-turn threshold (trivial sessions cost nothing)', () => {
    const result = runStopNudge({
      input: JSON.stringify({
        session_id: 'nudge-short',
        hook_event_name: 'Stop',
        transcript_path: writeTranscript({ humanTurns: MIN_HUMAN_TURNS - 1 }),
      }),
      env: tmpEnv(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('does not count tool results or meta entries toward the threshold', () => {
    // Tool-result and meta lines are type:"user" in the transcript format —
    // a tool-heavy short session must not trip the gate.
    const result = runStopNudge({
      input: JSON.stringify({
        session_id: 'nudge-toolheavy',
        hook_event_name: 'Stop',
        transcript_path: writeTranscript({
          humanTurns: MIN_HUMAN_TURNS - 1,
          toolResults: 40,
          metaTurns: 5,
        }),
      }),
      env: tmpEnv(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('keeps the once-per-session sentinel unburned below the threshold', () => {
    // A below-threshold Stop must NOT consume the nudge: the same session can
    // still be nudged at a later Stop once it crosses the line. This is what
    // fixes the fires-at-first-stop timing flaw of the previous design.
    const env = tmpEnv();
    const transcriptDir = makeTmpDir('automem-stop-nudge-grow-');
    const transcriptPath = writeTranscript({ humanTurns: MIN_HUMAN_TURNS - 1 }, transcriptDir);
    const input = JSON.stringify({
      session_id: 'nudge-grow',
      hook_event_name: 'Stop',
      transcript_path: transcriptPath,
    });
    const early = runStopNudge({ input, env });
    expect(early.stdout).toBe('');
    fs.appendFileSync(transcriptPath, `${transcriptLines({ humanTurns: 2 }).join('\n')}\n`);
    const later = runStopNudge({ input, env });
    expect(later.stdout).toMatch(/hookSpecificOutput/);
  });

  it('stays silent when the hook input has no transcript_path (no way to judge substance)', () => {
    const result = runStopNudge({
      input: JSON.stringify({ session_id: 'nudge-nopath', hook_event_name: 'Stop' }),
      env: tmpEnv(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('stays silent when the transcript_path does not exist', () => {
    const result = runStopNudge({
      input: JSON.stringify({
        session_id: 'nudge-ghost',
        hook_event_name: 'Stop',
        transcript_path: '/nonexistent/automem/transcript.jsonl',
      }),
      env: tmpEnv(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('stays silent when a store_memory call was tracked this session', () => {
    const env = tmpEnv();
    fs.writeFileSync(path.join(env.TMPDIR as string, 'automem-stored-nudge-stored'), '1');
    const result = runStopNudge({
      input: JSON.stringify({
        session_id: 'nudge-stored',
        hook_event_name: 'Stop',
        transcript_path: writeTranscript({ humanTurns: MIN_HUMAN_TURNS }),
      }),
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
    const dir = makeTmpDir('automem-stop-nudge-nodir-');
    const fileAsTmp = path.join(dir, 'not-a-dir');
    fs.writeFileSync(fileAsTmp, 'x');
    const result = runStopNudge({
      input: JSON.stringify({
        session_id: 'nudge-nowrite',
        hook_event_name: 'Stop',
        transcript_path: writeTranscript({ humanTurns: MIN_HUMAN_TURNS }),
      }),
      env: { ...process.env, TMPDIR: fileAsTmp },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

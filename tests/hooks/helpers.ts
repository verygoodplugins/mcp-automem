/**
 * Helpers for driving the template hook scripts in isolation.
 *
 * Each capture-*.sh hook reads a JSON payload on stdin (Claude Code's hook
 * format), maybe appends a JSONL record to $HOME/.claude/scripts/memory-queue.jsonl,
 * and prints a short status line. Tests run the script with a tmp HOME so the
 * real user queue is untouched, then inspect the queue file.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const HOOKS_DIR = path.resolve(__dirname, '../../templates/claude-code/hooks');
export const SCRIPTS_DIR = path.resolve(__dirname, '../../templates/claude-code/scripts');

export type HookInput = {
  command: string;
  exitCode?: number;
  output?: string;
  cwd?: string;
};

export type HookResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  queue: QueueEntry[];
  queuePath: string;
  home: string;
};

export type QueueEntry = {
  content: string;
  tags: string[];
  type: string;
  importance: number;
  timestamp?: string;
  t_valid?: string;
  t_invalid?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Run a capture hook with an isolated HOME. Returns the queue file contents
 * plus stdout/stderr/exit. The HOME directory is left behind so callers can
 * inspect it if needed; tests should register a cleanup in afterEach.
 */
export function runCaptureHook(
  hookName: 'capture-build-result.sh' | 'capture-deployment.sh' | 'capture-test-pattern.sh',
  input: HookInput
): HookResult {
  const hookPath = path.join(HOOKS_DIR, hookName);
  if (!fs.existsSync(hookPath)) {
    throw new Error(`Hook not found: ${hookPath}`);
  }

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-hook-test-'));
  const queuePath = path.join(home, '.claude', 'scripts', 'memory-queue.jsonl');

  const cwd = input.cwd ?? process.cwd();
  const payload = JSON.stringify({
    tool_input: { command: input.command },
    tool_response: {
      exit_code: input.exitCode ?? 0,
      output: input.output ?? '',
    },
    cwd,
  });

  const result = spawnSync('bash', [hookPath], {
    input: payload,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      HOME: home,
      // Hooks should never need the API key to run — the queue drain is a
      // separate Stop-hook step. Unset to catch accidental dependencies.
      AUTOMEM_API_KEY: '',
      AUTOMEM_ENDPOINT: '',
    },
  });

  const queue = readQueue(queuePath);

  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    queue,
    queuePath,
    home,
  };
}

export function readQueue(queuePath: string): QueueEntry[] {
  if (!fs.existsSync(queuePath)) return [];
  const raw = fs.readFileSync(queuePath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueEntry);
}

export function cleanup(home: string): void {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    // Best-effort; tmp cleanup shouldn't fail a test.
  }
}

/**
 * Tags used in the corpus follow a BARE convention (see
 * templates/CLAUDE_MD_MEMORY_RULES.md). Any tag containing a namespace-style
 * prefix like `source/hook`, `project/foo`, `lang/ts`, `framework/jest` is
 * considered a regression. This helper returns the offenders, if any.
 */
export const NAMESPACE_PREFIXES = [
  'source/',
  'project/',
  'lang/',
  'framework/',
  'tool/',
  'env/',
  'platform/',
  'domain/',
  'significance/',
] as const;

export function findNamespaceTags(tags: string[]): string[] {
  return tags.filter((t) => NAMESPACE_PREFIXES.some((p) => t.startsWith(p)));
}

/** Valid AutoMem memory types. */
export const VALID_TYPES = [
  'Decision',
  'Pattern',
  'Preference',
  'Style',
  'Habit',
  'Insight',
  'Context',
] as const;

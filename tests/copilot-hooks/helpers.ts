/**
 * Helpers for driving the Copilot hook scripts (both bash and PowerShell)
 * in isolation.
 *
 * Each capture-*.{sh,ps1} hook reads a JSON payload on stdin (Copilot hook
 * format), appends a JSONL record to $HOME/.copilot/scripts/memory-queue.jsonl,
 * and prints a short status line. Tests run the script with a tmp HOME so the
 * real user queue is untouched, then inspect the queue file.
 *
 * Scripts are skipped at runtime when the required interpreter (bash / pwsh)
 * is not available, so the suite works cross-platform.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const COPILOT_SCRIPTS_DIR = path.resolve(
  __dirname,
  '../../templates/copilot/scripts'
);

// ---- interpreter detection (cached) ----

let _hasBash: boolean | null = null;
let _hasPwsh: boolean | null = null;

export function hasBash(): boolean {
  if (_hasBash === null) {
    const r = spawnSync('bash', ['--version'], { encoding: 'utf8', timeout: 3000 });
    _hasBash = r.status === 0;
  }
  return _hasBash;
}

export function hasPwsh(): boolean {
  if (_hasPwsh === null) {
    const r = spawnSync('pwsh', ['--version'], { encoding: 'utf8', timeout: 3000 });
    _hasPwsh = r.status === 0;
  }
  return _hasPwsh;
}

// ---- types ----

export type Shell = 'bash' | 'pwsh';

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

// ---- Windows path conversion for bash ----

let _bashMountPrefix: string | null = null;

/**
 * Detect whether bash uses Git Bash (/c/) or WSL (/mnt/c/) mount paths.
 * Cached after first call.
 */
function bashMountPrefix(): string {
  if (_bashMountPrefix !== null) return _bashMountPrefix;
  try {
    const r = spawnSync('bash', ['-c', 'test -d /c && echo gitbash || echo wsl'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    _bashMountPrefix = r.stdout?.trim() === 'gitbash' ? '' : '/mnt';
  } catch {
    _bashMountPrefix = '/mnt';
  }
  return _bashMountPrefix;
}

function toUnixPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const forward = p.replace(/\\/g, '/');
  const prefix = bashMountPrefix();
  return forward.replace(/^([A-Za-z]):/, (_m, drive: string) => `${prefix}/${drive.toLowerCase()}`);
}

// ---- hook runners ----

/**
 * Run a capture hook with an isolated HOME. Returns the queue file contents
 * plus stdout/stderr/exit. The HOME directory is left behind so callers can
 * inspect it; tests should register a cleanup in afterEach.
 */
export function runCaptureHook(
  shell: Shell,
  scriptBaseName: string,
  input: HookInput
): HookResult {
  const ext = shell === 'bash' ? '.sh' : '.ps1';
  const scriptPath = path.join(COPILOT_SCRIPTS_DIR, scriptBaseName + ext);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Hook not found: ${scriptPath}`);
  }

  const home = fs.mkdtempSync(path.join(os.tmpdir(), `automem-${shell}-hook-test-`));
  const queueDir = path.join(home, '.copilot', 'scripts');
  const queuePath = path.join(queueDir, 'memory-queue.jsonl');

  const cwd = input.cwd ?? process.cwd();
  const payload = JSON.stringify({
    tool_input: { command: input.command },
    tool_response: {
      exit_code: input.exitCode ?? 0,
      output: input.output ?? '',
    },
    toolArgs: { command: input.command },
    toolResult: {
      exit_code: input.exitCode ?? 0,
      textResultForLlm: input.output ?? '',
    },
    cwd,
  });

  let result;
  if (shell === 'bash') {
    const bashPath = toUnixPath(scriptPath);
    // HOME must be a Unix path when bash is WSL/Git Bash.
    // Use bash -c with export so bash inherits its own PATH (jq, python3)
    // instead of the Windows PATH from process.env.
    const bashHome = toUnixPath(home);
    result = spawnSync(
      'bash',
      ['-c', `export HOME="${bashHome}" AUTOMEM_API_KEY="" AUTOMEM_API_URL="" AUTOMEM_ENDPOINT=""; exec bash "${bashPath}"`],
      {
        input: payload,
        encoding: 'utf8',
        timeout: 15000,
      }
    );
  } else {
    result = spawnSync(
      'pwsh',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        input: payload,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          AUTOMEM_API_KEY: '',
          AUTOMEM_API_URL: '',
          AUTOMEM_ENDPOINT: '',
        },
      }
    );
  }

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

/**
 * Run the session-start script and return parsed additionalContext.
 */
export function runSessionStart(
  shell: Shell,
  options: { cwd?: string } = {}
): {
  stdout: string;
  stderr: string;
  exitCode: number;
  additionalContext: string;
} {
  const ext = shell === 'bash' ? '.sh' : '.ps1';
  const scriptPath = path.join(COPILOT_SCRIPTS_DIR, `automem-session-start${ext}`);

  let result;
  if (shell === 'bash') {
    const bashPath = toUnixPath(scriptPath);
    const bashCwd = toUnixPath(options.cwd ?? process.cwd());
    result = spawnSync(
      'bash',
      ['-c', `cd "${bashCwd}" && exec bash "${bashPath}"`],
      {
        encoding: 'utf8',
        timeout: 10000,
      }
    );
  } else {
    result = spawnSync(
      'pwsh',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        encoding: 'utf8',
        timeout: 10000,
        cwd: options.cwd ?? process.cwd(),
      }
    );
  }

  const stdout = result.stdout ?? '';
  let additionalContext = '';
  try {
    const parsed = JSON.parse(stdout);
    additionalContext = parsed.additionalContext ?? '';
  } catch {
    // For bash scripts that output raw text (not JSON), use stdout directly
    additionalContext = stdout;
  }

  return {
    stdout,
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 0,
    additionalContext,
  };
}

// ---- queue reader ----

export function readQueue(queuePath: string): QueueEntry[] {
  if (!fs.existsSync(queuePath)) return [];
  let raw = fs.readFileSync(queuePath, 'utf8');
  // Strip UTF-8 BOM that PowerShell's StreamWriter emits by default
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const clean = line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
      return JSON.parse(clean) as QueueEntry;
    });
}

export function cleanup(home: string): void {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    // Best-effort
  }
}

// ---- tag validation ----

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

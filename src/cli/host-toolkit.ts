import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

export interface CommonOptions {
  dryRun?: boolean;
  quiet?: boolean;
  targetDir?: string;
  projectName?: string;
  yes?: boolean;
}

export function log(message: string, quiet?: boolean): void {
  if (!quiet) {
    console.log(message);
  }
}

/**
 * Endpoint equality as the API client sees it: AutoMemClient strips a trailing slash,
 * so `https://x` and `https://x/` are the same server. Shared because credential
 * pairing depends on it — a key must never follow a "changed" endpoint that is only
 * spelled differently, and must never ride along to one that genuinely differs.
 */
export function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** Whether two endpoint spellings address the same server. */
export function sameEndpoint(a?: string, b?: string): boolean {
  return Boolean(a) && Boolean(b) && normalizeEndpoint(a!) === normalizeEndpoint(b!);
}

/**
 * The two names AutoMem accepts for the same credential. `AUTOMEM_API_KEY` is
 * canonical (the service and its docs standardized on `_KEY`); `AUTOMEM_API_TOKEN`
 * is the deprecated alias the Railway template, the SSE sidecar, and existing
 * deploys still set, so every reader has to accept it — see `src/env.ts`. Ordered:
 * callers take the first match, so the canonical name wins when both are present.
 */
export const AUTOMEM_API_KEY_NAMES = ['AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN'] as const;

/** The two names AutoMem accepts for the endpoint, canonical first. */
export const AUTOMEM_ENDPOINT_NAMES = ['AUTOMEM_API_URL', 'AUTOMEM_ENDPOINT'] as const;

function firstNonEmpty(
  source: Record<string, unknown> | undefined,
  names: readonly string[]
): string | undefined {
  if (!source) return undefined;
  for (const name of names) {
    const value = String(source[name] ?? '').trim();
    if (value) return value;
  }
  return undefined;
}

/** The API key an env-like record carries, under either supported name. */
export function readApiKeyFrom(source?: Record<string, unknown>): string | undefined {
  return firstNonEmpty(source, AUTOMEM_API_KEY_NAMES);
}

/** The endpoint an env-like record carries, under either supported name. */
export function readEndpointFrom(source?: Record<string, unknown>): string | undefined {
  return firstNonEmpty(source, AUTOMEM_ENDPOINT_NAMES);
}

export interface InheritedApiKeyInputs {
  /** The endpoint this run will write. */
  endpoint: string;
  /** `--api-key`. An explicit flag is the operator naming the credential for this run. */
  explicitKey?: string;
  /** Endpoint already registered for this host, if any. */
  storedEndpoint?: string;
  /** Key already registered for this host, if any. */
  storedKey?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve which API key a host install should write, pairing every *inherited* key
 * with the endpoint it was issued for.
 *
 * A key belongs to its endpoint. Handing one to a different server discloses the
 * secret to a host that was never meant to have it, and this has now been filed
 * against three separate callers, so the rule lives here rather than in each host.
 *
 * Precedence: explicit flag, then environment, then whatever is already installed.
 *
 * The two inherited sources are deliberately *not* symmetric:
 *
 *  - An env key with **no** env endpoint stands. A bare `export AUTOMEM_API_KEY` is
 *    a normal way to carry a credential; it is bound to nothing, so it cannot be
 *    bound to the wrong thing.
 *  - A stored key with **no** stored endpoint is dropped. A host config entry that
 *    names a key but no URL is malformed, and guessing that it meant the endpoint
 *    chosen for *this* run is exactly the disclosure this function exists to prevent.
 *
 * `CLAUDE_PLUGIN_OPTION_*` is intentionally not read here. Those variables are
 * exported by Claude Code into the plugin's own MCP subprocess for `src/index.ts`
 * to resolve; an installer that inherits them picks up a key whose paired
 * `CLAUDE_PLUGIN_OPTION_API_URL` it never consults. No installer flow sets them.
 */
export function resolveInheritedApiKey(inputs: InheritedApiKeyInputs): string | undefined {
  const explicit = inputs.explicitKey?.trim();
  if (explicit) return explicit;

  const env = inputs.env ?? process.env;
  const envKey = readApiKeyFrom(env);
  if (envKey) {
    const envEndpoint = readEndpointFrom(env);
    // Unbound key: nothing to mismatch against.
    if (!envEndpoint) return envKey;
    if (sameEndpoint(envEndpoint, inputs.endpoint)) return envKey;
  }

  const storedKey = inputs.storedKey?.trim();
  if (storedKey && sameEndpoint(inputs.storedEndpoint, inputs.endpoint)) {
    return storedKey;
  }

  return undefined;
}

/**
 * Whether an MCP server entry is AutoMem's, and therefore ours to replace or remove.
 *
 * Matched on identity, never on free text: an earlier version serialized the whole
 * entry (env values included) and searched it for `mcp-automem`, so an unrelated
 * server pointing at a host like `https://mcp-automem.internal` was classified as
 * ours and could be overwritten by setup or deleted by uninstall.
 *
 * Two things count as identity:
 *  - the package in `command`/`args` — `npx -y @verygoodplugins/mcp-automem`, what we
 *    write, and `node /path/to/mcp-automem/dist/index.js`, what a linked dev checkout
 *    looks like. Matched as a whole path segment, so `mcp-automem.internal` does not
 *    qualify. An npm version or dist-tag suffix is part of the spec npm documents
 *    (`npm exec -- <pkg>[@<version>]`), so a pinned `…/mcp-automem@0.15.0` is the same
 *    package — without this, setup refuses to update a pinned entry and uninstall
 *    skips it.
 *  - AutoMem's own env var *names*. Hand-written entries legitimately vary the
 *    command, and a foreign server that sets `AUTOMEM_API_URL` itself is
 *    indistinguishable from AutoMem anyway. Names only — never values.
 */
const AUTOMEM_PACKAGE_SEGMENT = /(^|[/\\])(@verygoodplugins[/\\])?mcp-automem(@[^/\\]+)?([/\\]|$)/;

const AUTOMEM_ENV_KEYS: readonly string[] = [
  ...AUTOMEM_ENDPOINT_NAMES,
  ...AUTOMEM_API_KEY_NAMES,
  'AUTOMEM_PROCESS_TAG',
];

export function isAutoMemServerEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;

  const candidates: string[] = [];
  if (typeof record.command === 'string') candidates.push(record.command);
  if (Array.isArray(record.args)) {
    for (const arg of record.args) {
      if (typeof arg === 'string') candidates.push(arg);
    }
  }
  if (candidates.some((value) => AUTOMEM_PACKAGE_SEGMENT.test(value))) return true;

  const env = record.env;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    return AUTOMEM_ENV_KEYS.some((name) =>
      Object.prototype.hasOwnProperty.call(env as Record<string, unknown>, name)
    );
  }
  return false;
}

export function backupPath(filePath: string): string {
  let candidate = `${filePath}.bak`;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${filePath}.bak.${counter}`;
    counter += 1;
  }
  return candidate;
}

export interface WriteResult {
  status: 'created' | 'updated' | 'unchanged' | 'dry-run';
}

export function writeFileWithBackup(
  targetPath: string,
  content: string,
  // `secret: true` restricts the file (and its backup) to 0o600 — pass it for
  // secret-bearing files like a .env carrying an API key or server token.
  opts: Pick<CommonOptions, 'dryRun' | 'quiet'> & { secret?: boolean }
): WriteResult {
  if (opts.dryRun) {
    log(`[DRY RUN] Would write: ${targetPath}`, opts.quiet);
    return { status: 'dry-run' };
  }

  const mode = opts.secret ? 0o600 : undefined;
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const existed = fs.existsSync(targetPath);
  if (existed) {
    const current = fs.readFileSync(targetPath, 'utf8');
    if (current === content) {
      log(`✓ Unchanged: ${path.basename(targetPath)}`, opts.quiet);
      return { status: 'unchanged' };
    }
    const backup = backupPath(targetPath);
    fs.copyFileSync(targetPath, backup);
    if (mode !== undefined) {
      try {
        fs.chmodSync(backup, mode);
      } catch {
        // best-effort: a permission tightening failure must not abort the write
      }
    }
    log(`📦 Backup created: ${backup}`, opts.quiet);
  }

  fs.writeFileSync(targetPath, content, mode !== undefined ? { encoding: 'utf8', mode } : 'utf8');
  if (mode !== undefined) {
    // writeFileSync's `mode` only applies when the file is created; chmod ensures
    // an existing (possibly world-readable) file is tightened too.
    try {
      fs.chmodSync(targetPath, mode);
    } catch {
      // best-effort
    }
  }
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(targetPath)}`, opts.quiet);
  return { status: existed ? 'updated' : 'created' };
}

/**
 * The key a `.env` line assigns, or undefined if the line is not an assignment —
 * recognising the same syntax dotenv does, including an optional `export` prefix.
 *
 * The line-based writers must match exactly what the dotenv-based readers accept.
 * Widening the readers to dotenv without widening this is what let an
 * `export AUTOMEM_API_KEY=...` line survive a removal request: the reader saw the
 * stale key and asked for it to go, the remover did not recognise the line, and the
 * credential stayed live against the new endpoint. Shared by every writer so the two
 * halves cannot drift apart again.
 *
 * `exported` is reported so a rewrite can put the prefix back rather than silently
 * changing the meaning of the user's file.
 */
export function parseEnvAssignment(line: string): { key: string; exported: boolean } | undefined {
  const match = line.match(/^\s*(export\s+)?([A-Za-z0-9_]+)\s*=/);
  return match ? { key: match[2], exported: Boolean(match[1]) } : undefined;
}

// Quote .env values that would otherwise break dotenv parsing — empty strings and
// anything outside a conservative safe set (so whitespace, #, quotes, and shell
// metacharacters like $ ; {} stay inert). Shared by the setup and install writers
// so a value serializes identically regardless of which command wrote it.
export function formatEnvValue(value: string): string {
  if (value === '' || /[^A-Za-z0-9_@/:.,+-]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

// Merge KEY=value updates into an existing .env body without clobbering unrelated
// keys, comments, or blank lines: existing keys are rewritten in place and new keys
// appended. Uses hasOwnProperty (not `key in updates`) so a pre-existing line whose
// key collides with an Object.prototype member (e.g. `constructor`, `toString`) is
// preserved verbatim instead of corrupted. Pure (no I/O) so callers own the write.
export function mergeEnvContent(existing: string, updates: Record<string, string>): string {
  const lines: Array<{ key?: string; exported?: boolean; line: string }> = [];
  if (existing) {
    for (const line of existing.split(/\r?\n/)) {
      if (!line.trim()) {
        lines.push({ line });
        continue;
      }
      const assignment = parseEnvAssignment(line);
      if (assignment) {
        lines.push({ key: assignment.key, exported: assignment.exported, line });
      } else {
        lines.push({ line });
      }
    }
  }

  const updatedKeys = new Set<string>();
  for (const entry of lines) {
    if (entry.key && Object.prototype.hasOwnProperty.call(updates, entry.key)) {
      // The `export ` prefix is put back: dropping it would change what the line means
      // to a shell sourcing this file.
      const prefix = entry.exported ? 'export ' : '';
      entry.line = `${prefix}${entry.key}=${formatEnvValue(updates[entry.key])}`;
      updatedKeys.add(entry.key);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      lines.push({ key, line: `${key}=${formatEnvValue(value)}` });
    }
  }

  const content = lines
    .map((entry) => entry.line)
    .join(os.EOL)
    .replace(/\s+$/, '');
  return content.length ? `${content}${os.EOL}` : '';
}

// Drop KEY=value lines from an existing .env body, leaving every other line — including
// comments, blank lines, and unrelated keys — byte-identical. Deletion is a separate
// operation from mergeEnvContent on purpose: writing `KEY=` would work (the readers
// treat blank as absent) but leaves a confusing artifact that reads like a
// deliberately-emptied credential. Pure (no I/O) so callers own the write.
export function removeEnvContentKeys(existing: string, keys: readonly string[]): string {
  if (!existing || keys.length === 0) return existing;
  const doomed = new Set(keys);
  const kept = existing.split(/\r?\n/).filter((line) => {
    const assignment = parseEnvAssignment(line);
    return !assignment || !doomed.has(assignment.key);
  });
  const content = kept.join(os.EOL).replace(/\s+$/, '');
  return content.length ? `${content}${os.EOL}` : '';
}

export function readJsonFile<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function replaceTemplateVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`{{${escapedKey}}}`, 'g'), () => value);
  }
  return result;
}

// --- Marked rules blocks -----------------------------------------------------
//
// Every host installs its memory rules as a marked block inside a Markdown file the
// user also owns (AGENTS.md, copilot-instructions.md). The markers are the only thing
// telling an installer which bytes are its own, so the shape of the markers in the
// file is a correctness question, not a formatting one — see upsertMarkedBlock.

export interface MarkedBlockMarkers {
  start: string;
  end: string;
}

export interface MarkedBlockScan {
  /** Occurrences of the start marker. */
  starts: number;
  /** Occurrences of the end marker. */
  ends: number;
  /** Index of the first start marker, or -1 when there is none. */
  startIndex: number;
  /** Index of the first end marker, or -1 when there is none. */
  endIndex: number;
  /** Neither marker appears anywhere in the content. */
  absent: boolean;
  /**
   * Markers alternate start, end, start, end … in equal numbers, with at least one
   * pair. Every start then owns its own end, so removing the marked regions cannot
   * swallow a stray marker or the user's content around it.
   */
  paired: boolean;
  /** `paired` with exactly one pair — the only shape an upsert is allowed to rewrite. */
  singlePair: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indicesOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return found;
    found.push(idx);
    from = idx + needle.length;
  }
}

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Count and order the markers in `content`. Counting is the point: a file holding two
 * start markers and one end contains both markers, so an `indexOf`-based check calls it
 * well-formed and replaces from the first start through the end — silently deleting the
 * second marker and everything the user wrote between them.
 */
export function scanMarkedBlock(content: string, markers: MarkedBlockMarkers): MarkedBlockScan {
  const startPositions = indicesOf(content, markers.start);
  const endPositions = indicesOf(content, markers.end);
  const starts = startPositions.length;
  const ends = endPositions.length;

  let paired = starts === ends && starts >= 1;
  for (let i = 0; paired && i < starts; i += 1) {
    const nextStart = i + 1 < starts ? startPositions[i + 1] : Number.POSITIVE_INFINITY;
    paired = startPositions[i] < endPositions[i] && endPositions[i] < nextStart;
  }

  return {
    starts,
    ends,
    startIndex: starts ? startPositions[0] : -1,
    endIndex: ends ? endPositions[0] : -1,
    absent: starts === 0 && ends === 0,
    paired,
    singlePair: paired && starts === 1,
  };
}

/** Human-readable reason a scan is neither `absent` nor usable, for errors and warnings. */
export function describeMarkedBlockDefect(
  scan: MarkedBlockScan,
  markers: MarkedBlockMarkers
): string {
  if (scan.starts > 0 && scan.ends === 0) {
    return `it has ${markers.start} without a matching ${markers.end}`;
  }
  if (scan.ends > 0 && scan.starts === 0) {
    return `it has ${markers.end} without a matching ${markers.start}`;
  }
  if (scan.starts === 1 && scan.ends === 1) {
    return `its ${markers.end} precedes its ${markers.start}`;
  }
  if (scan.starts === scan.ends && !scan.paired) {
    return `its ${markers.start} and ${markers.end} markers do not pair up in order`;
  }
  return `found ${countOf(scan.starts, 'start marker')} and ${countOf(scan.ends, 'end marker')}`;
}

/**
 * Insert `block` into `existing`, replacing the marked block already there.
 *
 * Anything other than a clean file (no markers → append) or exactly one correctly
 * ordered pair (→ replace) is refused rather than repaired, because every other shape
 * destroys user content if rewritten anyway:
 *
 *  - One-sided (an interrupted run, or a hand edit that deleted half the block):
 *    appending leaves one start and two ends, so the *next* run replaces everything
 *    from the original start to the appended end.
 *  - Two starts before one end: replacing from the first start through the end deletes
 *    the second marker and whatever the user wrote between them — and the file looks
 *    well-formed to an `indexOf` check, which is why counting is the test.
 *
 * Repairing these means guessing which side of a stray marker the user's content belongs
 * on. That is their judgement to make, not ours.
 *
 * Output is normalized to exactly one trailing newline so re-runs are byte-stable.
 */
export function upsertMarkedBlock(
  existing: string | null,
  block: string,
  markers: MarkedBlockMarkers,
  filePath: string
): string {
  const normalize = (value: string): string => `${value.replace(/\n+$/, '')}\n`;
  if (!existing) {
    return normalize(block);
  }

  const scan = scanMarkedBlock(existing, markers);
  if (scan.absent) {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    return normalize(`${existing}${sep}${block}`);
  }

  if (!scan.singlePair) {
    throw new Error(
      `${filePath} does not contain exactly one ${markers.start} … ${markers.end} block ` +
        `(${describeMarkedBlockDefect(scan, markers)}). Rewriting it would delete the content ` +
        'between the stray markers. Restore or remove them (or point the rules path ' +
        'elsewhere), then re-run.'
    );
  }

  const before = existing.slice(0, scan.startIndex);
  const after = existing.slice(scan.endIndex + markers.end.length);
  // `after` opens with whatever separated the old block from the content below it, and
  // the block template carries its own trailing newline. Joining both blindly inserts
  // one more blank line every single run — normalizing only the end of the file hides
  // that when the block is last and lets it grow forever when it is not.
  return normalize(`${before}${block.replace(/\n+$/, '')}${after}`);
}

/**
 * Remove every marked region from `content`, collapsing the blank lines left behind.
 *
 * Only safe on content whose scan reports `paired` — on a stray marker this walks from
 * a start to the *next* end and takes the user's content in between with it. Callers
 * check `scanMarkedBlock(...).paired` first and decide what an unpaired file means for
 * them. Trailing-newline shape is left to the caller, which is the only part that
 * differs between the hosts.
 */
export function stripMarkedBlock(content: string, markers: MarkedBlockMarkers): string {
  const pattern = new RegExp(
    `\\n?${escapeRegExp(markers.start)}[\\s\\S]*?${escapeRegExp(markers.end)}\\n?`,
    'g'
  );
  return content.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n');
}

export function detectProjectName(cwd: string = process.cwd()): string {
  // 1) package.json name
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return String(pkg.name).replace(/^@.*?\//, '');
    } catch {
      // Fall through
    }
  }
  // 2) git remote
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      cwd,
      encoding: 'utf8',
    }).trim();
    if (remote) {
      const match = remote.match(/\/([^/]+?)(\.git)?$/);
      if (match) return match[1];
    }
  } catch {
    // Fall through
  }
  // 3) directory name
  return path.basename(cwd);
}

export type ExtraFlag =
  | { kind: 'value'; set: (value: string) => void }
  | { kind: 'boolean'; set: () => void };

/**
 * Shared parser for the flags every host handler uses:
 *   --dir <path>, --name <value>, --dry-run, --quiet, --yes / -y
 *
 * Pass `extra` to register host-specific flags. Examples:
 *   { '--rules': { kind: 'value', set: (v) => (rulesPath = v) } }
 *   { '--clean-all': { kind: 'boolean', set: () => (cleanAll = true) } }
 *
 * Unknown flags are silently ignored, matching the existing handlers.
 */
export function parseCommonFlags(
  args: string[],
  extra: Record<string, ExtraFlag> = {}
): CommonOptions {
  const options: CommonOptions = {};

  const requireValue = (flag: string, i: number): string => {
    if (i + 1 >= args.length) {
      console.error(`Error: ${flag} requires a value`);
      process.exit(1);
    }
    return args[i + 1];
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
        options.targetDir = requireValue('--dir', i);
        i += 1;
        break;
      case '--name':
        options.projectName = requireValue('--name', i);
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      default: {
        const handler = Object.prototype.hasOwnProperty.call(extra, arg) ? extra[arg] : undefined;
        if (!handler) break;
        if (handler.kind === 'boolean') {
          handler.set();
        } else {
          const value = requireValue(arg, i);
          handler.set(value);
          i += 1;
        }
      }
    }
  }

  return options;
}

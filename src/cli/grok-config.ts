import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { backupPath, log } from './host-toolkit.js';

export const GROK_MCP_SERVER_NAME = 'memory';

export interface GrokPaths {
  home: string;
  configPath: string;
  agentsPath: string;
}

export interface GrokAutoMemServerEntry {
  command: string;
  args: string[];
  enabled: boolean;
  env: Record<string, string>;
}

export interface UpsertOptions {
  dryRun?: boolean;
  quiet?: boolean;
  onlyIfAutoMem?: boolean;
}

export type UpsertMethod = 'toml' | 'dry-run';

export interface UpsertResult {
  method: UpsertMethod;
  changed: boolean;
}

export function resolveGrokPaths(opts: { dir?: string } = {}): GrokPaths {
  const home = opts.dir ?? process.env.GROK_HOME ?? path.join(os.homedir(), '.grok');
  return {
    home,
    configPath: path.join(home, 'config.toml'),
    agentsPath: path.join(home, 'AGENTS.md'),
  };
}

export function buildGrokAutoMemServerEntry(
  endpoint: string,
  apiKey?: string
): GrokAutoMemServerEntry {
  const env: Record<string, string> = {
    AUTOMEM_API_URL: endpoint,
    AUTOMEM_PROCESS_TAG: 'grok:memory',
  };
  if (apiKey) {
    env.AUTOMEM_API_KEY = apiKey;
  }
  return {
    command: 'npx',
    args: ['-y', '@verygoodplugins/mcp-automem'],
    enabled: true,
    env,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a as Record<string, unknown>).sort();
  const kb = Object.keys(b as Record<string, unknown>).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[ka[i]], (b as Record<string, unknown>)[kb[i]])) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Best-effort 0600. Windows and exotic filesystems have no POSIX mode to set. */
function restrictToOwner(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Non-POSIX platform; nothing to tighten.
  }
}

/**
 * Whether an mcp_servers entry carries an API key.
 *
 * Secrecy is a property of the *file*, not of the entry being written, so every path
 * that touches config.toml has to consider both the incoming entry and whatever is
 * already on disk. Two ways to get this wrong, both real: a file that already holds a
 * key and is not being changed still needs tightening, and a backup taken while
 * removing or replacing a key still contains it.
 */
function entryHasApiKey(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const env = entry.env;
  return isRecord(env) && typeof env.AUTOMEM_API_KEY === 'string' && env.AUTOMEM_API_KEY.length > 0;
}

function isAutoMemMcpEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const haystack = JSON.stringify({
    command: entry.command,
    args: entry.args,
    env: entry.env,
  });
  return haystack.includes('@verygoodplugins/mcp-automem') || haystack.includes('mcp-automem');
}

function parseGrokDocument(raw: string, configPath: string): Record<string, unknown> {
  try {
    const parsed = parseToml(raw || '') as unknown;
    if (parsed === null || parsed === undefined) return {};
    if (!isRecord(parsed)) {
      throw new Error('root value must be a table');
    }
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse Grok config at ${configPath}: ${reason}. Fix the TOML syntax and re-run.`,
      { cause: error }
    );
  }
}

const MEMORY_TABLE_HEADER = new RegExp(`^\\s*\\[mcp_servers\\.${GROK_MCP_SERVER_NAME}\\]\\s*$`);
const MEMORY_SUBTABLE_HEADER = new RegExp(
  `^\\s*\\[mcp_servers\\.${GROK_MCP_SERVER_NAME}\\.[^\\]]+\\]\\s*$`
);
const ANY_TABLE_HEADER = /^\s*\[/;

/**
 * Byte range of the `[mcp_servers.memory]` table and its sub-tables, as line indices
 * into `lines`. Null when the entry is absent or expressed some other way (inline
 * table, dotted keys) — callers fall back to a whole-document rewrite.
 */
function locateMemoryTableLines(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => MEMORY_TABLE_HEADER.test(line));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!ANY_TABLE_HEADER.test(lines[i])) continue;
    // `[mcp_servers.memory.env]` and friends belong to the block we are replacing.
    if (MEMORY_SUBTABLE_HEADER.test(lines[i])) continue;
    end = i;
    break;
  }

  // Trim trailing blank lines back to the owning block so replacement doesn't
  // accumulate or swallow the separator before the next table.
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1;
  return { start, end };
}

/** Serialize just the AutoMem entry, as its own `[mcp_servers.memory]` table block. */
function renderMemoryTableBlock(entry: GrokAutoMemServerEntry): string[] {
  return stringifyToml({ mcp_servers: { [GROK_MCP_SERVER_NAME]: entry } })
    .replace(/\n+$/, '')
    .split('\n');
}

/**
 * Rewrite `configPath` by splicing only the AutoMem table, leaving every other byte
 * of the user's config untouched.
 *
 * Grok configs are hand-maintained and carry things a parse/stringify round-trip
 * destroys: comments, multi-line `"""` subagent instructions (which collapse into
 * escaped one-liners), and array formatting. So the parsed document is used only to
 * decide *what* to write; the file itself is edited as text.
 *
 * Returns null when the splice can't be verified, so the caller can fall back.
 */
function spliceMemoryTable(
  raw: string,
  expected: Record<string, unknown>,
  next: string[]
): string | null {
  const lines = raw.split('\n');
  const located = locateMemoryTableLines(lines);

  let spliced: string[];
  if (located) {
    const before = lines.slice(0, located.start);
    const after = lines.slice(located.end);
    // Removing a table mid-file leaves the blank line that preceded it next to the
    // one that followed it. TOML ignores the extra blank, so the verify below would
    // accept it and every install/uninstall cycle would add another. Collapse the seam.
    if (
      next.length === 0 &&
      before.length > 0 &&
      after.length > 0 &&
      before[before.length - 1].trim() === '' &&
      after[0].trim() === ''
    ) {
      before.pop();
    }
    spliced = [...before, ...next, ...after];
  } else {
    // No existing table: append, keeping exactly one blank line as separator.
    const head = [...lines];
    while (head.length > 0 && head[head.length - 1].trim() === '') head.pop();
    spliced = head.length > 0 ? [...head, '', ...next] : [...next];
  }

  const candidate = `${spliced.join('\n').replace(/\n+$/, '')}\n`;

  // Verify by round-tripping: the spliced text must parse, and must parse to exactly
  // the document we intended. This is what makes the line-scanning above safe — a
  // table header matched inside a multi-line string would fail this check, not corrupt
  // the user's file.
  try {
    const reparsed = parseToml(candidate) as unknown;
    if (!isRecord(reparsed)) return null;
    if (!deepEqual(reparsed, expected)) return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Merge AutoMem into ~/.grok/config.toml under `mcp_servers.memory`, preserving
 * unrelated servers and top-level keys. Returns whether the file changed.
 */
export function upsertGrokMemoryServer(
  configPath: string,
  entry: GrokAutoMemServerEntry,
  opts: UpsertOptions = {}
): UpsertResult {
  const existed = fs.existsSync(configPath);
  const raw = existed ? fs.readFileSync(configPath, 'utf8') : '';
  // Parse even on dry runs: it is the only way to report add-vs-update-vs-unchanged
  // honestly, and a malformed config should fail the preview, not just the real run.
  const doc = parseGrokDocument(raw, configPath);

  const servers = isRecord(doc.mcp_servers)
    ? { ...(doc.mcp_servers as Record<string, unknown>) }
    : {};
  const existing = servers[GROK_MCP_SERVER_NAME] ?? null;

  // `memory` is a plausible name for someone else's MCP server. Uninstall already
  // refuses to touch a non-AutoMem entry (`onlyIfAutoMem`); install must be just as
  // careful, or it silently destroys a working integration. Checked before the
  // dry-run branch so a preview surfaces the collision too.
  if (existing !== null && !isAutoMemMcpEntry(existing)) {
    throw new Error(
      `Refusing to overwrite mcp_servers.${GROK_MCP_SERVER_NAME} in ${configPath}: ` +
        'it points at a server that is not AutoMem. Rename or remove that entry, ' +
        'then re-run — AutoMem will not replace it.'
    );
  }

  // The file is secret-bearing if either side holds a key: the entry being written, or
  // what is already on disk (which the backup below will also contain).
  const holdsSecret = entryHasApiKey(existing) || entryHasApiKey(entry);

  if (deepEqual(existing, entry)) {
    // Nothing to write, but a hand-written config carrying a key can still be 0644 —
    // returning early used to leave it that way.
    if (holdsSecret && !opts.dryRun) restrictToOwner(configPath);
    log(
      `✓ Unchanged: ${path.basename(configPath)} (mcp_servers.${GROK_MCP_SERVER_NAME})`,
      opts.quiet
    );
    return { method: opts.dryRun ? 'dry-run' : 'toml', changed: false };
  }

  servers[GROK_MCP_SERVER_NAME] = entry;
  doc.mcp_servers = servers;

  if (opts.dryRun) {
    const verb = existing ? 'update' : 'add';
    log(
      `[DRY RUN] Would ${verb} mcp_servers.${GROK_MCP_SERVER_NAME} in: ${configPath}`,
      opts.quiet
    );
    return { method: 'dry-run', changed: false };
  }

  const spliced = existed ? spliceMemoryTable(raw, doc, renderMemoryTableBlock(entry)) : null;
  if (existed && !spliced) {
    // Fall back loudly: the rewrite is correct but reformats the whole document,
    // dropping comments and collapsing multi-line strings.
    log(
      `⚠️  Could not edit mcp_servers.${GROK_MCP_SERVER_NAME} in place in ${path.basename(configPath)} — rewriting the whole file.`,
      opts.quiet
    );
    log(
      '   Comments and multi-line string formatting will be lost (a backup is kept).',
      opts.quiet
    );
  }
  const serialized = spliced ?? stringifyToml(doc);
  // A config carrying AUTOMEM_API_KEY is a secret file. Writing it under a typical 022
  // umask would leave it 0644 and readable by other local accounts, so match the 0600
  // treatment host-toolkit gives secret writes. `holdsSecret` covers the outgoing key
  // too: switching endpoints drops the key from the new entry, but `copyFileSync`
  // preserves the source mode, so the backup would keep the old credential world-readable.

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (existed) {
    const backup = backupPath(configPath);
    fs.copyFileSync(configPath, backup);
    if (holdsSecret) restrictToOwner(backup);
    log(`📦 Backup created: ${backup}`, opts.quiet);
  }
  fs.writeFileSync(
    configPath,
    serialized,
    holdsSecret ? { encoding: 'utf8', mode: 0o600 } : 'utf8'
  );
  // writeFileSync's mode only applies when it creates the file, so an existing
  // 0644 config keeps its permissions without this.
  if (holdsSecret) restrictToOwner(configPath);
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(configPath)}`, opts.quiet);
  return { method: 'toml', changed: true };
}

/**
 * Remove `mcp_servers.memory` when it points at AutoMem (or always when
 * onlyIfAutoMem is false). Returns true if a change was written.
 */
export function removeGrokMemoryServer(configPath: string, opts: UpsertOptions = {}): boolean {
  if (!fs.existsSync(configPath)) return false;
  const raw = fs.readFileSync(configPath, 'utf8');
  const doc = parseGrokDocument(raw, configPath);
  if (!isRecord(doc.mcp_servers)) return false;
  if (!(GROK_MCP_SERVER_NAME in doc.mcp_servers)) return false;

  const entry = (doc.mcp_servers as Record<string, unknown>)[GROK_MCP_SERVER_NAME];
  if (opts.onlyIfAutoMem && !isAutoMemMcpEntry(entry)) {
    return false;
  }

  if (opts.dryRun) {
    log(
      `[DRY RUN] Would remove mcp_servers.${GROK_MCP_SERVER_NAME} from: ${configPath}`,
      opts.quiet
    );
    return false;
  }

  const servers = { ...(doc.mcp_servers as Record<string, unknown>) };
  delete servers[GROK_MCP_SERVER_NAME];
  if (Object.keys(servers).length === 0) {
    delete doc.mcp_servers;
  } else {
    doc.mcp_servers = servers;
  }

  // Splice out just the AutoMem table so the rest of the config keeps its comments
  // and formatting; fall back to a full rewrite only when that can't be verified.
  const spliced = spliceMemoryTable(raw, doc, []);
  if (!spliced) {
    log(
      `⚠️  Could not remove mcp_servers.${GROK_MCP_SERVER_NAME} in place in ${path.basename(configPath)} — rewriting the whole file.`,
      opts.quiet
    );
    log(
      '   Comments and multi-line string formatting will be lost (a backup is kept).',
      opts.quiet
    );
  }

  const backup = backupPath(configPath);
  fs.copyFileSync(configPath, backup);
  // Uninstalling a keyed entry leaves the credential in the backup, and copyFileSync
  // preserves the source's mode — so a 0644 config yields a 0644 copy of the secret.
  if (entryHasApiKey(entry)) restrictToOwner(backup);
  fs.writeFileSync(configPath, spliced ?? stringifyToml(doc), 'utf8');
  log(
    `🗑️  Removed mcp_servers.${GROK_MCP_SERVER_NAME} from ${path.basename(configPath)}`,
    opts.quiet
  );
  log(`   Backup: ${backup}`, opts.quiet);
  return true;
}

/**
 * Grok's top-level `disabled_mcp_servers` list wins over a server's own `enabled`
 * flag, so a config can carry a perfectly valid `[mcp_servers.memory]` that Grok
 * never loads. Returns the list so callers can warn instead of reporting success.
 */
export function readDisabledMcpServers(configPath: string): string[] {
  if (!fs.existsSync(configPath)) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = parseGrokDocument(fs.readFileSync(configPath, 'utf8'), configPath);
  } catch {
    return [];
  }
  const disabled = parsed.disabled_mcp_servers;
  if (!Array.isArray(disabled)) return [];
  return disabled.filter((name): name is string => typeof name === 'string');
}

export interface GrokCredentials {
  endpoint?: string;
  apiKey?: string;
}

function normalizeCred(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read AutoMem credentials already installed for Grok so a re-run with no
 * explicit flags preserves them rather than overwriting with defaults.
 */
export function readExistingGrokCredentials(configPath: string): GrokCredentials {
  if (!fs.existsSync(configPath)) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = parseGrokDocument(fs.readFileSync(configPath, 'utf8'), configPath);
  } catch {
    return {};
  }
  const servers = isRecord(parsed.mcp_servers)
    ? (parsed.mcp_servers as Record<string, unknown>)
    : null;
  const entry =
    servers && isRecord(servers[GROK_MCP_SERVER_NAME])
      ? (servers[GROK_MCP_SERVER_NAME] as Record<string, unknown>)
      : null;
  const env = entry && isRecord(entry.env) ? (entry.env as Record<string, unknown>) : null;
  if (!env) return {};
  return {
    endpoint: normalizeCred(env.AUTOMEM_API_URL) ?? normalizeCred(env.AUTOMEM_ENDPOINT),
    apiKey: normalizeCred(env.AUTOMEM_API_KEY),
  };
}

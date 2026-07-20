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

/**
 * Merge AutoMem into ~/.grok/config.toml under `mcp_servers.memory`, preserving
 * unrelated servers and top-level keys. Returns whether the file changed.
 */
export function upsertGrokMemoryServer(
  configPath: string,
  entry: GrokAutoMemServerEntry,
  opts: UpsertOptions = {}
): UpsertResult {
  if (opts.dryRun) {
    log(`[DRY RUN] Would upsert mcp_servers.${GROK_MCP_SERVER_NAME} in: ${configPath}`, opts.quiet);
    return { method: 'dry-run', changed: false };
  }

  const existed = fs.existsSync(configPath);
  const raw = existed ? fs.readFileSync(configPath, 'utf8') : '';
  const doc = parseGrokDocument(raw, configPath);

  const servers = isRecord(doc.mcp_servers)
    ? { ...(doc.mcp_servers as Record<string, unknown>) }
    : {};
  const existing = servers[GROK_MCP_SERVER_NAME] ?? null;

  if (deepEqual(existing, entry)) {
    log(
      `✓ Unchanged: ${path.basename(configPath)} (mcp_servers.${GROK_MCP_SERVER_NAME})`,
      opts.quiet
    );
    return { method: 'toml', changed: false };
  }

  servers[GROK_MCP_SERVER_NAME] = entry;
  doc.mcp_servers = servers;
  const serialized = stringifyToml(doc);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (existed) {
    const backup = backupPath(configPath);
    fs.copyFileSync(configPath, backup);
    log(`📦 Backup created: ${backup}`, opts.quiet);
  }
  fs.writeFileSync(configPath, serialized, 'utf8');
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

  const backup = backupPath(configPath);
  fs.copyFileSync(configPath, backup);
  fs.writeFileSync(configPath, stringifyToml(doc), 'utf8');
  log(
    `🗑️  Removed mcp_servers.${GROK_MCP_SERVER_NAME} from ${path.basename(configPath)}`,
    opts.quiet
  );
  log(`   Backup: ${backup}`, opts.quiet);
  return true;
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

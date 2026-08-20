import fs from 'fs';
import { parse as parseDotenv } from 'dotenv';
import os from 'os';
import path from 'path';
import { parse as parseYaml, parseDocument } from 'yaml';
import {
  AUTOMEM_API_KEY_NAMES,
  backupPath,
  isAutoMemServerEntry,
  log,
  readApiKeyFrom,
  readEndpointFrom,
  sameEndpoint,
} from './host-toolkit.js';

export interface HermesPaths {
  home: string;
  configPath: string;
  agentsPath: string;
}

export interface AutoMemServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  tools: {
    include: string[];
    resources: boolean;
    prompts: boolean;
  };
  sampling: {
    enabled: boolean;
  };
}

export interface UpsertOptions {
  dryRun?: boolean;
  quiet?: boolean;
  onlyIfAutoMem?: boolean;
}

export type UpsertMethod = 'yaml' | 'dry-run';

export interface UpsertResult {
  method: UpsertMethod;
  changed: boolean;
}

/**
 * Parse a Hermes config document, turning malformed user YAML into an
 * actionable, file-scoped error instead of a corrupted round-trip. `yaml`'s
 * `parseDocument` does not throw — it collects problems in `doc.errors` — so we
 * surface those (and any thrown error, defensively) with a fix-and-re-run hint.
 */
function parseHermesDocument(raw: string, configPath: string) {
  let doc;
  try {
    doc = parseDocument(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse Hermes config at ${configPath}: ${reason}. Fix the YAML syntax and re-run.`,
      { cause: error }
    );
  }
  if (doc.errors.length > 0) {
    const reason = doc.errors.map((err) => err.message).join('; ');
    throw new Error(
      `Failed to parse Hermes config at ${configPath}: ${reason}. Fix the YAML syntax and re-run.`
    );
  }
  return doc;
}

export function resolveHermesPaths(opts: { dir?: string } = {}): HermesPaths {
  const home = opts.dir ?? process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes');
  return {
    home,
    configPath: path.join(home, 'config.yaml'),
    agentsPath: path.join(home, 'AGENTS.md'),
  };
}

export function buildAutoMemServerEntry(endpoint: string, apiKey?: string): AutoMemServerEntry {
  const env: Record<string, string> = {
    AUTOMEM_API_URL: endpoint,
  };
  if (apiKey) {
    env.AUTOMEM_API_KEY = apiKey;
  } else {
    // Explicit blanks, not omission — the host layers this env over its own when it
    // launches the server, so an omitted key leaves a shell-exported one inherited by
    // a child pointed at a different endpoint. See buildGrokAutoMemServerEntry.
    for (const name of AUTOMEM_API_KEY_NAMES) env[name] = '';
  }
  return {
    command: 'npx',
    args: ['-y', '@verygoodplugins/mcp-automem'],
    env,
    tools: {
      include: [
        'recall_memory',
        'store_memory',
        'associate_memories',
        'update_memory',
        'check_database_health',
      ],
      resources: false,
      prompts: false,
    },
    sampling: {
      enabled: false,
    },
  };
}

export interface HermesCredentials {
  endpoint?: string;
  apiKey?: string;
}

function readCredentialsFromConfig(configPath: string): HermesCredentials {
  if (!fs.existsSync(configPath)) return {};
  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseYaml(fs.readFileSync(configPath, 'utf8') || '{}') as Record<
      string,
      unknown
    > | null;
  } catch {
    return {};
  }
  const servers = isRecord(parsed?.mcp_servers)
    ? (parsed!.mcp_servers as Record<string, unknown>)
    : null;
  // The AutoMem MCP server is always registered under the `automem` key.
  const entry =
    servers && isRecord(servers.automem) ? (servers.automem as Record<string, unknown>) : null;
  const env = entry && isRecord(entry.env) ? (entry.env as Record<string, unknown>) : null;
  if (!env) return {};
  return {
    // Both deprecated aliases are honored on read — the runtime still accepts
    // AUTOMEM_ENDPOINT and AUTOMEM_API_TOKEN, so a hand-migrated or Railway-templated
    // config must survive a setup re-run instead of being reset to the default
    // endpoint or rewritten without its credential.
    endpoint: readEndpointFrom(env),
    apiKey: readApiKeyFrom(env),
  };
}

/**
 * Read the provider `.env`'s effective credentials.
 *
 * Parsed by dotenv, which is what Hermes itself loads this file with. The invariant
 * across this repo: a reader whose values drive a decision uses dotenv semantics,
 * while the writers stay line-based so comments and formatting survive a partial
 * update. Hand-parsing here unwrapped only double quotes and never stripped comments,
 * so `AUTOMEM_API_URL='https://x'` or a trailing `# comment` compared as a different
 * endpoint and a same-endpoint re-run deleted a valid key. Both deprecated aliases are
 * still honoured on read via the shared both-name readers.
 */
function readCredentialsFromEnvFile(envPath: string): HermesCredentials {
  if (!fs.existsSync(envPath)) return {};
  const values = parseDotenv(fs.readFileSync(envPath, 'utf8'));
  return { endpoint: readEndpointFrom(values), apiKey: readApiKeyFrom(values) };
}

/**
 * Read AutoMem credentials already installed for Hermes so a re-run with no
 * explicit flags or env vars preserves them rather than overwriting with the
 * built-in default endpoint and a blank key. Reads the MCP server entry
 * (config.yaml `mcp_servers.automem.env`) first, then the provider `.env`;
 * both are written with identical values in `both` mode. Empty strings
 * normalize to `undefined` so they never satisfy a `??` fallback.
 *
 * Endpoint and key are returned **as a pair from one source**. Merging them
 * field-wise used to be possible — config endpoint plus `.env` key — and the two
 * files can describe different installs: switch the MCP config to endpoint A and a
 * provider `.env` still holding endpoint B's token makes `{A, B's key}` look like a
 * credential issued for A. `resolveInheritedApiKey` would then treat it as a valid
 * stored pair and write B's token into A's registration, which is precisely the
 * disclosure the pairing exists to prevent.
 */
export function readExistingHermesCredentials(paths: HermesPaths): HermesCredentials {
  const fromConfig = readCredentialsFromConfig(paths.configPath);
  const fromEnv = readCredentialsFromEnvFile(path.join(paths.home, '.env'));

  if (fromConfig.endpoint) {
    return {
      endpoint: fromConfig.endpoint,
      // The `.env` key is only the same credential when it was written for the same
      // endpoint — which is the normal case, since `both` mode writes both files with
      // identical values.
      apiKey:
        fromConfig.apiKey ??
        (sameEndpoint(fromEnv.endpoint, fromConfig.endpoint) ? fromEnv.apiKey : undefined),
    };
  }
  if (fromEnv.endpoint) return fromEnv;

  // Neither source names an endpoint, so there is no pair to keep whole. A stored key
  // with no stored endpoint is dropped downstream regardless.
  return { endpoint: undefined, apiKey: fromConfig.apiKey ?? fromEnv.apiKey };
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

const isAutoMemMcpEntry = isAutoMemServerEntry;

/**
 * Merge an MCP server entry into ~/.hermes/config.yaml under `mcp_servers.<name>`,
 * preserving comments and any other servers present. Returns true if the file
 * actually changed on disk.
 */
function upsertViaYaml(
  configPath: string,
  name: string,
  entry: AutoMemServerEntry,
  opts: UpsertOptions
): boolean {
  const existed = fs.existsSync(configPath);
  const raw = existed ? fs.readFileSync(configPath, 'utf8') : '';

  // Read existing entry (if any) to short-circuit no-op writes.
  let existing: unknown;
  try {
    const parsed = parseYaml(raw || '{}') as Record<string, unknown> | null;
    existing =
      parsed?.mcp_servers && typeof parsed.mcp_servers === 'object'
        ? ((parsed.mcp_servers as Record<string, unknown>)[name] ?? null)
        : null;
  } catch {
    existing = null;
  }

  if (deepEqual(existing, entry)) {
    log(`✓ Unchanged: ${path.basename(configPath)} (mcp_servers.${name})`, opts.quiet);
    return false;
  }

  // Seed an empty mcp_servers map when starting from scratch so setIn always
  // has a real Map node to traverse into. parseDocument preserves comments on
  // round-trip when the input is non-empty.
  const doc =
    raw.trim().length > 0
      ? parseHermesDocument(raw, configPath)
      : parseDocument('mcp_servers: {}\n');
  doc.setIn(['mcp_servers', name], doc.createNode(entry));
  // Force block-style serialization (`key:\n  value`) — Hermes' YAML loader
  // and most human readers expect block, not flow (`{key: value}`).
  const serialized = doc.toString({ collectionStyle: 'block' });

  if (opts.dryRun) {
    log(`[DRY RUN] Would write: ${configPath}`, opts.quiet);
    return false;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (existed) {
    const backup = backupPath(configPath);
    fs.copyFileSync(configPath, backup);
    log(`📦 Backup created: ${backup}`, opts.quiet);
  }
  fs.writeFileSync(configPath, serialized, 'utf8');
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(configPath)}`, opts.quiet);
  return true;
}

/**
 * Register an MCP server into ~/.hermes/config.yaml. We write the YAML directly
 * rather than shelling out to `hermes mcp add`: the CLI's argparse `--args`
 * (nargs='*') cannot accept a value beginning with `-` (our entry needs
 * `npx -y @verygoodplugins/mcp-automem`), and driving it via execSync would also
 * echo the API key to the terminal. Direct YAML editing is comment-preserving,
 * idempotent, and is exactly what `hermes mcp list` reads back.
 */
export async function upsertMcpServer(
  paths: HermesPaths,
  name: string,
  entry: AutoMemServerEntry,
  opts: UpsertOptions = {}
): Promise<UpsertResult> {
  if (opts.dryRun) {
    log(`[DRY RUN] Would upsert mcp_servers.${name} in: ${paths.configPath}`, opts.quiet);
    return { method: 'dry-run', changed: false };
  }

  const changed = upsertViaYaml(paths.configPath, name, entry, opts);
  return { method: 'yaml', changed };
}

export function upsertHermesMemoryProvider(
  configPath: string,
  provider: string,
  opts: UpsertOptions = {}
): boolean {
  const existed = fs.existsSync(configPath);
  const raw = existed ? fs.readFileSync(configPath, 'utf8') : '';

  let existing: unknown;
  try {
    const parsed = parseYaml(raw || '{}') as Record<string, unknown> | null;
    existing =
      parsed?.memory && typeof parsed.memory === 'object'
        ? ((parsed.memory as Record<string, unknown>).provider ?? null)
        : null;
  } catch {
    existing = null;
  }

  if (existing === provider) {
    log(`✓ Unchanged: ${path.basename(configPath)} (memory.provider)`, opts.quiet);
    return false;
  }

  const doc =
    raw.trim().length > 0 ? parseHermesDocument(raw, configPath) : parseDocument('memory: {}\n');
  doc.setIn(['memory', 'provider'], provider);
  const serialized = doc.toString({ collectionStyle: 'block' });

  if (opts.dryRun) {
    log(`[DRY RUN] Would write memory.provider=${provider} in: ${configPath}`, opts.quiet);
    return false;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (existed) {
    const backup = backupPath(configPath);
    fs.copyFileSync(configPath, backup);
    log(`📦 Backup created: ${backup}`, opts.quiet);
  }
  fs.writeFileSync(configPath, serialized, 'utf8');
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(configPath)}`, opts.quiet);
  return true;
}

/**
 * Remove an MCP server entry from ~/.hermes/config.yaml. Returns true if a
 * change was written.
 */
export function removeMcpServerEntry(
  configPath: string,
  name: string,
  opts: UpsertOptions = {}
): boolean {
  if (!fs.existsSync(configPath)) return false;
  const raw = fs.readFileSync(configPath, 'utf8');
  const doc = parseHermesDocument(raw, configPath);
  const servers = doc.getIn(['mcp_servers']);
  if (!servers || !doc.hasIn(['mcp_servers', name])) {
    return false;
  }
  const parsed = parseYaml(raw || '{}') as Record<string, unknown> | null;
  const entry =
    parsed?.mcp_servers && typeof parsed.mcp_servers === 'object'
      ? (parsed.mcp_servers as Record<string, unknown>)[name]
      : undefined;
  if (opts.onlyIfAutoMem && !isAutoMemMcpEntry(entry)) {
    return false;
  }

  if (opts.dryRun) {
    log(`[DRY RUN] Would remove mcp_servers.${name} from: ${configPath}`, opts.quiet);
    return false;
  }

  doc.deleteIn(['mcp_servers', name]);
  const backup = backupPath(configPath);
  fs.copyFileSync(configPath, backup);
  fs.writeFileSync(configPath, doc.toString({ collectionStyle: 'block' }), 'utf8');
  log(`🗑️  Removed mcp_servers.${name} from ${path.basename(configPath)}`, opts.quiet);
  log(`   Backup: ${backup}`, opts.quiet);
  return true;
}

export function removeHermesMemoryProvider(
  configPath: string,
  provider: string,
  opts: UpsertOptions = {}
): boolean {
  if (!fs.existsSync(configPath)) return false;
  const raw = fs.readFileSync(configPath, 'utf8');
  const doc = parseHermesDocument(raw, configPath);
  const current = doc.getIn(['memory', 'provider']);
  if (current !== provider) {
    return false;
  }

  if (opts.dryRun) {
    log(`[DRY RUN] Would clear memory.provider=${provider} from: ${configPath}`, opts.quiet);
    return false;
  }

  doc.setIn(['memory', 'provider'], '');
  const backup = backupPath(configPath);
  fs.copyFileSync(configPath, backup);
  fs.writeFileSync(configPath, doc.toString({ collectionStyle: 'block' }), 'utf8');
  log(`🗑️  Cleared memory.provider=${provider} from ${path.basename(configPath)}`, opts.quiet);
  log(`   Backup: ${backup}`, opts.quiet);
  return true;
}

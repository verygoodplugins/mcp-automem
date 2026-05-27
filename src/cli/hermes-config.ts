import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { parse as parseYaml, stringify as stringifyYaml, parseDocument } from 'yaml';
import { backupPath, log } from './host-toolkit.js';

export interface HermesPaths {
  home: string;
  configPath: string;
  agentsPath: string;
}

export interface AutoMemServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface UpsertOptions {
  dryRun?: boolean;
  quiet?: boolean;
}

export type UpsertMethod = 'hermes-cli' | 'yaml-fallback' | 'dry-run';

export interface UpsertResult {
  method: UpsertMethod;
  changed: boolean;
}

export function resolveHermesPaths(opts: { dir?: string } = {}): HermesPaths {
  const home =
    opts.dir ??
    process.env.HERMES_HOME ??
    path.join(os.homedir(), '.hermes');
  return {
    home,
    configPath: path.join(home, 'config.yaml'),
    agentsPath: path.join(home, 'AGENTS.md'),
  };
}

export function buildAutoMemServerEntry(
  endpoint: string,
  apiKey?: string,
): AutoMemServerEntry {
  const env: Record<string, string> = {
    AUTOMEM_API_URL: endpoint,
  };
  if (apiKey) {
    env.AUTOMEM_API_KEY = apiKey;
  }
  return {
    command: 'npx',
    args: ['-y', '@verygoodplugins/mcp-automem'],
    env,
  };
}

/**
 * Probe whether the local Hermes CLI exposes an `mcp add` subcommand we can drive.
 * Returns false on any failure (binary missing, non-zero exit, missing verb in help).
 */
export function detectHermesCliMcpAdd(): boolean {
  try {
    const help = execSync('hermes mcp --help', {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /\badd\b/i.test(help);
  } catch {
    return false;
  }
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

/**
 * Merge an MCP server entry into ~/.hermes/config.yaml under `mcp_servers.<name>`,
 * preserving comments and any other servers present. Returns true if the file
 * actually changed on disk.
 */
function upsertViaYaml(
  configPath: string,
  name: string,
  entry: AutoMemServerEntry,
  opts: UpsertOptions,
): boolean {
  const existed = fs.existsSync(configPath);
  const raw = existed ? fs.readFileSync(configPath, 'utf8') : '';

  // Read existing entry (if any) to short-circuit no-op writes.
  let existing: unknown = null;
  try {
    const parsed = parseYaml(raw || '{}') as Record<string, unknown> | null;
    existing = parsed?.mcp_servers && typeof parsed.mcp_servers === 'object'
      ? (parsed.mcp_servers as Record<string, unknown>)[name] ?? null
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
  const doc = raw.trim().length > 0 ? parseDocument(raw) : parseDocument('mcp_servers: {}\n');
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
  log(
    `✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(configPath)}`,
    opts.quiet,
  );
  return true;
}

function upsertViaHermesCli(
  name: string,
  entry: AutoMemServerEntry,
  opts: UpsertOptions,
): boolean {
  // Build the Hermes command. The exact flag shape is conservative — we pass
  // env vars as repeated `--env KEY=VALUE` and args as repeated `--arg VALUE`.
  // If a user's Hermes version uses different flags, the call will fail and
  // the caller will fall back to YAML.
  const envFlags = Object.entries(entry.env)
    .map(([k, v]) => `--env ${JSON.stringify(`${k}=${v}`)}`)
    .join(' ');
  const argFlags = entry.args.map((a) => `--arg ${JSON.stringify(a)}`).join(' ');
  const cmd = `hermes mcp add ${JSON.stringify(name)} --command ${JSON.stringify(entry.command)} ${argFlags} ${envFlags}`;

  if (opts.dryRun) {
    log(`[DRY RUN] Would run: ${cmd}`, opts.quiet);
    return false;
  }

  execSync(cmd, { stdio: opts.quiet ? 'ignore' : 'inherit' });
  return true;
}

export async function upsertMcpServer(
  paths: HermesPaths,
  name: string,
  entry: AutoMemServerEntry,
  opts: UpsertOptions = {},
): Promise<UpsertResult> {
  if (opts.dryRun) {
    log(`[DRY RUN] Would upsert mcp_servers.${name} in: ${paths.configPath}`, opts.quiet);
    return { method: 'dry-run', changed: false };
  }

  if (detectHermesCliMcpAdd()) {
    try {
      const changed = upsertViaHermesCli(name, entry, opts);
      log(`✅ Registered mcp_servers.${name} via hermes CLI`, opts.quiet);
      return { method: 'hermes-cli', changed };
    } catch (error) {
      log(
        `⚠️  hermes mcp add failed (${(error as Error).message}); falling back to direct YAML edit`,
        opts.quiet,
      );
    }
  }

  const changed = upsertViaYaml(paths.configPath, name, entry, opts);
  return { method: 'yaml-fallback', changed };
}

/**
 * Remove an MCP server entry from ~/.hermes/config.yaml. Returns true if a
 * change was written.
 */
export function removeMcpServerEntry(
  configPath: string,
  name: string,
  opts: UpsertOptions = {},
): boolean {
  if (!fs.existsSync(configPath)) return false;
  const raw = fs.readFileSync(configPath, 'utf8');
  const doc = parseDocument(raw);
  const servers = doc.getIn(['mcp_servers']);
  if (!servers || !doc.hasIn(['mcp_servers', name])) {
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

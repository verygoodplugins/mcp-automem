import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { readAutoMemConnectionFile } from '../env.js';
import {
  isAutoMemServerEntry,
  isRecord,
  readApiKeyFrom,
  readEndpointFrom,
  resolveInheritedApiKey,
} from './host-toolkit.js';
import { removeGrokMemoryServer, upsertGrokMemoryServer } from './grok-config.js';
import { automemNpxArgs, DEFAULT_AUTOMEM_API_URL } from './templates.js';

const CONNECTION_OWNER = 'mcp-automem:codex';

export interface CodexPaths {
  home: string;
  configPath: string;
  connectionPath: string;
}

export function resolveCodexPaths(
  options: {
    dir?: string;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
  } = {}
): CodexPaths {
  const home = path.resolve(
    options.dir ??
      ((options.env ?? process.env).CODEX_HOME ||
        path.join(options.homeDir ?? os.homedir(), '.codex'))
  );
  return {
    home,
    configPath: path.join(home, 'config.toml'),
    connectionPath: path.join(home, 'automem', 'connection.json'),
  };
}

function existingEntry(configPath: string): unknown {
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const config = parseToml(fs.readFileSync(configPath, 'utf8'));
    if (config.mcp_servers !== undefined && !isRecord(config.mcp_servers)) {
      throw new Error('mcp_servers must be a table');
    }
    return isRecord(config.mcp_servers) ? config.mcp_servers.memory : undefined;
  } catch {
    // Do not echo parser text, which may include a credential from the file.
    throw new Error(
      `Failed to parse Codex MCP configuration at ${configPath}. Fix the TOML and re-run.`
    );
  }
}

function existingCredentials(configPath: string): { endpoint?: string; apiKey?: string } {
  const entry = existingEntry(configPath);
  if (!isAutoMemServerEntry(entry) || !isRecord(entry) || !isRecord(entry.env)) return {};
  const env = entry.env;
  if (typeof env.AUTOMEM_CONNECTION_FILE === 'string' && env.AUTOMEM_CONNECTION_FILE) {
    // A deleted private file cannot supply an old key. Allow a fresh installer
    // run to recreate it from newly supplied connection details.
    if (!fs.existsSync(env.AUTOMEM_CONNECTION_FILE)) return {};
    return (
      readAutoMemConnectionFile({ AUTOMEM_CONNECTION_FILE: env.AUTOMEM_CONNECTION_FILE }) ?? {}
    );
  }
  return { endpoint: readEndpointFrom(env), apiKey: readApiKeyFrom(env) };
}

function lstat(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertPrivateDestination(file: string): void {
  const dir = path.dirname(file);
  const directory = lstat(dir);
  if (directory && (directory.isSymbolicLink() || !directory.isDirectory())) {
    throw new Error(`Refusing to use ${dir}: it is a symlink or is not a directory.`);
  }
  const current = lstat(file);
  if (current?.isSymbolicLink()) throw new Error(`Refusing to replace the symlink ${file}.`);
  if (current && !current.isFile())
    throw new Error(`Refusing to replace ${file}: it is not a file.`);
  if (current) {
    try {
      const connection: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isRecord(connection) && connection.owner === CONNECTION_OWNER) return;
    } catch {
      // Do not overwrite a file whose ownership cannot be established.
    }
    throw new Error(`Refusing to replace ${file}: it is not an AutoMem-managed Codex connection.`);
  }
}

/** Replace a private file atomically; never leave a credential-bearing backup. */
function writePrivateConnection(file: string, content: string): void {
  assertPrivateDestination(file);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    return;
  }
  const temporary = path.join(dir, `.connection-${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, content, 'utf8');
      if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function configureCodexMemory(options: {
  paths: CodexPaths;
  endpoint?: string;
  apiKey?: string;
  dryRun?: boolean;
  quiet?: boolean;
}): void {
  const { paths } = options;
  // Validate the destination before reading a prior connection file: never follow
  // a symlink at the installer-owned path, even during a preview.
  assertPrivateDestination(paths.connectionPath);
  const existing = existingCredentials(paths.configPath);
  const endpoint =
    options.endpoint ||
    process.env.AUTOMEM_API_URL ||
    process.env.AUTOMEM_ENDPOINT ||
    existing.endpoint ||
    DEFAULT_AUTOMEM_API_URL;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('The Codex AutoMem endpoint must be an HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('The Codex AutoMem endpoint must be an HTTP or HTTPS URL.');
  const apiKey = resolveInheritedApiKey({
    endpoint,
    explicitKey: options.apiKey,
    storedEndpoint: existing.endpoint,
    storedKey: existing.apiKey,
  });
  const entry = {
    command: 'npx',
    args: automemNpxArgs(),
    enabled: true,
    // The server loads .env from its working directory. Keep it out of the
    // user's project so that dotenv cannot copy the project API key into the
    // MCP process environment or override the selected connection.
    cwd: path.dirname(paths.connectionPath),
    env: {
      AUTOMEM_CONNECTION_FILE: paths.connectionPath,
      AUTOMEM_API_URL: '',
      AUTOMEM_ENDPOINT: '',
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
      CLAUDE_PLUGIN_OPTION_API_URL: '',
      CLAUDE_PLUGIN_OPTION_api_url: '',
      CLAUDE_PLUGIN_OPTION_API_KEY: '',
      CLAUDE_PLUGIN_OPTION_api_key: '',
      CLAUDE_PLUGIN_OPTION_API_TOKEN: '',
      CLAUDE_PLUGIN_OPTION_api_token: '',
    },
  };
  const settings = { quiet: options.quiet, host: 'Codex' as const, preserveFormatting: true };
  // Detect collisions, malformed TOML and unspliceable layouts before touching
  // the private connection or project rules.
  upsertGrokMemoryServer(paths.configPath, entry, { ...settings, dryRun: true });
  if (options.dryRun) return;

  const previous = fs.existsSync(paths.connectionPath)
    ? fs.readFileSync(paths.connectionPath, 'utf8')
    : undefined;
  const content = `${JSON.stringify({ owner: CONNECTION_OWNER, endpoint, apiKey: apiKey ?? '' })}\n`;
  writePrivateConnection(paths.connectionPath, content);
  try {
    upsertGrokMemoryServer(paths.configPath, entry, settings);
  } catch (error) {
    // A failed config write must not silently repoint a previously working entry.
    if (previous === undefined) fs.rmSync(paths.connectionPath, { force: true });
    else writePrivateConnection(paths.connectionPath, previous);
    throw error;
  }
}

export function removeCodexMemory(options: {
  paths: CodexPaths;
  dryRun?: boolean;
  quiet?: boolean;
}): void {
  const { paths } = options;
  const entry = existingEntry(paths.configPath);
  if (entry !== undefined && !isAutoMemServerEntry(entry)) return;
  if (entry !== undefined) {
    removeGrokMemoryServer(paths.configPath, {
      dryRun: options.dryRun,
      quiet: options.quiet,
      host: 'Codex',
      preserveFormatting: true,
      onlyIfAutoMem: true,
    });
  }
  if (fs.existsSync(paths.configPath)) {
    const config = parseToml(fs.readFileSync(paths.configPath, 'utf8'));
    const servers = isRecord(config.mcp_servers) ? config.mcp_servers : {};
    if (
      Object.entries(servers).some(
        ([name, server]) =>
          name !== 'memory' &&
          isRecord(server) &&
          isRecord(server.env) &&
          server.env.AUTOMEM_CONNECTION_FILE === paths.connectionPath
      )
    )
      return;
  }
  // Delete only our own private file and never follow a symlink. The file is not
  // backed up because that would retain credentials after uninstall.
  const stat = lstat(paths.connectionPath);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return;
  try {
    const connection: unknown = JSON.parse(fs.readFileSync(paths.connectionPath, 'utf8'));
    if (!isRecord(connection) || connection.owner !== CONNECTION_OWNER) return;
  } catch {
    return;
  }
  if (!options.dryRun) {
    fs.unlinkSync(paths.connectionPath);
    try {
      // The directory belongs to the installer only while empty. Never remove
      // unrelated files a user has placed alongside the connection.
      fs.rmdirSync(path.dirname(paths.connectionPath));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOENT') throw error;
    }
  }
  if (!options.quiet) {
    console.log(
      `${options.dryRun ? '[DRY RUN] Would remove' : '🗑️  Removed'} private Codex connection: ${paths.connectionPath}`
    );
  }
}

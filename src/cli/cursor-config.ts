import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isAutoMemServerEntry,
  readApiKeyFrom,
  readEndpointFrom,
  resolveInheritedApiKey,
  writeFileWithBackup,
} from './host-toolkit.js';
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';

type Document = Record<string, unknown>;
export type CursorWriteOptions = { dryRun?: boolean; quiet?: boolean };
export const CURSOR_SESSION_COMMAND = 'node ".cursor/hooks/automem-session-start.mjs"';

export function isRecord(value: unknown): value is Document {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Never echo parse errors: newer Node versions include credential-bearing input. */
export function readCursorDocument(filePath: string, field: 'mcpServers' | 'hooks'): Document {
  if (!fs.existsSync(filePath)) return {};
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`Cannot read valid JSON from ${filePath}. Fix the file and re-run.`);
  }
  if (!isRecord(doc) || (doc[field] !== undefined && !isRecord(doc[field]))) {
    throw new Error(`Expected a JSON object with an optional ${field} object in ${filePath}.`);
  }
  return doc;
}

export function cursorMcpConfigPath(): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

export function planCursorMcpSetup(
  projectDir: string,
  options: { endpoint?: string; apiKey?: string }
): { configPath: string; document: Document; serverName: string } {
  const configPath = cursorMcpConfigPath();
  const document = readCursorDocument(configPath, 'mcpServers');
  const servers = (document.mcpServers ?? {}) as Document;
  const matches = Object.entries(servers).filter(([, entry]) => isAutoMemServerEntry(entry));
  if (matches.length > 1) {
    throw new Error(`Multiple AutoMem servers in ${configPath}. Keep one registration and re-run.`);
  }
  const serverName = matches[0]?.[0] ?? 'memory';
  if (Object.hasOwn(servers, serverName) && !isAutoMemServerEntry(servers[serverName])) {
    throw new Error(
      `Refusing to overwrite unrelated server ${serverName} in ${configPath}. Rename it and re-run.`
    );
  }
  const projectPath = path.join(projectDir, '.cursor', 'mcp.json');
  const project = readCursorDocument(projectPath, 'mcpServers');
  const projectServers = (project.mcpServers ?? {}) as Document;
  if (
    Object.hasOwn(projectServers, serverName) ||
    Object.values(projectServers).some(isAutoMemServerEntry)
  ) {
    throw new Error(
      `Project MCP configuration in ${projectPath} overrides or duplicates AutoMem. Move its AutoMem registration to ${configPath} (or rename the conflicting server), then re-run.`
    );
  }
  const current = servers[serverName];
  const storedEnv = isRecord(current) && isRecord(current.env) ? current.env : undefined;
  const endpoint =
    options.endpoint?.trim() ||
    readEndpointFrom(process.env) ||
    readEndpointFrom(storedEnv) ||
    DEFAULT_AUTOMEM_API_URL;
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('AutoMem endpoint must be an HTTP(S) URL without embedded credentials.');
  }
  const apiKey = resolveInheritedApiKey({
    endpoint,
    explicitKey: options.apiKey,
    storedEndpoint: readEndpointFrom(storedEnv),
    storedKey: readApiKeyFrom(storedEnv),
  });
  // Explicit blanks shadow credentials inherited from the launching Cursor process.
  const entry = {
    command: 'npx',
    args: ['-y', '@verygoodplugins/mcp-automem'],
    env: { AUTOMEM_API_URL: endpoint, AUTOMEM_API_KEY: apiKey ?? '', AUTOMEM_API_TOKEN: '' },
  };
  return {
    configPath,
    serverName,
    document: { ...document, mcpServers: { ...servers, [serverName]: entry } },
  };
}

export function writeCursorMcpDocument(
  filePath: string,
  doc: Document,
  opts: CursorWriteOptions
): void {
  writeFileWithBackup(filePath, `${JSON.stringify(doc, null, 2)}\n`, { ...opts, secret: true });
  // The shared writer's unchanged fast path does not tighten old file permissions.
  if (!opts.dryRun && process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
}

export function removeCursorMemoryServers(opts: CursorWriteOptions): void {
  const configPath = cursorMcpConfigPath();
  if (!fs.existsSync(configPath)) return;
  const doc = readCursorDocument(configPath, 'mcpServers');
  const servers = (doc.mcpServers ?? {}) as Document;
  const remaining = Object.fromEntries(
    Object.entries(servers).filter(([, entry]) => !isAutoMemServerEntry(entry))
  );
  if (Object.keys(remaining).length === Object.keys(servers).length) return;
  writeCursorMcpDocument(configPath, { ...doc, mcpServers: remaining }, opts);
}

export function planCursorHooks(filePath: string): Document {
  const doc = readCursorDocument(filePath, 'hooks');
  if (doc.version !== undefined && doc.version !== 1) {
    throw new Error(`Unsupported Cursor hooks version in ${filePath}. Expected version 1.`);
  }
  const hooks = (doc.hooks ?? {}) as Document;
  if (hooks.sessionStart !== undefined && !Array.isArray(hooks.sessionStart)) {
    throw new Error(`Expected a sessionStart array in ${filePath}.`);
  }
  const entries = (hooks.sessionStart ?? []) as unknown[];
  const preserved = entries.filter(
    (entry) => !isRecord(entry) || entry.command !== CURSOR_SESSION_COMMAND
  );
  return {
    ...doc,
    version: 1,
    hooks: { ...hooks, sessionStart: [...preserved, { command: CURSOR_SESSION_COMMAND }] },
  };
}

export function removeCursorHook(filePath: string, opts: CursorWriteOptions): void {
  if (!fs.existsSync(filePath)) return;
  const doc = readCursorDocument(filePath, 'hooks');
  const hooks = (doc.hooks ?? {}) as Document;
  if (!Array.isArray(hooks.sessionStart)) return;
  const remaining = hooks.sessionStart.filter(
    (entry) => !isRecord(entry) || entry.command !== CURSOR_SESSION_COMMAND
  );
  if (remaining.length === hooks.sessionStart.length) return;
  if (remaining.length) hooks.sessionStart = remaining;
  else delete hooks.sessionStart;
  writeFileWithBackup(filePath, `${JSON.stringify(doc, null, 2)}\n`, opts);
}

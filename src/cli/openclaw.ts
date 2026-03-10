import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readAutoMemApiKeyFromEnv } from '../env.js';

export type OpenClawSetupMode = 'plugin' | 'mcp' | 'skill';
export type OpenClawSetupScope = 'workspace' | 'shared';

interface OpenClawSetupOptions {
  workspace?: string;
  projectName?: string;
  dryRun?: boolean;
  quiet?: boolean;
  skipPrompts?: boolean;
  endpoint?: string;
  apiKey?: string;
  mode: OpenClawSetupMode;
  scope: OpenClawSetupScope;
  pluginSource?: string;
}

type JsonPrimitive = string | number | boolean | null;
interface JsonArray extends Array<JsonValue> {}
interface JsonObject {
  [key: string]: JsonValue | undefined;
}
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/openclaw', import.meta.url))
);
const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('../../package.json', import.meta.url)));
const DEFAULT_AUTOMEM_ENDPOINT = 'http://127.0.0.1:8001';
const DEFAULT_PLUGIN_SOURCE = '@verygoodplugins/mcp-automem';
const OPENCLAW_PLUGIN_ID = 'automem';
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|token|secret|authorization)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function log(message: string, quiet?: boolean) {
  if (!quiet) {
    console.log(message);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Strip JSON5-style comments without corrupting URLs or strings containing `//`.
 * Handles single-line, block, and trailing commas.
 */
function stripJsonComments(raw: string): string {
  let result = '';
  let inString = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inString) {
      result += ch;
      if (ch === '\\') {
        result += next || '';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
      continue;
    }

    result += ch;
    i += 1;
  }

  return result.replace(/,\s*([}\]])/g, '$1');
}

function readJsonFile(filePath: string): JsonObject {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const stripped = stripJsonComments(raw);
    const parsed = JSON.parse(stripped) as unknown;
    return isRecord(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

function writeJsonFileWithBackup(targetPath: string, data: JsonObject, options: OpenClawSetupOptions) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  if (options.dryRun) {
    log(`[DRY RUN] Would write ${targetPath}`, options.quiet);
    log(`[DRY RUN] Redacted preview:\n${JSON.stringify(redactConfigForOutput(data), null, 2)}`, options.quiet);
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (fs.existsSync(targetPath)) {
    const current = fs.readFileSync(targetPath, 'utf8');
    if (current === serialized) {
      log(`Unchanged: ${targetPath}`, options.quiet);
      return;
    }
    const backup = backupPath(targetPath);
    fs.copyFileSync(targetPath, backup);
    log(`Backup created: ${backup}`, options.quiet);
  }

  fs.writeFileSync(targetPath, serialized, 'utf8');
  log(`Updated: ${targetPath}`, options.quiet);
}

function writeFileWithBackup(targetPath: string, content: string, options: OpenClawSetupOptions) {
  if (options.dryRun) {
    log(`[DRY RUN] Would write ${targetPath}`, options.quiet);
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (fs.existsSync(targetPath)) {
    const current = fs.readFileSync(targetPath, 'utf8');
    if (current === content) {
      log(`Unchanged: ${targetPath}`, options.quiet);
      return;
    }
    const backup = backupPath(targetPath);
    fs.copyFileSync(targetPath, backup);
    log(`Backup created: ${backup}`, options.quiet);
  }

  fs.writeFileSync(targetPath, content, 'utf8');
  log(`Updated: ${targetPath}`, options.quiet);
}

function detectProjectName(): string {
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { name?: string };
      if (pkg.name) {
        return String(pkg.name).replace(/^@.*?\//, '');
      }
    } catch {
      // Fall through to git/directory detection.
    }
  }

  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    const match = remote.match(/\/([^/]+?)(\.git)?$/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Fall through to directory detection.
  }

  return path.basename(process.cwd());
}

function readCurrentPackageName(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_ROOT, 'utf8')) as { name?: string };
    return pkg.name?.trim() || DEFAULT_PLUGIN_SOURCE;
  } catch {
    return DEFAULT_PLUGIN_SOURCE;
  }
}

function resolveTildePath(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
}

function looksLikePath(input: string): boolean {
  return input.startsWith('.') || input.startsWith('/') || input.startsWith('~');
}

function resolvePluginSource(input?: string): string {
  const candidate = input?.trim() || readCurrentPackageName() || DEFAULT_PLUGIN_SOURCE;
  return looksLikePath(candidate) ? resolveTildePath(candidate) : candidate;
}

function backupPath(filePath: string): string {
  let candidate = `${filePath}.bak`;
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${filePath}.bak.${index}`;
    index += 1;
  }
  return candidate;
}

function archivePath(targetPath: string): string {
  let candidate = `${targetPath}.archived-for-plugin`;
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${targetPath}.archived-for-plugin.${index}`;
    index += 1;
  }
  return candidate;
}

function sanitizeTag(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function buildDefaultTags(projectName?: string): string[] {
  const tags = ['openclaw'];
  const normalizedProjectName = String(projectName || '').replace(/^@.*?\//, '');
  const sanitized = sanitizeTag(normalizedProjectName);
  if (sanitized && !tags.includes(sanitized)) {
    tags.push(sanitized);
  }
  return tags;
}

export function redactSensitiveValue(value: unknown): string | unknown {
  if (value === undefined || value === null || value === '') {
    return value;
  }
  return '<redacted>';
}

export function redactConfigForOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactConfigForOutput(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = redactSensitiveValue(entry);
      continue;
    }
    result[key] = redactConfigForOutput(entry);
  }
  return result;
}

/**
 * Resolve OpenClaw workspace directory.
 *
 * Priority:
 * 1. Explicit --workspace flag
 * 2. OPENCLAW_WORKSPACE or CLAWDBOT_WORKSPACE env var
 * 3. OpenClaw config file (agents.defaults.workspace or first agent workspace)
 * 4. Common default paths: ~/.openclaw/workspace, ~/clawd
 */
function resolveWorkspaceDir(explicit?: string): string | null {
  if (explicit) {
    return resolveTildePath(explicit);
  }

  const envWorkspace = process.env.OPENCLAW_WORKSPACE || process.env.CLAWDBOT_WORKSPACE;
  if (envWorkspace) {
    const resolved = resolveTildePath(envWorkspace);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  const configWorkspace = readWorkspaceFromConfig();
  if (configWorkspace) {
    return configWorkspace;
  }

  const homeDir = os.homedir();
  const candidates = [
    path.join(homeDir, '.openclaw', 'workspace'),
    path.join(homeDir, 'clawd'),
    path.join(homeDir, '.clawdbot', 'workspace'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const hasAgents = fs.existsSync(path.join(candidate, 'AGENTS.md'));
      const hasSoul = fs.existsSync(path.join(candidate, 'SOUL.md'));
      if (hasAgents || hasSoul) {
        return candidate;
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readWorkspaceFromConfig(): string | null {
  const homeDir = os.homedir();
  const configPaths = [
    path.join(homeDir, '.openclaw', 'openclaw.json'),
    path.join(homeDir, '.openclaw', 'config.json5'),
    path.join(homeDir, '.openclaw', 'config.json'),
    path.join(homeDir, '.clawdbot', 'config.json5'),
    path.join(homeDir, '.clawdbot', 'config.json'),
  ];

  for (const configPath of configPaths) {
    const config = readJsonFile(configPath);
    const agents = isRecord(config.agents) ? config.agents : undefined;
    const defaults = isRecord(agents?.defaults) ? agents.defaults : undefined;
    const defaultWorkspace = typeof defaults?.workspace === 'string' ? defaults.workspace : undefined;
    if (defaultWorkspace) {
      const resolved = resolveTildePath(defaultWorkspace);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }

    const agentList = Array.isArray(agents?.list) ? agents.list : [];
    for (const agent of agentList) {
      if (!isRecord(agent) || typeof agent.workspace !== 'string') {
        continue;
      }
      const resolved = resolveTildePath(agent.workspace);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }

  return null;
}

function readOpenClawConfig(): { config: JsonObject; configPath: string } {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  return { config: readJsonFile(configPath), configPath };
}

function readMcporterConfig(configPath: string): JsonObject {
  return readJsonFile(configPath);
}

/**
 * Remove old AGENTS.md AutoMem block if present from previous installs.
 */
function cleanOldAgentsBlock(workspaceDir: string, options: OpenClawSetupOptions): boolean {
  const agentsPath = path.join(workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    return false;
  }

  const content = fs.readFileSync(agentsPath, 'utf8');
  const startMarker = '<!-- BEGIN AUTOMEM OPENCLAW RULES -->';
  const endMarker = '<!-- END AUTOMEM OPENCLAW RULES -->';
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return false;
  }

  if (options.dryRun) {
    log('[DRY RUN] Would remove old AutoMem block from AGENTS.md', options.quiet);
    return true;
  }

  const backup = backupPath(agentsPath);
  fs.copyFileSync(agentsPath, backup);
  log(`Backup created: ${backup}`, options.quiet);

  const before = content.slice(0, startIndex).trimEnd();
  const after = content.slice(endIndex + endMarker.length).trimStart();
  const cleaned = `${before}${after ? `\n\n${after}` : ''}\n`;

  fs.writeFileSync(agentsPath, cleaned, 'utf8');
  log('Removed old AutoMem block from AGENTS.md', options.quiet);
  return true;
}

function ensureMemoryDir(workspaceDir: string | null, options: OpenClawSetupOptions): void {
  if (!workspaceDir) {
    return;
  }

  const memoryDir = path.join(workspaceDir, 'memory');
  if (fs.existsSync(memoryDir)) {
    log(`Exists: ${memoryDir}`, options.quiet);
    return;
  }

  if (options.dryRun) {
    log(`[DRY RUN] Would create ${memoryDir}/`, options.quiet);
    return;
  }

  fs.mkdirSync(memoryDir, { recursive: true });
  const gitkeepPath = path.join(memoryDir, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '', 'utf8');
  }
  log(`Created: ${memoryDir}/`, options.quiet);
}

function renderConfigEntryForOutput(label: string, entry: unknown, options: OpenClawSetupOptions) {
  log(`${label}: ${JSON.stringify(redactConfigForOutput(entry), null, 2)}`, options.quiet);
}

export function buildPluginConfigEntry(params: {
  existing?: Record<string, unknown>;
  endpoint: string;
  apiKey?: string;
  defaultTags: string[];
}): Record<string, unknown> {
  const existing = isRecord(params.existing) ? params.existing : {};
  const existingConfig = isRecord(existing.config) ? existing.config : {};
  const existingApiKey =
    typeof existingConfig.apiKey === 'string' && existingConfig.apiKey.trim()
      ? existingConfig.apiKey.trim()
      : undefined;

  return {
    ...existing,
    enabled: true,
    config: {
      ...existingConfig,
      endpoint: params.endpoint,
      ...(params.apiKey || existingApiKey ? { apiKey: params.apiKey || existingApiKey } : {}),
      autoRecall:
        typeof existingConfig.autoRecall === 'boolean' ? existingConfig.autoRecall : true,
      autoRecallLimit:
        typeof existingConfig.autoRecallLimit === 'number' && Number.isFinite(existingConfig.autoRecallLimit)
          ? existingConfig.autoRecallLimit
          : 3,
      exposure:
        typeof existingConfig.exposure === 'string' && existingConfig.exposure.trim()
          ? existingConfig.exposure
          : 'dm-only',
      ...(params.defaultTags.length > 0 ? { defaultTags: params.defaultTags } : {}),
    },
  };
}

export function buildSkillConfigEntry(params: {
  existing?: Record<string, unknown>;
  endpoint: string;
  apiKey?: string;
  defaultTags: string[];
}): Record<string, unknown> {
  const existing = isRecord(params.existing) ? params.existing : {};
  const existingEnv = isRecord(existing.env) ? existing.env : {};
  const existingApiKey =
    typeof existing.apiKey === 'string' && existing.apiKey.trim() ? existing.apiKey.trim() : undefined;

  return {
    ...existing,
    enabled: true,
    ...(params.apiKey || existingApiKey ? { apiKey: params.apiKey || existingApiKey } : {}),
    env: {
      ...existingEnv,
      AUTOMEM_ENDPOINT: params.endpoint,
      ...(params.defaultTags.length > 0
        ? { AUTOMEM_DEFAULT_TAGS: params.defaultTags.join(',') }
        : {}),
    },
  };
}

export function buildMcporterConfig(params: {
  existing?: Record<string, unknown>;
  serverPackage?: string;
}): Record<string, unknown> {
  const existing = isRecord(params.existing) ? params.existing : {};
  const existingServers = isRecord(existing.mcpServers) ? existing.mcpServers : {};
  const serverPackage = params.serverPackage || readCurrentPackageName();

  return {
    ...existing,
    mcpServers: {
      ...existingServers,
      automem: {
        description: 'AutoMem memory service',
        command: 'npx',
        args: [serverPackage],
      },
    },
    imports: Array.isArray(existing.imports) ? existing.imports : [],
  };
}

function normalizeSkillEntryForPlugin(existing?: Record<string, unknown>): Record<string, unknown> {
  const next = isRecord(existing) ? { ...existing } : {};
  delete next.apiKey;
  delete next.env;
  return {
    ...next,
    enabled: true,
  };
}

function disablePluginEntry(existing?: Record<string, unknown>): Record<string, unknown> {
  const next = isRecord(existing) ? { ...existing } : {};
  next.enabled = false;
  return next;
}

function installSkillTemplate(params: {
  templateName: string;
  scope: OpenClawSetupScope;
  workspaceDir: string | null;
  options: OpenClawSetupOptions;
}) {
  const sourcePath = path.join(TEMPLATE_ROOT, params.templateName, 'SKILL.md');
  if (!fs.existsSync(sourcePath)) {
    fail(`Skill template not found: ${sourcePath}`);
  }

  const targetPath =
    params.scope === 'workspace'
      ? path.join(params.workspaceDir || '', 'skills', OPENCLAW_PLUGIN_ID, 'SKILL.md')
      : path.join(os.homedir(), '.openclaw', 'skills', OPENCLAW_PLUGIN_ID, 'SKILL.md');

  if (params.scope === 'workspace' && !params.workspaceDir) {
    fail('Could not determine an OpenClaw workspace. Use --workspace <path> or --scope shared.');
  }

  const content = fs.readFileSync(sourcePath, 'utf8');
  writeFileWithBackup(targetPath, content, params.options);
}

function archiveSkillOverride(targetPath: string, options: OpenClawSetupOptions): string | null {
  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const archived = archivePath(targetPath);
  if (options.dryRun) {
    log(`[DRY RUN] Would archive ${targetPath} -> ${archived}`, options.quiet);
    return archived;
  }

  fs.renameSync(targetPath, archived);
  log(`Archived ${targetPath} -> ${archived}`, options.quiet);
  return archived;
}

function archiveLegacySkillOverrides(workspaceDir: string | null, options: OpenClawSetupOptions): string[] {
  const archived: string[] = [];
  const sharedSkillDir = path.join(os.homedir(), '.openclaw', 'skills', OPENCLAW_PLUGIN_ID);
  const workspaceSkillDir = workspaceDir
    ? path.join(workspaceDir, 'skills', OPENCLAW_PLUGIN_ID)
    : null;

  const sharedArchived = archiveSkillOverride(sharedSkillDir, options);
  if (sharedArchived) {
    archived.push(sharedArchived);
  }

  if (workspaceSkillDir) {
    const workspaceArchived = archiveSkillOverride(workspaceSkillDir, options);
    if (workspaceArchived) {
      archived.push(workspaceArchived);
    }
  }

  return archived;
}

function installOpenClawPlugin(pluginSource: string, options: OpenClawSetupOptions) {
  if (options.dryRun) {
    log(`[DRY RUN] Would run: openclaw plugins install ${pluginSource}`, options.quiet);
    return;
  }

  try {
    execFileSync('openclaw', ['plugins', 'install', pluginSource], {
      stdio: options.quiet ? 'ignore' : 'inherit',
      env: process.env,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      fail('OpenClaw CLI not found on PATH. Install OpenClaw before using --mode plugin.');
    }
    fail(`Failed to install OpenClaw plugin from ${pluginSource}. ${err.message}`);
  }
}

function resolveMcporterConfigPath(scope: OpenClawSetupScope, workspaceDir: string | null): string {
  if (scope === 'shared') {
    return path.join(os.homedir(), '.mcporter', 'mcporter.json');
  }
  if (!workspaceDir) {
    fail('Could not determine an OpenClaw workspace. Use --workspace <path> or --scope shared.');
  }
  return path.join(workspaceDir, 'config', 'mcporter.json');
}

function updateOpenClawConfig(config: JsonObject, configPath: string, options: OpenClawSetupOptions) {
  writeJsonFileWithBackup(configPath, config, options);
}

function applyPluginMode(params: {
  config: JsonObject;
  configPath: string;
  workspaceDir: string | null;
  options: OpenClawSetupOptions;
  endpoint: string;
  apiKey?: string;
  defaultTags: string[];
}) {
  installOpenClawPlugin(resolvePluginSource(params.options.pluginSource), params.options);
  archiveLegacySkillOverrides(params.workspaceDir, params.options);

  const plugins = isRecord(params.config.plugins) ? { ...params.config.plugins } : {};
  const pluginEntries = isRecord(plugins.entries) ? { ...plugins.entries } : {};
  const existingPluginEntry = isRecord(pluginEntries[OPENCLAW_PLUGIN_ID])
    ? (pluginEntries[OPENCLAW_PLUGIN_ID] as Record<string, unknown>)
    : undefined;
  pluginEntries[OPENCLAW_PLUGIN_ID] = buildPluginConfigEntry({
    existing: existingPluginEntry,
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    defaultTags: params.defaultTags,
  }) as JsonValue;
  plugins.entries = pluginEntries as JsonValue;
  params.config.plugins = plugins as JsonValue;

  const skills = isRecord(params.config.skills) ? { ...params.config.skills } : {};
  const skillEntries = isRecord(skills.entries) ? { ...skills.entries } : {};
  const existingSkillEntry = isRecord(skillEntries[OPENCLAW_PLUGIN_ID])
    ? (skillEntries[OPENCLAW_PLUGIN_ID] as Record<string, unknown>)
    : undefined;
  skillEntries[OPENCLAW_PLUGIN_ID] = normalizeSkillEntryForPlugin(existingSkillEntry) as JsonValue;
  skills.entries = skillEntries as JsonValue;
  params.config.skills = skills as JsonValue;

  if (params.options.dryRun) {
    renderConfigEntryForOutput(
      '[DRY RUN] plugins.entries.automem',
      pluginEntries[OPENCLAW_PLUGIN_ID],
      params.options
    );
  }

  updateOpenClawConfig(params.config, params.configPath, params.options);
}

function applySkillMode(params: {
  config: JsonObject;
  configPath: string;
  workspaceDir: string | null;
  options: OpenClawSetupOptions;
  endpoint: string;
  apiKey?: string;
  defaultTags: string[];
  templateName: 'skill-mcp' | 'skill-legacy';
}) {
  installSkillTemplate({
    templateName: params.templateName,
    scope: params.options.scope,
    workspaceDir: params.workspaceDir,
    options: params.options,
  });

  const skills = isRecord(params.config.skills) ? { ...params.config.skills } : {};
  const skillEntries = isRecord(skills.entries) ? { ...skills.entries } : {};
  const existingSkillEntry = isRecord(skillEntries[OPENCLAW_PLUGIN_ID])
    ? (skillEntries[OPENCLAW_PLUGIN_ID] as Record<string, unknown>)
    : undefined;
  skillEntries[OPENCLAW_PLUGIN_ID] = buildSkillConfigEntry({
    existing: existingSkillEntry,
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    defaultTags: params.defaultTags,
  }) as JsonValue;
  skills.entries = skillEntries as JsonValue;
  params.config.skills = skills as JsonValue;

  const plugins = isRecord(params.config.plugins) ? { ...params.config.plugins } : {};
  const pluginEntries = isRecord(plugins.entries) ? { ...plugins.entries } : {};
  const existingPluginEntry = isRecord(pluginEntries[OPENCLAW_PLUGIN_ID])
    ? (pluginEntries[OPENCLAW_PLUGIN_ID] as Record<string, unknown>)
    : undefined;
  if (existingPluginEntry) {
    pluginEntries[OPENCLAW_PLUGIN_ID] = disablePluginEntry(existingPluginEntry) as JsonValue;
    plugins.entries = pluginEntries as JsonValue;
    params.config.plugins = plugins as JsonValue;
  }

  if (params.options.dryRun) {
    renderConfigEntryForOutput(
      '[DRY RUN] skills.entries.automem',
      skillEntries[OPENCLAW_PLUGIN_ID],
      params.options
    );
  }

  updateOpenClawConfig(params.config, params.configPath, params.options);
}

function applyMcpMode(params: {
  config: JsonObject;
  configPath: string;
  workspaceDir: string | null;
  options: OpenClawSetupOptions;
  endpoint: string;
  apiKey?: string;
  defaultTags: string[];
}) {
  applySkillMode({
    ...params,
    templateName: 'skill-mcp',
  });

  const mcporterPath = resolveMcporterConfigPath(params.options.scope, params.workspaceDir);
  const currentMcporterConfig = readMcporterConfig(mcporterPath);
  const nextMcporterConfig = buildMcporterConfig({ existing: currentMcporterConfig });

  if (params.options.dryRun) {
    renderConfigEntryForOutput('[DRY RUN] mcporter.json', nextMcporterConfig, params.options);
  }

  writeJsonFileWithBackup(mcporterPath, nextMcporterConfig as JsonObject, params.options);
}

function resolveModeSummary(mode: OpenClawSetupMode): string {
  switch (mode) {
    case 'plugin':
      return 'native OpenClaw plugin with typed tools and auto-recall hook';
    case 'mcp':
      return 'workspace skill plus mcporter stdio server';
    case 'skill':
      return 'legacy curl-based skill';
  }
}

function resolveEndpoint(options: OpenClawSetupOptions): string {
  return options.endpoint?.trim() || process.env.AUTOMEM_ENDPOINT || DEFAULT_AUTOMEM_ENDPOINT;
}

function resolveApiKey(options: OpenClawSetupOptions): string | undefined {
  return options.apiKey?.trim() || readAutoMemApiKeyFromEnv();
}

export async function applyOpenClawSetup(cliOptions: OpenClawSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();
  const endpoint = resolveEndpoint(cliOptions);
  const apiKey = resolveApiKey(cliOptions);
  const defaultTags = buildDefaultTags(projectName);
  const workspaceDir = resolveWorkspaceDir(cliOptions.workspace);
  const requiresWorkspace = cliOptions.mode !== 'plugin' || cliOptions.scope === 'workspace';

  if (requiresWorkspace && !workspaceDir) {
    fail(
      'Could not find an OpenClaw workspace. Use --workspace <path>, set OPENCLAW_WORKSPACE, or choose --scope shared.'
    );
  }

  const { config, configPath } = readOpenClawConfig();

  log(`Setting up OpenClaw AutoMem for ${projectName}`, cliOptions.quiet);
  log(`Mode: ${cliOptions.mode} (${resolveModeSummary(cliOptions.mode)})`, cliOptions.quiet);
  log(`Workspace: ${workspaceDir || '(not required for this run)'}`, cliOptions.quiet);
  if (cliOptions.mode !== 'plugin') {
    log(`Scope: ${cliOptions.scope}`, cliOptions.quiet);
  }
  log(`Endpoint: ${endpoint}`, cliOptions.quiet);
  log(`Default tags: ${defaultTags.join(', ')}`, cliOptions.quiet);

  if (cliOptions.mode === 'plugin') {
    applyPluginMode({
      config,
      configPath,
      workspaceDir,
      options: cliOptions,
      endpoint,
      apiKey,
      defaultTags,
    });
  } else if (cliOptions.mode === 'mcp') {
    applyMcpMode({
      config,
      configPath,
      workspaceDir,
      options: cliOptions,
      endpoint,
      apiKey,
      defaultTags,
    });
  } else {
    applySkillMode({
      config,
      configPath,
      workspaceDir,
      options: cliOptions,
      endpoint,
      apiKey,
      defaultTags,
      templateName: 'skill-legacy',
    });
  }

  ensureMemoryDir(workspaceDir, cliOptions);

  if (workspaceDir) {
    cleanOldAgentsBlock(workspaceDir, cliOptions);
  }

  log('', cliOptions.quiet);
  log('OpenClaw AutoMem setup complete.', cliOptions.quiet);
  if (cliOptions.mode === 'plugin') {
    log('Next: restart the OpenClaw gateway so the plugin and bundled skill are reloaded.', cliOptions.quiet);
  } else if (cliOptions.mode === 'mcp') {
    log('Next: start a new session so OpenClaw loads the mcporter-backed AutoMem tools.', cliOptions.quiet);
  } else {
    log('Next: start a new session so OpenClaw loads the legacy curl skill.', cliOptions.quiet);
  }
}

export function parseArgs(args: string[]): OpenClawSetupOptions {
  const options: OpenClawSetupOptions = {
    mode: 'plugin',
    scope: 'workspace',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--workspace':
        if (i + 1 >= args.length) {
          fail('Error: --workspace requires a path');
        }
        options.workspace = args[++i];
        break;
      case '--name':
        if (i + 1 >= args.length) {
          fail('Error: --name requires a value');
        }
        options.projectName = args[++i];
        break;
      case '--endpoint':
        if (i + 1 >= args.length) {
          fail('Error: --endpoint requires a URL');
        }
        options.endpoint = args[++i];
        break;
      case '--api-key':
        if (i + 1 >= args.length) {
          fail('Error: --api-key requires a value');
        }
        options.apiKey = args[++i];
        break;
      case '--mode': {
        const value = args[i + 1];
        if (!value) {
          fail('Error: --mode requires plugin, mcp, or skill');
        }
        if (value !== 'plugin' && value !== 'mcp' && value !== 'skill') {
          fail(`Error: invalid --mode "${value}". Use plugin, mcp, or skill.`);
        }
        options.mode = value;
        i += 1;
        break;
      }
      case '--scope': {
        const value = args[i + 1];
        if (!value) {
          fail('Error: --scope requires workspace or shared');
        }
        if (value !== 'workspace' && value !== 'shared') {
          fail(`Error: invalid --scope "${value}". Use workspace or shared.`);
        }
        options.scope = value;
        i += 1;
        break;
      }
      case '--plugin-source':
        if (i + 1 >= args.length) {
          fail('Error: --plugin-source requires an npm spec or path');
        }
        options.pluginSource = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--yes':
      case '-y':
        options.skipPrompts = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      default:
        break;
    }
  }

  return options;
}

export async function runOpenClawSetup(args: string[] = []): Promise<void> {
  try {
    const options = parseArgs(args);
    await applyOpenClawSetup(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

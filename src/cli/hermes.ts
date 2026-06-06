import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CommonOptions,
  detectProjectName,
  log,
  parseCommonFlags,
  replaceTemplateVars,
  writeFileWithBackup,
} from './host-toolkit.js';
import {
  buildAutoMemServerEntry,
  readExistingHermesCredentials,
  removeHermesMemoryProvider,
  removeMcpServerEntry,
  resolveHermesPaths,
  upsertHermesMemoryProvider,
  upsertMcpServer,
} from './hermes-config.js';
import { readAutoMemApiKeyFromEnv } from '../env.js';
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';

export type HermesInstallMode = 'mcp' | 'provider' | 'both';

export interface HermesSetupOptions extends CommonOptions {
  endpoint?: string;
  apiKey?: string;
  rulesPath?: string;
  mode?: HermesInstallMode;
}

const HERMES_TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/hermes', import.meta.url))
);
const HERMES_PROVIDER_TEMPLATE_ROOT = path.join(HERMES_TEMPLATE_ROOT, 'provider');
const HERMES_MCP_SERVER_NAME = 'automem';
const HERMES_PROVIDER_NAME = 'automem';
const HERMES_RULES_START = '<!-- BEGIN AUTOMEM HERMES RULES -->';
const HERMES_RULES_END = '<!-- END AUTOMEM HERMES RULES -->';
const CODEX_RULES_START = '<!-- BEGIN AUTOMEM CODEX RULES -->';
const CODEX_RULES_END = '<!-- END AUTOMEM CODEX RULES -->';

const HERMES_MCP_TOOL_NAMES = [
  'mcp_automem_recall_memory',
  'mcp_automem_store_memory',
  'mcp_automem_associate_memories',
  'mcp_automem_update_memory',
  'mcp_automem_check_database_health',
];

const HERMES_PROVIDER_TOOL_NAMES = [
  'automem_recall_memory',
  'automem_store_memory',
  'automem_associate_memories',
  'automem_update_memory',
  'automem_check_database_health',
];

function formatToolList(toolNames: string[]): string {
  return toolNames.map((toolName) => `- \`${toolName}\``).join('\n');
}

function buildHermesModeRules(mode: HermesInstallMode): string {
  if (mode === 'provider') {
    return [
      '## Provider-only mode',
      '',
      "Hermes is using AutoMem through `memory.provider: automem`. Ambient recall is injected before model calls through Hermes' memory provider lifecycle. When explicit memory tools are available, use these provider tool names:",
      '',
      formatToolList(HERMES_PROVIDER_TOOL_NAMES),
      '',
      'Recall once early in substantive work, store only high-signal corrections/decisions/patterns, verify the stored memory can be recalled, and associate it with related memories when there is a meaningful relationship.',
    ].join('\n');
  }

  if (mode === 'both') {
    return [
      '## Both mode',
      '',
      "Hermes uses the native provider for ambient recall and the MCP server for explicit tools. The provider explicit tools are disabled with `AUTOMEM_HERMES_PROVIDER_TOOLS=false`, leaving one explicit tool surface:",
      '',
      formatToolList(HERMES_MCP_TOOL_NAMES),
      '',
      'Recall once early in substantive work, store only high-signal corrections/decisions/patterns, verify the stored memory can be recalled, and associate it with related memories when there is a meaningful relationship.',
    ].join('\n');
  }

  return [
    '## MCP-only mode',
    '',
    'Hermes is using AutoMem as an MCP server. Use these tool names:',
    '',
    formatToolList(HERMES_MCP_TOOL_NAMES),
    '',
    'Recall once early in substantive work, store only high-signal corrections/decisions/patterns, verify the stored memory can be recalled, and associate it with related memories when there is a meaningful relationship.',
  ].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeMarkedBlocks(existing: string, start: string, end: string): string {
  const pattern = new RegExp(`\\n?${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'g');
  return existing.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n');
}

function upsertRulesWithMarkers(existing: string | null, block: string): string {
  // Normalize to exactly one trailing newline so re-runs are byte-stable
  // (the previous codex.ts shape accreted a newline each merge).
  const normalize = (s: string) => `${s.replace(/\n+$/, '')}\n`;
  if (!existing) {
    return normalize(block);
  }
  const cleaned = removeMarkedBlocks(existing, CODEX_RULES_START, CODEX_RULES_END);
  const startIdx = cleaned.indexOf(HERMES_RULES_START);
  const endIdx = cleaned.indexOf(HERMES_RULES_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = cleaned.slice(0, startIdx);
    const after = cleaned.slice(endIdx + HERMES_RULES_END.length);
    return normalize(`${before}${block}${after}`);
  }
  const sep = cleaned.endsWith('\n') ? '\n' : '\n\n';
  return normalize(`${cleaned}${sep}${block}`);
}

function formatEnvValue(value: string): string {
  const needsQuotes = /[^A-Za-z0-9_@/:.,+-]/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function mergeHermesEnvFile(
  envPath: string,
  updates: Record<string, string | undefined>,
  options: Pick<CommonOptions, 'dryRun' | 'quiet'>,
): void {
  const filtered = Object.fromEntries(
    Object.entries(updates).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (Object.keys(filtered).length === 0) return;

  if (options.dryRun) {
    log(`[DRY RUN] Would write AutoMem environment to: ${envPath}`, options.quiet);
    return;
  }

  const lines: Array<{ key?: string; line: string }> = [];
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) {
        lines.push({ line });
        continue;
      }
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      lines.push(match ? { key: match[1].trim(), line } : { line });
    }
  }

  const updatedKeys = new Set<string>();
  for (const entry of lines) {
    if (entry.key && Object.prototype.hasOwnProperty.call(filtered, entry.key)) {
      entry.line = `${entry.key}=${formatEnvValue(filtered[entry.key])}`;
      updatedKeys.add(entry.key);
    }
  }
  for (const [key, value] of Object.entries(filtered)) {
    if (!updatedKeys.has(key)) {
      lines.push({ key, line: `${key}=${formatEnvValue(value)}` });
    }
  }

  const content = lines.map((entry) => entry.line).join('\n').replace(/\s+$/, '');
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content.length ? `${content}\n` : '', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // Best effort on platforms that do not support POSIX chmod.
  }
  log(`✅ Updated Hermes environment: ${path.basename(envPath)}`, options.quiet);
}

function removeHermesEnvKeys(
  envPath: string,
  keys: string[],
  options: Pick<CommonOptions, 'dryRun' | 'quiet'>,
): boolean {
  if (!fs.existsSync(envPath)) return false;
  const keySet = new Set(keys);
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    return !match || !keySet.has(match[1]);
  });
  if (filtered.join('\n') === lines.join('\n')) return false;

  if (options.dryRun) {
    log(`[DRY RUN] Would remove AutoMem Hermes environment keys from: ${envPath}`, options.quiet);
    return false;
  }

  const content = filtered.join('\n').replace(/\s+$/, '');
  fs.writeFileSync(envPath, content.length ? `${content}\n` : '', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // Best effort on platforms that do not support POSIX chmod.
  }
  log(`🗑️  Removed AutoMem Hermes environment keys from ${path.basename(envPath)}`, options.quiet);
  return true;
}

function installHermesProvider(
  paths: ReturnType<typeof resolveHermesPaths>,
  endpoint: string,
  apiKey: string | undefined,
  providerToolsEnabled: boolean,
  options: Pick<CommonOptions, 'dryRun' | 'quiet'>,
): void {
  const providerRoot = path.join(paths.home, 'plugins', HERMES_PROVIDER_NAME);
  const files = ['__init__.py', 'plugin.yaml', 'cli.py'];
  for (const fileName of files) {
    const sourcePath = path.join(HERMES_PROVIDER_TEMPLATE_ROOT, fileName);
    const targetPath = path.join(providerRoot, fileName);
    const content = fs.readFileSync(sourcePath, 'utf8');
    writeFileWithBackup(targetPath, content, options);
  }

  mergeHermesEnvFile(
    path.join(paths.home, '.env'),
    {
      AUTOMEM_API_URL: endpoint,
      AUTOMEM_API_KEY: apiKey,
      AUTOMEM_HERMES_PROVIDER_TOOLS: providerToolsEnabled ? 'true' : 'false',
    },
    options,
  );

  upsertHermesMemoryProvider(paths.configPath, HERMES_PROVIDER_NAME, options);
}

export async function applyHermesSetup(cliOptions: HermesSetupOptions): Promise<void> {
  const paths = resolveHermesPaths({ dir: cliOptions.targetDir });
  const projectName = cliOptions.projectName ?? detectProjectName();
  const mode = cliOptions.mode ?? 'mcp';
  // Preserve credentials already installed for Hermes so a re-run (e.g. to
  // switch --mode) without flags or env vars does not clobber a remote
  // endpoint/key with the local default. Explicit flags and env still win.
  const existing = readExistingHermesCredentials(paths);
  const endpoint =
    cliOptions.endpoint ??
    process.env.AUTOMEM_API_URL ??
    process.env.AUTOMEM_ENDPOINT ??
    existing.endpoint ??
    DEFAULT_AUTOMEM_API_URL;
  const apiKey = cliOptions.apiKey ?? readAutoMemApiKeyFromEnv() ?? existing.apiKey;
  const rulesPath = cliOptions.rulesPath ?? paths.agentsPath;

  log(`\n🔧 Setting up Hermes AutoMem for: ${projectName}`, cliOptions.quiet);
  log(`🧭 Mode: ${mode}`, cliOptions.quiet);
  log(`📁 Hermes home: ${paths.home}`, cliOptions.quiet);
  log(`📄 Config: ${paths.configPath}`, cliOptions.quiet);
  log(`📄 Rules: ${rulesPath}\n`, cliOptions.quiet);

  if (mode === 'provider') {
    removeMcpServerEntry(paths.configPath, HERMES_MCP_SERVER_NAME, {
      dryRun: cliOptions.dryRun,
      quiet: cliOptions.quiet,
    });
    removeMcpServerEntry(paths.configPath, 'memory', {
      dryRun: cliOptions.dryRun,
      quiet: cliOptions.quiet,
      onlyIfAutoMem: true,
    });
  }

  if (mode === 'mcp' || mode === 'both') {
    removeMcpServerEntry(paths.configPath, 'memory', {
      dryRun: cliOptions.dryRun,
      quiet: cliOptions.quiet,
      onlyIfAutoMem: true,
    });
  }

  if (mode === 'mcp') {
    removeHermesMemoryProvider(paths.configPath, HERMES_PROVIDER_NAME, {
      dryRun: cliOptions.dryRun,
      quiet: cliOptions.quiet,
    });
    removeHermesEnvKeys(path.join(paths.home, '.env'), ['AUTOMEM_HERMES_PROVIDER_TOOLS'], cliOptions);
  }

  if (mode === 'mcp' || mode === 'both') {
    const entry = buildAutoMemServerEntry(endpoint, apiKey);
    const result = await upsertMcpServer(paths, HERMES_MCP_SERVER_NAME, entry, {
      dryRun: cliOptions.dryRun,
      quiet: cliOptions.quiet,
    });

    if (result.method === 'yaml' && result.changed) {
      log('✅ Registered AutoMem MCP server in config.yaml', cliOptions.quiet);
    }
  }

  if (mode === 'provider' || mode === 'both') {
    installHermesProvider(paths, endpoint, apiKey, mode === 'provider', cliOptions);
  }

  const templateContent = fs.readFileSync(
    path.join(HERMES_TEMPLATE_ROOT, 'memory-rules.md'),
    'utf8',
  );
  const processed = replaceTemplateVars(templateContent, {
    PROJECT_NAME: projectName,
    HERMES_MODE_RULES: buildHermesModeRules(mode),
  });

  const existingContent = fs.existsSync(rulesPath)
    ? fs.readFileSync(rulesPath, 'utf8')
    : null;
  const finalContent = upsertRulesWithMarkers(existingContent, processed);
  writeFileWithBackup(rulesPath, finalContent, cliOptions);

  log('\n📊 Configuration Status:', cliOptions.quiet);
  if (mode === 'mcp' || mode === 'both') {
    log(`  ✅ mcp_servers.${HERMES_MCP_SERVER_NAME} written to ${path.basename(paths.configPath)}`, cliOptions.quiet);
  }
  if (mode === 'provider' || mode === 'both') {
    log(`  ✅ memory.provider set to ${HERMES_PROVIDER_NAME}`, cliOptions.quiet);
    log(`  ✅ Hermes provider installed in plugins/${HERMES_PROVIDER_NAME}`, cliOptions.quiet);
    log('  ℹ️  If `hermes plugins list` shows AutoMem as not enabled, that is expected for memory providers', cliOptions.quiet);
  }
  log(`  ✅ AutoMem rules installed in ${path.basename(rulesPath)}`, cliOptions.quiet);
  if (!apiKey) {
    log('  ⚠️  No AUTOMEM_API_KEY set — set one before connecting to a remote AutoMem instance', cliOptions.quiet);
  }

  log('\n✨ Hermes AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  1. Restart Hermes (or run /reload-mcp) to pick up AutoMem changes', cliOptions.quiet);
  if (mode === 'mcp') {
    log('  2. Verify MCP tools: hermes mcp test automem', cliOptions.quiet);
    log('  3. Start a task — Hermes should use the mcp_automem_* tools when relevant', cliOptions.quiet);
  } else if (mode === 'both') {
    log('  2. Verify MCP tools: hermes mcp test automem', cliOptions.quiet);
    log('  3. Verify provider mode: hermes memory status', cliOptions.quiet);
    log('  4. Run diagnostics: hermes automem doctor', cliOptions.quiet);
    log('  5. Explicit tools use mcp_automem_*; provider recall is injected into the model payload', cliOptions.quiet);
  } else {
    log('  2. Verify provider mode: hermes memory status', cliOptions.quiet);
    log('  3. Run diagnostics: hermes automem doctor', cliOptions.quiet);
    log('  4. Recall context is injected into the model payload; Hermes may not print it in the terminal UI', cliOptions.quiet);
  }
}

function parseHermesMode(value: string): HermesInstallMode {
  if (value === 'mcp' || value === 'provider' || value === 'both') {
    return value;
  }
  throw new Error(`Invalid Hermes install mode: ${value}. Expected mcp, provider, or both.`);
}

function parseArgs(args: string[]): HermesSetupOptions {
  let endpoint: string | undefined;
  let apiKey: string | undefined;
  let rulesPath: string | undefined;
  let mode: HermesInstallMode | undefined;
  const common = parseCommonFlags(args, {
    '--endpoint': { kind: 'value', set: (v) => (endpoint = v) },
    '--api-key': { kind: 'value', set: (v) => (apiKey = v) },
    '--rules': { kind: 'value', set: (v) => (rulesPath = v) },
    '--mode': { kind: 'value', set: (v) => (mode = parseHermesMode(v)) },
  });
  return { ...common, endpoint, apiKey, rulesPath, mode };
}

export async function runHermesSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyHermesSetup(options);
}

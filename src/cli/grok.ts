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
  buildGrokAutoMemServerEntry,
  GROK_MCP_SERVER_NAME,
  readDisabledMcpServers,
  readExistingGrokCredentials,
  resolveGrokPaths,
  upsertGrokMemoryServer,
} from './grok-config.js';
import { readAutoMemApiKeyFromEnv } from '../env.js';
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';

export interface GrokSetupOptions extends CommonOptions {
  endpoint?: string;
  apiKey?: string;
  rulesPath?: string;
}

const TEMPLATE_ROOT = path.resolve(fileURLToPath(new URL('../../templates/grok', import.meta.url)));

export const GROK_RULES_START = '<!-- BEGIN AUTOMEM GROK RULES -->';
export const GROK_RULES_END = '<!-- END AUTOMEM GROK RULES -->';

/**
 * Stands in for the project tag when the rules land in the global
 * `~/.grok/AGENTS.md`. Matches what the Claude Desktop instructions use for the
 * same reason: the file is not project-scoped, so no single slug can be correct.
 */
export const GLOBAL_PROJECT_PLACEHOLDER = '<project-slug>';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertRulesWithMarkers(existing: string | null, block: string, rulesPath: string): string {
  const normalize = (s: string) => `${s.replace(/\n+$/, '')}\n`;
  if (!existing) {
    return normalize(block);
  }
  const startIdx = existing.indexOf(GROK_RULES_START);
  const endIdx = existing.indexOf(GROK_RULES_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + GROK_RULES_END.length);
    return normalize(`${before}${block}${after}`);
  }
  // One-sided markers (an interrupted run, or a hand edit that deleted half the block)
  // used to fall through to "append". That is quietly destructive: the file then holds
  // one start marker and two ends, so the *next* run replaces everything between the
  // original start and the appended end — deleting whatever the user wrote in between.
  // Refuse instead; the repair is a judgement call about their content, not ours.
  if (startIdx !== -1 || endIdx !== -1) {
    const present = startIdx !== -1 ? GROK_RULES_START : GROK_RULES_END;
    const missing = startIdx !== -1 ? GROK_RULES_END : GROK_RULES_START;
    throw new Error(
      `${rulesPath} has ${present} without a matching ${missing}. ` +
        'Appending would let a later run delete the content between them. ' +
        `Restore or remove the stray marker (or point --rules elsewhere), then re-run.`
    );
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return normalize(`${existing}${sep}${block}`);
}

export function stripGrokRulesMarkers(existing: string): string {
  const pattern = new RegExp(
    `\\n?${escapeRegExp(GROK_RULES_START)}[\\s\\S]*?${escapeRegExp(GROK_RULES_END)}\\n?`,
    'g'
  );
  return existing.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n');
}

export async function applyGrokSetup(cliOptions: GrokSetupOptions): Promise<void> {
  const paths = resolveGrokPaths({ dir: cliOptions.targetDir });
  const projectName = cliOptions.projectName ?? detectProjectName();
  const existingCreds = readExistingGrokCredentials(paths.configPath);
  const endpoint =
    cliOptions.endpoint ||
    process.env.AUTOMEM_API_URL ||
    process.env.AUTOMEM_ENDPOINT ||
    existingCreds.endpoint ||
    DEFAULT_AUTOMEM_API_URL;
  // A stored key belongs to the endpoint it was issued for. Carrying it over to a
  // different host would send that secret as a Bearer credential to a server that was
  // never meant to have it, so only reuse it when the endpoint is unchanged.
  const reusableStoredKey =
    existingCreds.endpoint && existingCreds.endpoint === endpoint
      ? existingCreds.apiKey
      : undefined;
  const apiKey = cliOptions.apiKey ?? readAutoMemApiKeyFromEnv() ?? reusableStoredKey;
  const rulesPath = cliOptions.rulesPath ?? paths.agentsPath;
  const disabledServers = readDisabledMcpServers(paths.configPath);

  // ~/.grok/AGENTS.md is injected into every Grok session regardless of which repo it
  // runs in, so no single project tag can be correct there — a baked-in slug hard-gates
  // every later recall and mistags every store, silently, because tags filter before
  // scoring. The decision is the target file, not the flags: `--name` with the default
  // path, or `--rules` pointed at the global file, are still writing the global file.
  const writesGlobalRules = path.resolve(rulesPath) === path.resolve(paths.agentsPath);
  const rulesProjectName = writesGlobalRules ? GLOBAL_PROJECT_PLACEHOLDER : projectName;

  log(`\n🔧 Setting up Grok AutoMem for: ${projectName}`, cliOptions.quiet);
  log(`📁 Grok home: ${paths.home}`, cliOptions.quiet);
  log(`📄 Config: ${paths.configPath}`, cliOptions.quiet);
  log(`📄 Rules: ${rulesPath}\n`, cliOptions.quiet);

  const entry = buildGrokAutoMemServerEntry(endpoint, apiKey);
  const result = upsertGrokMemoryServer(paths.configPath, entry, {
    dryRun: cliOptions.dryRun,
    quiet: cliOptions.quiet,
  });

  if (result.method === 'toml' && result.changed) {
    log(`✅ Registered AutoMem MCP server (mcp_servers.${GROK_MCP_SERVER_NAME})`, cliOptions.quiet);
  }

  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, {
    PROJECT_NAME: rulesProjectName,
  });
  const existingContent = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null;
  const finalContent = upsertRulesWithMarkers(existingContent, processed, rulesPath);
  writeFileWithBackup(rulesPath, finalContent, cliOptions);

  // Diagnostics describe existing state rather than work performed, so they belong in
  // the preview too — a dry run is exactly when someone wants to hear about them.
  const diagnostics: string[] = [];
  if (!apiKey) {
    diagnostics.push(
      '  ⚠️  No AUTOMEM_API_KEY set — set one before connecting to a remote AutoMem instance'
    );
  }
  if (disabledServers.includes(GROK_MCP_SERVER_NAME)) {
    // This top-level list gates MCP servers independently of a server's own `enabled`
    // flag, so the install can look successful while AutoMem never loads.
    diagnostics.push(
      `  ⚠️  "${GROK_MCP_SERVER_NAME}" is listed in disabled_mcp_servers — Grok may ignore the server entry.`,
      `      Remove it from that list in ${path.basename(paths.configPath)} to enable AutoMem.`
    );
  }

  // A dry run has written nothing, so it must not claim it did. The per-step
  // "[DRY RUN] Would …" lines above are the whole report of pending work.
  if (cliOptions.dryRun) {
    log('\n📊 Dry run — no files were changed.', cliOptions.quiet);
    for (const line of diagnostics) log(line, cliOptions.quiet);
    return;
  }

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log(
    `  ✅ mcp_servers.${GROK_MCP_SERVER_NAME} written to ${path.basename(paths.configPath)}`,
    cliOptions.quiet
  );
  log(`  ✅ AutoMem rules installed in ${path.basename(rulesPath)}`, cliOptions.quiet);
  for (const line of diagnostics) log(line, cliOptions.quiet);

  log('\n✨ Grok AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  1. Start a new Grok session (existing sessions keep the old MCP child)', cliOptions.quiet);
  log(
    '  2. Confirm: grok mcp list  →  memory: npx -y @verygoodplugins/mcp-automem',
    cliOptions.quiet
  );
  log(
    '  3. Prefer native config.toml over Claude/Cursor compat imports for AutoMem',
    cliOptions.quiet
  );
}

function parseArgs(args: string[]): GrokSetupOptions {
  let endpoint: string | undefined;
  let apiKey: string | undefined;
  let rulesPath: string | undefined;
  const common = parseCommonFlags(args, {
    '--endpoint': { kind: 'value', set: (v) => (endpoint = v) },
    '--api-key': { kind: 'value', set: (v) => (apiKey = v) },
    '--rules': { kind: 'value', set: (v) => (rulesPath = v) },
  });
  return { ...common, endpoint, apiKey, rulesPath };
}

export async function runGrokSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyGrokSetup(options);
}

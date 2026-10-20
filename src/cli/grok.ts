import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CommonOptions,
  detectProjectName,
  log,
  type MarkedBlockMarkers,
  parseCommonFlags,
  replaceTemplateVars,
  resolveInheritedApiKey,
  stripMarkedBlock,
  upsertMarkedBlock,
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
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';

export interface GrokSetupOptions extends CommonOptions {
  endpoint?: string;
  apiKey?: string;
  rulesPath?: string;
}

const TEMPLATE_ROOT = path.resolve(fileURLToPath(new URL('../../templates/grok', import.meta.url)));

export const GROK_RULES_START = '<!-- BEGIN AUTOMEM GROK RULES -->';
export const GROK_RULES_END = '<!-- END AUTOMEM GROK RULES -->';
const GROK_RULES_MARKERS: MarkedBlockMarkers = { start: GROK_RULES_START, end: GROK_RULES_END };

/**
 * Stands in for the project tag when the rules land in the global
 * `~/.grok/AGENTS.md`. Matches what the Claude Desktop instructions use for the
 * same reason: the file is not project-scoped, so no single slug can be correct.
 */
export const GLOBAL_PROJECT_PLACEHOLDER = '<project-slug>';

/**
 * Whether two paths name the same file. Resolves symlinks, because the global rules
 * file is commonly a symlink into a dotfiles repo and `--rules <real target>` then
 * spells the same file differently. Falls back to lexical resolution for paths that do
 * not exist yet, which is the normal case on a first install.
 */
function sameFile(a: string, b: string): boolean {
  const real = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      // Not created yet — the first-install case. Resolve the parent instead, so a
      // symlinked `~/.grok` still matches a `--rules` path spelled through its real
      // directory; falling straight back to a lexical compare would call them different
      // files and bake a project into the global rules.
      try {
        return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
      } catch {
        return path.resolve(p);
      }
    }
  };
  return real(a) === real(b);
}

export function stripGrokRulesMarkers(existing: string): string {
  return stripMarkedBlock(existing, GROK_RULES_MARKERS);
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
  // A key belongs to the endpoint it was issued for. Pairing every inherited key with
  // its own endpoint lives in the shared resolver, which all hosts use — the same
  // disclosure was filed separately against three of them.
  const apiKey = resolveInheritedApiKey({
    endpoint,
    explicitKey: cliOptions.apiKey,
    storedEndpoint: existingCreds.endpoint,
    storedKey: existingCreds.apiKey,
  });
  const rulesPath = cliOptions.rulesPath ?? paths.agentsPath;

  // `--rules` pointing at config.toml (directly or through a symlink) would write the
  // server entry as TOML and then overwrite the whole file with Markdown rules,
  // destroying the registration it just made and leaving Grok an unparseable config.
  if (sameFile(rulesPath, paths.configPath)) {
    throw new Error(
      `Refusing to write AutoMem rules to ${rulesPath}: that is the Grok config file. ` +
        'Point --rules at a Markdown rules file (for example <grok-home>/AGENTS.md).'
    );
  }
  const disabledServers = readDisabledMcpServers(paths.configPath);

  // ~/.grok/AGENTS.md is injected into every Grok session regardless of which repo it
  // runs in, so no single project tag can be correct there — a baked-in slug hard-gates
  // every later recall and mistags every store, silently, because tags filter before
  // scoring. The decision is the target file, not the flags: `--name` with the default
  // path, or `--rules` pointed at the global file, are still writing the global file.
  // Compared by file identity, not spelling: the global rules are commonly a symlink
  // into a dotfiles repo, and `--rules <the real target>` addresses the same file.
  const writesGlobalRules = sameFile(rulesPath, paths.agentsPath);
  const rulesProjectName = writesGlobalRules ? GLOBAL_PROJECT_PLACEHOLDER : projectName;

  log(`\n🔧 Setting up Grok AutoMem for: ${projectName}`, cliOptions.quiet);
  log(`📁 Grok home: ${paths.home}`, cliOptions.quiet);
  log(`📄 Config: ${paths.configPath}`, cliOptions.quiet);
  log(`📄 Rules: ${rulesPath}\n`, cliOptions.quiet);

  // Everything that can reject the run happens before anything is written. Both the
  // rules content and the server entry are computed up front: upsertMarkedBlock
  // throws on a stray marker, and building the entry is pure. Validating after the
  // config write would leave a failed run having already replaced the live endpoint and
  // credentials while telling the user to repair their rules file and re-run.
  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, {
    PROJECT_NAME: rulesProjectName,
  });
  const existingContent = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null;
  const finalContent = upsertMarkedBlock(existingContent, processed, GROK_RULES_MARKERS, rulesPath);
  const entry = buildGrokAutoMemServerEntry(endpoint, apiKey);

  const result = upsertGrokMemoryServer(paths.configPath, entry, {
    dryRun: cliOptions.dryRun,
    quiet: cliOptions.quiet,
  });

  if (result.method === 'toml' && result.changed) {
    log(`✅ Registered AutoMem MCP server (mcp_servers.${GROK_MCP_SERVER_NAME})`, cliOptions.quiet);
  }

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

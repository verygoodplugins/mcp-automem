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
  upsertMarkedBlock,
  writeFileWithBackup,
} from './host-toolkit.js';
import { configureCodexMemory, resolveCodexPaths } from './codex-config.js';
import { AUTOMEM_NPX_COMMAND } from './templates.js';

export interface CodexSetupOptions extends CommonOptions {
  rulesPath?: string; // default: ./AGENTS.md
  endpoint?: string;
  apiKey?: string;
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/codex', import.meta.url))
);

export const CODEX_RULES_START = '<!-- BEGIN AUTOMEM CODEX RULES -->';
export const CODEX_RULES_END = '<!-- END AUTOMEM CODEX RULES -->';
export const CODEX_RULES_MARKERS: MarkedBlockMarkers = {
  start: CODEX_RULES_START,
  end: CODEX_RULES_END,
};
export const CODEX_USAGE = `CODEX SETUP:
  ${AUTOMEM_NPX_COMMAND} codex [options]

  Options:
    --dir <path>          Codex home directory (default: $CODEX_HOME or ~/.codex)
    --name <name>         Project name (auto-detected if not provided)
    --rules <path>        Target rules file (default: ./AGENTS.md)
    --endpoint <url>      AutoMem endpoint (default: $AUTOMEM_API_URL or http://127.0.0.1:8001)
    --api-key <key>       API key (or use $AUTOMEM_API_KEY)
    --dry-run             Show what would be changed
    --quiet               Suppress output`;

export async function applyCodexSetup(cliOptions: CodexSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();
  const rulesPath = cliOptions.rulesPath ?? path.join(process.cwd(), 'AGENTS.md');
  const paths = resolveCodexPaths({ dir: cliOptions.targetDir });
  const identity = (file: string): string => {
    try {
      return fs.realpathSync(file);
    } catch {
      try {
        return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
      } catch {
        return path.resolve(file);
      }
    }
  };
  if (
    [paths.configPath, paths.connectionPath].some((file) => identity(file) === identity(rulesPath))
  ) {
    throw new Error('Refusing to write Codex rules over the MCP configuration or connection file.');
  }

  const vars = {
    PROJECT_NAME: projectName,
  };

  log(`\n🔧 Setting up Codex AutoMem rules for: ${projectName}`, cliOptions.quiet);
  log(`📄 Target rules file: ${rulesPath}\n`, cliOptions.quiet);

  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, vars);

  const existingContent = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null;
  const finalContent = upsertMarkedBlock(
    existingContent,
    processed,
    CODEX_RULES_MARKERS,
    rulesPath
  );
  configureCodexMemory({
    paths,
    endpoint: cliOptions.endpoint,
    apiKey: cliOptions.apiKey,
    dryRun: cliOptions.dryRun,
    quiet: cliOptions.quiet,
  });
  writeFileWithBackup(rulesPath, finalContent, cliOptions);

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log(
    cliOptions.dryRun
      ? '  ℹ️ Dry run — no files changed.'
      : '  ✅ AutoMem MCP server and project rules installed.',
    cliOptions.quiet
  );
  log(
    `  🔒 Connection ${cliOptions.dryRun ? 'would be stored' : 'stored'} in ${paths.connectionPath}`,
    cliOptions.quiet
  );
  if (cliOptions.dryRun) return;

  log('✨ Codex AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  Start a new Codex session to use memory.', cliOptions.quiet);
}

function parseArgs(args: string[]): CodexSetupOptions {
  let rulesPath: string | undefined;
  let endpoint: string | undefined;
  let apiKey: string | undefined;
  const common = parseCommonFlags(args, {
    '--rules': { kind: 'value', set: (v) => (rulesPath = v) },
    '--endpoint': { kind: 'value', set: (v) => (endpoint = v) },
    '--api-key': { kind: 'value', set: (v) => (apiKey = v) },
  });
  return { ...common, rulesPath, endpoint, apiKey };
}

export async function runCodexSetup(args: string[] = []): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(CODEX_USAGE);
    return;
  }
  const options = parseArgs(args);
  await applyCodexSetup(options);
}

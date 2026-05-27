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
  resolveHermesPaths,
  upsertMcpServer,
} from './hermes-config.js';
import { readAutoMemApiKeyFromEnv } from '../env.js';
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';

export interface HermesSetupOptions extends CommonOptions {
  endpoint?: string;
  apiKey?: string;
  rulesPath?: string;
}

// Hermes reuses the codex AGENTS.md template verbatim for v1. If the content
// diverges later, rename templates/codex/memory-rules.md → templates/shared/memory-rules.md
// and update both this file and codex.ts to read from the new path.
const CODEX_TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/codex', import.meta.url))
);

function upsertRulesWithMarkers(existing: string | null, block: string): string {
  // Markers match codex.ts so the template is mechanically shareable. The
  // tag says "CODEX" but the convention is just "AutoMem-managed rules
  // block" — see CLAUDE.md follow-up for a generic rename.
  const start = '<!-- BEGIN AUTOMEM CODEX RULES -->';
  const end = '<!-- END AUTOMEM CODEX RULES -->';
  // Normalize to exactly one trailing newline so re-runs are byte-stable
  // (the previous codex.ts shape accreted a newline each merge).
  const normalize = (s: string) => `${s.replace(/\n+$/, '')}\n`;
  if (!existing) {
    return normalize(block);
  }
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + end.length);
    return normalize(`${before}${block}${after}`);
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return normalize(`${existing}${sep}${block}`);
}

export async function applyHermesSetup(cliOptions: HermesSetupOptions): Promise<void> {
  const paths = resolveHermesPaths({ dir: cliOptions.targetDir });
  const projectName = cliOptions.projectName ?? detectProjectName();
  const endpoint =
    cliOptions.endpoint ??
    process.env.AUTOMEM_API_URL ??
    process.env.AUTOMEM_ENDPOINT ??
    DEFAULT_AUTOMEM_API_URL;
  const apiKey = cliOptions.apiKey ?? readAutoMemApiKeyFromEnv();
  const rulesPath = cliOptions.rulesPath ?? paths.agentsPath;

  log(`\n🔧 Setting up Hermes AutoMem rules for: ${projectName}`, cliOptions.quiet);
  log(`📁 Hermes home: ${paths.home}`, cliOptions.quiet);
  log(`📄 Config: ${paths.configPath}`, cliOptions.quiet);
  log(`📄 Rules: ${rulesPath}\n`, cliOptions.quiet);

  const entry = buildAutoMemServerEntry(endpoint, apiKey);
  const result = await upsertMcpServer(paths, 'memory', entry, {
    dryRun: cliOptions.dryRun,
    quiet: cliOptions.quiet,
  });

  if (result.method === 'hermes-cli') {
    log('✅ Registered memory server via Hermes CLI (`hermes mcp add`)', cliOptions.quiet);
  } else if (result.method === 'yaml-fallback') {
    log('✅ Registered memory server via direct YAML edit', cliOptions.quiet);
  }

  const templateContent = fs.readFileSync(
    path.join(CODEX_TEMPLATE_ROOT, 'memory-rules.md'),
    'utf8',
  );
  const processed = replaceTemplateVars(templateContent, { PROJECT_NAME: projectName });

  const existingContent = fs.existsSync(rulesPath)
    ? fs.readFileSync(rulesPath, 'utf8')
    : null;
  const finalContent = upsertRulesWithMarkers(existingContent, processed);
  writeFileWithBackup(rulesPath, finalContent, cliOptions);

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log(`  ✅ mcp_servers.memory written to ${path.basename(paths.configPath)}`, cliOptions.quiet);
  log(`  ✅ AutoMem rules installed in ${path.basename(rulesPath)}`, cliOptions.quiet);
  if (!apiKey) {
    log('  ⚠️  No AUTOMEM_API_KEY set — set one before connecting to a remote AutoMem instance', cliOptions.quiet);
  }

  log('\n✨ Hermes AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  1. Restart Hermes (or run /reload-mcp) to pick up the memory server', cliOptions.quiet);
  log('  2. Start a task — Hermes should proactively recall/store with AutoMem', cliOptions.quiet);
  log('  3. To temporarily disable rule injection: export HERMES_IGNORE_RULES=true', cliOptions.quiet);
}

function parseArgs(args: string[]): HermesSetupOptions {
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

export async function runHermesSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyHermesSetup(options);
}

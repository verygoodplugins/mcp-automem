import fs from 'fs';
import os from 'os';
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
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';

interface OpenCodeSetupOptions extends CommonOptions {
  configPath?: string; // default: ~/.config/opencode/opencode.json
  rulesPath?: string; // default: ./AGENTS.md
  endpoint?: string;
  apiKey?: string;
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/opencode', import.meta.url))
);

export function defaultOpenCodeConfigPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.config', 'opencode', 'opencode.json');
}

function upsertRulesWithMarkers(existing: string | null, block: string): string {
  const start = '<!-- BEGIN AUTOMEM OPENCODE RULES -->';
  const end = '<!-- END AUTOMEM OPENCODE RULES -->';
  if (!existing) {
    return `${block}\n`;
  }
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + end.length);
    return `${before}${block}${after}`;
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}\n`;
}

// Merge the `mcp.memory` server block into an existing opencode.json without
// touching any other key. An unparseable existing config aborts (never clobber
// a file we cannot round-trip); an existing `mcp.memory` entry is replaced.
export function mergeOpenCodeConfig(
  existingRaw: string | null,
  memoryServer: Record<string, unknown>
): string {
  let config: Record<string, unknown> = {};
  if (existingRaw !== null && existingRaw.trim() !== '') {
    const parsed = JSON.parse(existingRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('existing opencode.json is not a JSON object');
    }
    config = parsed as Record<string, unknown>;
  }
  if (!('$schema' in config)) {
    config.$schema = 'https://opencode.ai/config.json';
  }
  const mcp =
    config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp)
      ? (config.mcp as Record<string, unknown>)
      : {};
  mcp.memory = memoryServer;
  config.mcp = mcp;
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function applyOpenCodeSetup(cliOptions: OpenCodeSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();
  const configPath = cliOptions.configPath ?? defaultOpenCodeConfigPath();
  const rulesPath = cliOptions.rulesPath ?? path.join(process.cwd(), 'AGENTS.md');

  const endpoint =
    cliOptions.endpoint ||
    process.env.AUTOMEM_API_URL ||
    process.env.AUTOMEM_ENDPOINT ||
    DEFAULT_AUTOMEM_API_URL;
  const apiKey = cliOptions.apiKey ?? process.env.AUTOMEM_API_KEY ?? '';

  log(`\n🔧 Setting up OpenCode AutoMem integration for: ${projectName}`, cliOptions.quiet);
  log(`📄 Config: ${configPath}`, cliOptions.quiet);
  log(`📄 Rules:  ${rulesPath}\n`, cliOptions.quiet);

  // 1. MCP server block in opencode.json
  const environment: Record<string, string> = { AUTOMEM_API_URL: endpoint };
  if (apiKey) {
    environment.AUTOMEM_API_KEY = apiKey;
  }
  const memoryServer = {
    type: 'local',
    command: ['npx', '-y', '@verygoodplugins/mcp-automem'],
    enabled: true,
    environment,
  };

  const existingConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
  let mergedConfig: string;
  try {
    mergedConfig = mergeOpenCodeConfig(existingConfig, memoryServer);
  } catch (error) {
    console.error(
      `Error: could not parse ${configPath} — fix or remove it and re-run. (${String(error)})`
    );
    process.exit(1);
  }
  // The config may carry an API key: back up + restrict like other secret-bearing files.
  writeFileWithBackup(configPath, mergedConfig, {
    dryRun: cliOptions.dryRun,
    quiet: cliOptions.quiet,
    secret: Boolean(apiKey),
  });

  // 2. Memory policy rules in AGENTS.md (OpenCode reads project AGENTS.md natively)
  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, { PROJECT_NAME: projectName });
  const existingRules = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null;
  const finalRules = upsertRulesWithMarkers(existingRules, processed);
  writeFileWithBackup(rulesPath, finalRules, cliOptions);

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log('  ✅ MCP server `memory` configured (opencode.json)', cliOptions.quiet);
  log('  ✅ Memory rules installed (AGENTS.md)', cliOptions.quiet);
  if (!apiKey) {
    log(
      '  ℹ️ No AUTOMEM_API_KEY found — set it in the config `environment` block if your instance requires auth.',
      cliOptions.quiet
    );
  }

  log('\n✨ OpenCode AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  1. Restart OpenCode to reload MCP servers', cliOptions.quiet);
  log('  2. Verify with: opencode mcp list  (expect: ✓ memory connected)', cliOptions.quiet);
}

function parseArgs(args: string[]): OpenCodeSetupOptions {
  let configPath: string | undefined;
  let rulesPath: string | undefined;
  let endpoint: string | undefined;
  let apiKey: string | undefined;
  const common = parseCommonFlags(args, {
    '--config': { kind: 'value', set: (v) => (configPath = v) },
    '--rules': { kind: 'value', set: (v) => (rulesPath = v) },
    '--endpoint': { kind: 'value', set: (v) => (endpoint = v) },
    '--api-key': { kind: 'value', set: (v) => (apiKey = v) },
  });
  return { ...common, configPath, rulesPath, endpoint, apiKey };
}

export async function runOpenCodeSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyOpenCodeSetup(options);
}

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

interface CodexSetupOptions extends CommonOptions {
  rulesPath?: string; // default: ./AGENTS.md
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/codex', import.meta.url))
);

function upsertRulesWithMarkers(existing: string | null, block: string): string {
  const start = '<!-- BEGIN AUTOMEM CODEX RULES -->';
  const end = '<!-- END AUTOMEM CODEX RULES -->';
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

export async function applyCodexSetup(cliOptions: CodexSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();
  const rulesPath = cliOptions.rulesPath ?? path.join(process.cwd(), 'AGENTS.md');

  const vars = {
    PROJECT_NAME: projectName,
  };

  log(`\n🔧 Setting up Codex AutoMem rules for: ${projectName}`, cliOptions.quiet);
  log(`📄 Target rules file: ${rulesPath}\n`, cliOptions.quiet);

  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, vars);

  const existingContent = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null;
  const finalContent = upsertRulesWithMarkers(existingContent, processed);
  writeFileWithBackup(rulesPath, finalContent, cliOptions);

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log('  ✅ Project rules installed (AGENTS.md)', cliOptions.quiet);
  log('  ℹ️ Ensure Codex MCP config includes the memory server:', cliOptions.quiet);
  log('     ~/.codex/config.toml', cliOptions.quiet);
  log('     (see templates/codex/config.toml for an example)\n', cliOptions.quiet);

  log('✨ Codex AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  1. Restart Codex CLI/IDE to reload MCP servers', cliOptions.quiet);
  log('  2. Start a task - Codex should proactively recall/store with memory', cliOptions.quiet);
}

function parseArgs(args: string[]): CodexSetupOptions {
  let rulesPath: string | undefined;
  const common = parseCommonFlags(args, {
    '--rules': { kind: 'value', set: (v) => (rulesPath = v) },
  });
  return { ...common, rulesPath };
}

export async function runCodexSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyCodexSetup(options);
}

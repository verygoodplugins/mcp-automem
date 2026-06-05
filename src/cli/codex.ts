import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CommonOptions,
  HooksConfig,
  detectProjectName,
  log,
  mergeHooksConfig,
  parseCommonFlags,
  replaceTemplateVars,
  writeFileWithBackup,
} from './host-toolkit.js';

export interface CodexSetupOptions extends CommonOptions {
  rulesPath?: string; // default: ./AGENTS.md
  noHooks?: boolean;
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/codex', import.meta.url))
);
const HOOK_SCRIPTS = [
  'automem-session-start.sh',
  'capture-build-result.sh',
  'capture-test-pattern.sh',
  'capture-deployment.sh',
] as const;
const SUPPORT_SCRIPTS = [
  'python-command.sh',
  'queue-cleanup.sh',
  'drain-queue.sh',
  'memory-filters.json',
] as const;

function upsertRulesWithMarkers(existing: string | null, block: string): string {
  const start = '<!-- BEGIN AUTOMEM CODEX RULES -->';
  const end = '<!-- END AUTOMEM CODEX RULES -->';
  const normalize = (value: string) => `${value.replace(/\n+$/, '')}\n`;
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hookCommand(codexHome: string, subdir: 'hooks' | 'scripts', scriptName: string): string {
  return `CODEX_HOME=${shellQuote(codexHome)} bash ${shellQuote(path.join(codexHome, subdir, scriptName))}`;
}

function buildCodexHooks(codexHome: string): { hooks: HooksConfig } {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume',
          hooks: [
            {
              type: 'command',
              command: hookCommand(codexHome, 'hooks', 'automem-session-start.sh'),
              statusMessage: 'Loading AutoMem recall guidance',
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: hookCommand(codexHome, 'hooks', 'capture-build-result.sh'),
              statusMessage: 'Capturing AutoMem build signal',
            },
            {
              type: 'command',
              command: hookCommand(codexHome, 'hooks', 'capture-test-pattern.sh'),
              statusMessage: 'Capturing AutoMem test signal',
            },
            {
              type: 'command',
              command: hookCommand(codexHome, 'hooks', 'capture-deployment.sh'),
              statusMessage: 'Capturing AutoMem deployment signal',
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand(codexHome, 'scripts', 'drain-queue.sh'),
              timeout: 30,
              statusMessage: 'Draining AutoMem memory queue',
            },
          ],
        },
      ],
    },
  };
}

function installTemplateFiles(params: {
  templateSubdir: string;
  targetSubdir: string;
  fileNames: readonly string[];
  options: CodexSetupOptions;
}): void {
  const templateDir = path.join(TEMPLATE_ROOT, params.templateSubdir);
  const targetDir = params.targetSubdir;
  for (const fileName of params.fileNames) {
    const templatePath = path.join(templateDir, fileName);
    const targetPath = path.join(targetDir, fileName);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Codex template not found: ${templatePath}`);
    }

    writeFileWithBackup(targetPath, fs.readFileSync(templatePath, 'utf8'), params.options);
    if (!params.options.dryRun && (fileName.endsWith('.sh') || fileName.endsWith('.py'))) {
      fs.chmodSync(targetPath, 0o755);
    }
  }
}

function mergeHooksJson(codexHome: string, options: CodexSetupOptions): void {
  const targetPath = path.join(codexHome, 'hooks.json');
  const templateHooks = buildCodexHooks(codexHome);

  if (!fs.existsSync(targetPath)) {
    writeFileWithBackup(targetPath, `${JSON.stringify(templateHooks, null, 2)}\n`, options);
    return;
  }

  let current: { hooks?: HooksConfig } & Record<string, unknown>;
  try {
    current = JSON.parse(fs.readFileSync(targetPath, 'utf8')) as { hooks?: HooksConfig } & Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot parse existing Codex hooks.json at ${targetPath}: ${(error as Error).message}`, {
      cause: error,
    });
  }

  const merged = {
    ...current,
    hooks: mergeHooksConfig(current.hooks ?? {}, templateHooks.hooks),
  };
  writeFileWithBackup(targetPath, `${JSON.stringify(merged, null, 2)}\n`, options);
}

export async function applyCodexSetup(cliOptions: CodexSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();
  const rulesPath = cliOptions.rulesPath ?? path.join(process.cwd(), 'AGENTS.md');
  const codexHome = cliOptions.targetDir ?? path.join(os.homedir(), '.codex');

  const vars = {
    PROJECT_NAME: projectName,
  };

  log(`\n🔧 Setting up Codex AutoMem rules for: ${projectName}`, cliOptions.quiet);
  log(`📁 Codex home: ${codexHome}`, cliOptions.quiet);
  log(`📄 Target rules file: ${rulesPath}\n`, cliOptions.quiet);

  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, vars);

  const existingContent = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null;
  const finalContent = upsertRulesWithMarkers(existingContent, processed);
  writeFileWithBackup(rulesPath, finalContent, cliOptions);

  if (!cliOptions.noHooks) {
    installTemplateFiles({
      templateSubdir: 'hooks',
      targetSubdir: path.join(codexHome, 'hooks'),
      fileNames: HOOK_SCRIPTS,
      options: cliOptions,
    });
    installTemplateFiles({
      templateSubdir: 'scripts',
      targetSubdir: path.join(codexHome, 'scripts'),
      fileNames: SUPPORT_SCRIPTS,
      options: cliOptions,
    });
    mergeHooksJson(codexHome, cliOptions);
  }

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log('  ✅ Project rules installed (AGENTS.md)', cliOptions.quiet);
  if (cliOptions.noHooks) {
    log('  ℹ️ Codex hooks skipped (--no-hooks)', cliOptions.quiet);
  } else {
    log('  ✅ Codex hooks installed (review/trust them with /hooks)', cliOptions.quiet);
  }
  log('  ℹ️ Ensure Codex MCP config includes the memory server:', cliOptions.quiet);
  log('     ~/.codex/config.toml', cliOptions.quiet);
  log('     (see templates/codex/config.toml for an example)\n', cliOptions.quiet);

  log('✨ Codex AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  1. Restart Codex CLI/IDE to reload MCP servers', cliOptions.quiet);
  if (!cliOptions.noHooks) {
    log('  2. Run /hooks and trust the new AutoMem hook definitions', cliOptions.quiet);
    log('  3. Start a task - Codex should proactively recall/store with memory', cliOptions.quiet);
  } else {
    log('  2. Start a task - Codex should proactively recall/store with memory', cliOptions.quiet);
  }
}

function parseArgs(args: string[]): CodexSetupOptions {
  let rulesPath: string | undefined;
  let noHooks = false;
  const common = parseCommonFlags(args, {
    '--rules': { kind: 'value', set: (v) => (rulesPath = v) },
    '--no-hooks': { kind: 'boolean', set: () => (noHooks = true) },
  });
  return { ...common, rulesPath, noHooks };
}

export async function runCodexSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyCodexSetup(options);
}

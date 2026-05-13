import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Type Definitions (T002, T003) ---

export interface CopilotSetupOptions {
  targetDir?: string;
  format?: 'cli' | 'vscode';
  dryRun?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

export interface CopilotHookEntry {
  type: 'command' | 'prompt' | 'http';
  bash?: string;
  powershell?: string;
  command?: string;
  prompt?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
}

export interface CopilotHookFile {
  version: 1;
  hooks: Record<string, CopilotHookEntry[]>;
}

export const EVENT_NAMES = {
  cli: {
    sessionStart: 'sessionStart',
    postToolUse: 'postToolUse',
    sessionEnd: 'sessionEnd',
  },
  vscode: {
    sessionStart: 'SessionStart',
    postToolUse: 'PostToolUse',
    sessionEnd: 'SessionEnd',
  },
} as const;

// --- Constants ---

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/copilot', import.meta.url))
);

const HOOK_FILES = [
  'automem-session-start.json',
  'automem-post-tool-use.json',
  'automem-session-end.json',
];

const SUPPORT_SCRIPTS = [
  'automem-session-start.sh',
  'capture-build-result.sh',
  'capture-test-pattern.sh',
  'capture-deployment.sh',
  'session-memory.sh',
  'python-command.sh',
  'queue-cleanup.sh',
  'process-session-memory.py',
  'memory-filters.json',
];

// Map from template event key (camelCase) to internal event name for remapping
const EVENT_KEY_MAP: Record<string, keyof typeof EVENT_NAMES.cli> = {
  sessionStart: 'sessionStart',
  postToolUse: 'postToolUse',
  sessionEnd: 'sessionEnd',
};

// --- Helpers ---

function log(message: string, quiet?: boolean) {
  if (!quiet) {
    console.log(message);
  }
}

function backupPath(filePath: string): string {
  let candidate = `${filePath}.bak`;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${filePath}.bak.${counter}`;
    counter += 1;
  }
  return candidate;
}

function writeFileWithBackup(targetPath: string, content: string, options: CopilotSetupOptions) {
  if (options.dryRun) {
    log(`dry-run: would write ${targetPath}`, options.quiet);
    return;
  }

  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(targetPath)) {
    const current = fs.readFileSync(targetPath, 'utf8');
    if (current === content) {
      return;
    }
    const backup = backupPath(targetPath);
    fs.copyFileSync(targetPath, backup);
    log(`backup created: ${backup}`, options.quiet);
  }

  fs.writeFileSync(targetPath, content, 'utf8');
}

/**
 * Remap event name keys in a hook JSON object based on the selected format.
 * Templates use camelCase keys; when --format vscode is chosen, remap to PascalCase.
 */
function remapHookEventNames(hookData: CopilotHookFile, format: 'cli' | 'vscode'): CopilotHookFile {
  if (format === 'cli') {
    return hookData;
  }

  const names = EVENT_NAMES[format];
  const remapped: Record<string, CopilotHookEntry[]> = {};

  for (const [key, entries] of Object.entries(hookData.hooks)) {
    const eventId = EVENT_KEY_MAP[key];
    const newKey = eventId ? names[eventId] : key;
    remapped[newKey] = entries;
  }

  return { ...hookData, hooks: remapped };
}

// --- Core Installer Logic (T017-T022) ---

function installHookFiles(targetDir: string, options: CopilotSetupOptions) {
  const hookTemplateDir = path.join(TEMPLATE_ROOT, 'hooks');
  const hookTargetDir = path.join(targetDir, 'hooks');
  const format = options.format ?? 'cli';

  for (const hookFileName of HOOK_FILES) {
    const templatePath = path.join(hookTemplateDir, hookFileName);
    const targetPath = path.join(hookTargetDir, hookFileName);

    if (!fs.existsSync(templatePath)) {
      console.error(`Error: Template file not found at ${templatePath} - package may be corrupted`);
      process.exit(1);
    }

    let hookData: CopilotHookFile;
    try {
      hookData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    } catch (err) {
      console.error(`Error: Cannot parse template ${templatePath}: ${(err as Error).message}`);
      process.exit(1);
    }

    // Remap event names based on --format (T026)
    hookData = remapHookEventNames(hookData, format);

    const content = `${JSON.stringify(hookData, null, 2)}\n`;
    writeFileWithBackup(targetPath, content, options);

    if (!options.dryRun) {
      log(`installed hook: ${hookFileName}`, options.quiet);
    }
  }
}

function installSupportScripts(targetDir: string, options: CopilotSetupOptions) {
  const scriptTemplateDir = path.join(TEMPLATE_ROOT, 'scripts');
  const scriptTargetDir = path.join(targetDir, 'scripts');

  for (const scriptName of SUPPORT_SCRIPTS) {
    const templatePath = path.join(scriptTemplateDir, scriptName);
    const targetPath = path.join(scriptTargetDir, scriptName);

    if (!fs.existsSync(templatePath)) {
      console.error(`Error: Template file not found at ${templatePath} - package may be corrupted`);
      process.exit(1);
    }

    const content = fs.readFileSync(templatePath, 'utf8');
    writeFileWithBackup(targetPath, content, options);

    if (!options.dryRun && (scriptName.endsWith('.sh') || scriptName.endsWith('.py'))) {
      fs.chmodSync(targetPath, 0o755);
    }

    if (!options.dryRun) {
      log(`installed script: ${scriptName}`, options.quiet);
    }
  }
}

// --- Public API ---

export async function applyCopilotSetup(cliOptions: CopilotSetupOptions): Promise<void> {
  const options: CopilotSetupOptions = {
    ...cliOptions,
    targetDir: cliOptions.targetDir ?? path.join(os.homedir(), '.copilot'),
    format: cliOptions.format ?? 'cli',
  };

  const targetDir = options.targetDir!;

  // T019: Dry-run header
  if (options.dryRun) {
    log(`Configuring Copilot in ${targetDir} (dry run)`, options.quiet);
  } else {
    log(`Configuring Copilot in ${targetDir}`, options.quiet);
  }

  // T032: Create target directories (including when --dir points to non-existent path)
  if (!options.dryRun) {
    fs.mkdirSync(path.join(targetDir, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
  }

  log('', options.quiet);

  // Install hook JSON files and support scripts
  installHookFiles(targetDir, options);
  installSupportScripts(targetDir, options);

  // T021/T030: Post-installation summary (skip for dry-run - files listed inline already)
  if (!options.dryRun) {
    log('', options.quiet);
    log('\u2713 Hook JSON files installed for automatic memory capture', options.quiet);
    log('\u2713 Support scripts installed for queue processing', options.quiet);
    log('', options.quiet);
    log('Next steps:', options.quiet);
    log('1. Add MCP server to Copilot config (see INSTALLATION.md)', options.quiet);
    log('2. Add memory rules: cat templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md >> ~/.copilot/copilot-instructions.md', options.quiet);
    log('3. Restart Copilot', options.quiet);
  }
}

// T016: CLI argument parser
function parseCopilotArgs(args: string[]): CopilotSetupOptions {
  const options: CopilotSetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
        options.targetDir = args[i + 1];
        i += 1;
        break;
      case '--format':
        options.format = args[i + 1] as 'cli' | 'vscode';
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--yes':
      case '-y':
        options.yes = true;
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

export async function runCopilotSetup(args: string[] = []): Promise<void> {
  const options = parseCopilotArgs(args);

  // T027: Validate --format
  if (options.format !== undefined && options.format !== 'cli' && options.format !== 'vscode') {
    console.error(`Error: Invalid format '${options.format}'. Valid options: cli, vscode`);
    process.exit(1);
  }

  // T016: Non-interactive terminal detection - auto-set yes=true
  if (!process.stdin.isTTY) {
    options.yes = true;
  }

  await applyCopilotSetup(options);
}

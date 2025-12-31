import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

interface ClaudeCodeSetupOptions {
  targetDir?: string;
  dryRun?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/claude-code', import.meta.url))
);

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

function writeFileWithBackup(targetPath: string, content: string, options: ClaudeCodeSetupOptions) {
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

function mergeUniqueStrings(target: string[] = [], additions: string[]): string[] {
  const set = new Set(target);
  for (const value of additions) {
    if (!set.has(value)) {
      target.push(value);
      set.add(value);
    }
  }
  return target;
}

function mergeSettings(targetSettings: any, templateSettings: any): any {
  const merged = { ...targetSettings };

  // Merge env if not present
  if (!merged.env && templateSettings.env) {
    merged.env = templateSettings.env;
  }

  // Merge hooks - add SessionStart hook for automem if not already present
  if (templateSettings.hooks) {
    merged.hooks = merged.hooks ?? {};
    for (const [hookName, hookConfigs] of Object.entries(templateSettings.hooks)) {
      if (!merged.hooks[hookName]) {
        merged.hooks[hookName] = hookConfigs;
      } else {
        // Check if automem hook already exists
        const existingHooks = merged.hooks[hookName] as any[];
        const hasAutoMemHook = existingHooks.some((config: any) =>
          config.hooks?.some((h: any) =>
            h.command?.includes('automem-session-start.sh')
          )
        );
        if (!hasAutoMemHook) {
          merged.hooks[hookName] = [...existingHooks, ...(hookConfigs as any[])];
        }
      }
    }
  }

  // Merge permissions
  merged.permissions = merged.permissions ?? {};
  const templatePermissions = templateSettings.permissions ?? {};
  merged.permissions.allow = mergeUniqueStrings(
    merged.permissions.allow ?? [],
    templatePermissions.allow ?? []
  );
  merged.permissions.deny = mergeUniqueStrings(
    merged.permissions.deny ?? [],
    templatePermissions.deny ?? []
  );
  merged.permissions.ask = mergeUniqueStrings(
    merged.permissions.ask ?? [],
    templatePermissions.ask ?? []
  );

  return merged;
}

function installHookScript(targetDir: string, options: ClaudeCodeSetupOptions) {
  const hookTemplateDir = path.join(TEMPLATE_ROOT, 'hooks');
  const hookTargetDir = path.join(targetDir, 'hooks');
  const hookScriptName = 'automem-session-start.sh';
  const templatePath = path.join(hookTemplateDir, hookScriptName);
  const targetPath = path.join(hookTargetDir, hookScriptName);

  if (!fs.existsSync(templatePath)) {
    log(`Warning: Hook template not found at ${templatePath}`, options.quiet);
    return;
  }

  const content = fs.readFileSync(templatePath, 'utf8');
  writeFileWithBackup(targetPath, content, options);

  // Make executable
  if (!options.dryRun) {
    fs.chmodSync(targetPath, 0o755);
    log(`installed hook script: ${hookScriptName}`, options.quiet);
  }
}

function mergeSettingsFile(targetDir: string, options: ClaudeCodeSetupOptions) {
  const templateSettingsPath = path.join(TEMPLATE_ROOT, 'settings.json');
  const templateSettings = JSON.parse(fs.readFileSync(templateSettingsPath, 'utf8'));
  const targetPath = path.join(targetDir, 'settings.json');

  if (!fs.existsSync(targetPath)) {
    writeFileWithBackup(
      targetPath,
      `${JSON.stringify(templateSettings, null, 2)}\n`,
      options
    );
    log('installed settings.json', options.quiet);
    return;
  }

  const raw = fs.readFileSync(targetPath, 'utf8');
  let currentSettings: any;
  try {
    currentSettings = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot parse existing settings.json at ${targetPath}: ${(error as Error).message}`);
  }

  const merged = mergeSettings(currentSettings, templateSettings);
  const output = `${JSON.stringify(merged, null, 2)}\n`;

  if (output === raw) {
    log('settings.json already up to date', options.quiet);
    return;
  }

  writeFileWithBackup(targetPath, output, options);
  log('updated settings.json (merged MCP permissions)', options.quiet);
}

function parseClaudeArgs(args: string[]): ClaudeCodeSetupOptions {
  const options: ClaudeCodeSetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
        options.targetDir = args[i + 1];
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

export async function applyClaudeCodeSetup(cliOptions: ClaudeCodeSetupOptions): Promise<void> {
  const options: ClaudeCodeSetupOptions = {
    ...cliOptions,
    targetDir: cliOptions.targetDir ?? path.join(os.homedir(), '.claude'),
  };

  const targetDir = options.targetDir ?? path.join(os.homedir(), '.claude');
  
  log(`Configuring Claude Code in ${targetDir}`, options.quiet);

  if (!options.dryRun) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Install hook script for SessionStart memory recall
  installHookScript(targetDir, options);

  // Merge MCP permissions and hooks into settings.json
  mergeSettingsFile(targetDir, options);

  log('', options.quiet);
  log('✓ SessionStart hook installed for automatic memory recall', options.quiet);
  log('✓ MCP permissions and hooks added to settings.json', options.quiet);
  log('', options.quiet);
  log('Next steps:', options.quiet);
  log('1. Add MCP server to ~/.claude.json (see INSTALLATION.md)', options.quiet);
  log('2. Add memory rules: cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md', options.quiet);
  log('3. Restart Claude Code', options.quiet);
}

export async function runClaudeCodeSetup(args: string[] = []): Promise<void> {
  const options = parseClaudeArgs(args);
  await applyClaudeCodeSetup(options);
}

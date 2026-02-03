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
const HOOK_SCRIPTS = [
  'automem-session-start.sh',
  'capture-build-result.sh',
  'capture-test-pattern.sh',
  'capture-deployment.sh',
  'session-memory.sh',
];
const SUPPORT_SCRIPTS = [
  'queue-cleanup.sh',
  'process-queue.sh',
  'process-session-memory.py',
  'memory-filters.json',
];
const LEGACY_OPTIONAL_SUPPORT_SCRIPTS = ['smart-notify.sh'];

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

function mergeHookEntries(existingHooks: any[] = [], templateHooks: any[]): any[] {
  const merged = existingHooks.map((entry) => ({
    ...entry,
    hooks: Array.isArray(entry?.hooks) ? [...entry.hooks] : [],
  }));

  for (const templateEntry of templateHooks) {
    const matcher = templateEntry?.matcher ?? '';
    const index = merged.findIndex((entry) => (entry?.matcher ?? '') === matcher);

    if (index === -1) {
      merged.push(templateEntry);
      continue;
    }

    const mergedEntry = merged[index];
    const existingHookList = Array.isArray(mergedEntry?.hooks) ? mergedEntry.hooks : [];
    const templateHookList = Array.isArray(templateEntry?.hooks) ? templateEntry.hooks : [];

    for (const hook of templateHookList) {
      const command = hook?.command;
      const alreadyExists = command
        ? existingHookList.some((existing: any) => existing?.command === command)
        : existingHookList.includes(hook);

      if (!alreadyExists) {
        existingHookList.push(hook);
      }
    }

    merged[index] = {
      ...mergedEntry,
      matcher: mergedEntry?.matcher ?? templateEntry?.matcher,
      hooks: existingHookList,
    };
  }

  return merged;
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
        const existingHooks = merged.hooks[hookName] as any[];
        merged.hooks[hookName] = mergeHookEntries(existingHooks, hookConfigs as any[]);
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

function installHookScripts(targetDir: string, options: ClaudeCodeSetupOptions) {
  const hookTemplateDir = path.join(TEMPLATE_ROOT, 'hooks');
  const hookTargetDir = path.join(targetDir, 'hooks');
  for (const hookScriptName of HOOK_SCRIPTS) {
    const templatePath = path.join(hookTemplateDir, hookScriptName);
    const targetPath = path.join(hookTargetDir, hookScriptName);

    if (!fs.existsSync(templatePath)) {
      log(`Warning: Hook template not found at ${templatePath}`, options.quiet);
      continue;
    }

    const content = fs.readFileSync(templatePath, 'utf8');
    writeFileWithBackup(targetPath, content, options);

    if (!options.dryRun) {
      fs.chmodSync(targetPath, 0o755);
      log(`installed hook script: ${hookScriptName}`, options.quiet);
    }
  }
}

function installSupportScripts(targetDir: string, options: ClaudeCodeSetupOptions) {
  const scriptTemplateDir = path.join(TEMPLATE_ROOT, 'scripts');
  const scriptTargetDir = path.join(targetDir, 'scripts');

  for (const scriptName of SUPPORT_SCRIPTS) {
    const templatePath = path.join(scriptTemplateDir, scriptName);
    const targetPath = path.join(scriptTargetDir, scriptName);

    if (!fs.existsSync(templatePath)) {
      log(`Warning: Script template not found at ${templatePath}`, options.quiet);
      continue;
    }

    const content = fs.readFileSync(templatePath, 'utf8');
    writeFileWithBackup(targetPath, content, options);

    if (!options.dryRun && (scriptName.endsWith('.sh') || scriptName.endsWith('.py'))) {
      fs.chmodSync(targetPath, 0o755);
      log(`installed script: ${scriptName}`, options.quiet);
    }
  }
}

function shouldInstallLegacySmartNotify(targetDir: string): boolean {
  const smartNotifyPath = path.join(targetDir, 'scripts', 'smart-notify.sh');
  if (fs.existsSync(smartNotifyPath)) {
    return true;
  }

  const settingsPath = path.join(targetDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return raw.includes('smart-notify.sh');
  } catch {
    return false;
  }
}

function installLegacyOptionalSupportScripts(targetDir: string, options: ClaudeCodeSetupOptions) {
  if (!shouldInstallLegacySmartNotify(targetDir)) {
    return;
  }

  const scriptTemplateDir = path.join(TEMPLATE_ROOT, 'scripts');
  const scriptTargetDir = path.join(targetDir, 'scripts');

  for (const scriptName of LEGACY_OPTIONAL_SUPPORT_SCRIPTS) {
    const templatePath = path.join(scriptTemplateDir, scriptName);
    const targetPath = path.join(scriptTargetDir, scriptName);

    if (!fs.existsSync(templatePath)) {
      log(`Warning: Legacy script template not found at ${templatePath}`, options.quiet);
      continue;
    }

    const content = fs.readFileSync(templatePath, 'utf8');
    writeFileWithBackup(targetPath, content, options);

    if (!options.dryRun && (scriptName.endsWith('.sh') || scriptName.endsWith('.py'))) {
      fs.chmodSync(targetPath, 0o755);
      log(`installed legacy script: ${scriptName}`, options.quiet);
    }
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

  // Install hook scripts and support scripts
  installHookScripts(targetDir, options);
  installSupportScripts(targetDir, options);
  installLegacyOptionalSupportScripts(targetDir, options);

  // Merge MCP permissions and hooks into settings.json
  mergeSettingsFile(targetDir, options);

  log('', options.quiet);
  log('✓ Hook scripts installed for automatic memory capture', options.quiet);
  log('✓ Support scripts installed for queue processing', options.quiet);
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

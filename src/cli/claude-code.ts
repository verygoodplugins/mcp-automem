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
  'python-command.sh',
  'queue-cleanup.sh',
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

export type HookCommandComparisonOptions = {
  homeDir?: string;
  platform?: NodeJS.Platform;
};

const MANAGED_HOOK_SCRIPT_BASENAMES = new Set<string>([
  ...HOOK_SCRIPTS,
  'session-start.sh',
  'queue-cleanup.sh',
]);

export function normalizeHookCommand(
  command: unknown,
  options: HookCommandComparisonOptions = {}
): string {
  if (typeof command !== 'string') {
    return '';
  }
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;

  let normalized = command.trim().replace(/\s+/g, ' ');
  // Quotes only group arguments; strip them so `"$HOME/x"` and $HOME/x compare equal.
  normalized = normalized.replace(/["']/g, '');
  // Expand home-directory spellings only. Other env vars (e.g. ${CLAUDE_PLUGIN_ROOT})
  // stay literal: expanding them here risks false-positive dedup across installs.
  normalized = normalized
    .replace(/\$\{HOME\}/g, () => homeDir)
    .replace(/\$HOME(?![A-Za-z0-9_])/g, () => homeDir)
    .replace(/%USERPROFILE%/gi, () => homeDir)
    .replace(/(^|[\s=:])~(?=\/)/g, (_match, prefix: string) => `${prefix}${homeDir}`);

  if (platform === 'win32') {
    normalized = normalized.replace(/\\/g, '/').toLowerCase();
  }

  return normalized;
}

function managedHookScriptKey(normalizedCommand: string): string | undefined {
  if (!normalizedCommand) {
    return undefined;
  }
  const cliMatch = normalizedCommand.match(/@verygoodplugins\/mcp-automem\s+(\S+)/);
  if (cliMatch) {
    return `mcp-automem:${cliMatch[1]}`;
  }
  const scriptPaths = normalizedCommand.match(/[^\s()]+\.(?:sh|py)\b/g) ?? [];
  for (const scriptPath of scriptPaths) {
    const basename = scriptPath.split(/[\\/]/).pop() ?? '';
    if (MANAGED_HOOK_SCRIPT_BASENAMES.has(basename)) {
      return `script:${basename}`;
    }
  }
  return undefined;
}

function hookDedupKeys(hook: any, options: HookCommandComparisonOptions = {}): string[] {
  const normalized = normalizeHookCommand(hook?.command, options);
  if (!normalized) {
    return [];
  }
  const keys = [`command:${normalized}`];
  const managedKey = managedHookScriptKey(normalized);
  if (managedKey) {
    keys.push(`managed:${managedKey}`);
  }
  return keys;
}

export function mergeHookEntries(
  existingHooks: any[] = [],
  templateHooks: any[] = [],
  options: HookCommandComparisonOptions = {}
): any[] {
  const merged: any[] = [];
  const seenByMatcher = new Map<string, Set<string>>();
  const seenFor = (matcher: string): Set<string> => {
    let seen = seenByMatcher.get(matcher);
    if (!seen) {
      seen = new Set<string>();
      seenByMatcher.set(matcher, seen);
    }
    return seen;
  };

  for (const entry of existingHooks) {
    const seen = seenFor(entry?.matcher ?? '');
    const sourceHooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    const hooks: any[] = [];
    for (const hook of sourceHooks) {
      const keys = hookDedupKeys(hook, options);
      if (keys.length > 0 && keys.some((key) => seen.has(key))) {
        continue; // self-repair: same hook spelled differently (e.g. $HOME vs absolute path)
      }
      for (const key of keys) {
        seen.add(key);
      }
      hooks.push(hook);
    }
    if (sourceHooks.length > 0 && hooks.length === 0) {
      continue; // entry only held duplicates of hooks kept elsewhere
    }
    merged.push({ ...entry, hooks });
  }

  for (const templateEntry of templateHooks) {
    const matcher = templateEntry?.matcher ?? '';
    const seen = seenFor(matcher);
    const templateHookList = Array.isArray(templateEntry?.hooks) ? templateEntry.hooks : [];
    const newHooks = templateHookList.filter((hook: any) => {
      const keys = hookDedupKeys(hook, options);
      return keys.length === 0 || !keys.some((key) => seen.has(key));
    });
    if (templateHookList.length > 0 && newHooks.length === 0) {
      continue;
    }

    const index = merged.findIndex((entry) => (entry?.matcher ?? '') === matcher);
    if (index === -1) {
      merged.push({ ...templateEntry, hooks: [...newHooks] });
    } else {
      const target = merged[index];
      merged[index] = {
        ...target,
        hooks: [...(Array.isArray(target?.hooks) ? target.hooks : []), ...newHooks],
      };
    }
    for (const hook of newHooks) {
      for (const key of hookDedupKeys(hook, options)) {
        seen.add(key);
      }
    }
  }

  return merged;
}

export function migrateManagedHookEntries(
  existingHooks: any[] = [],
  templateHooks: any[] = [],
  options: HookCommandComparisonOptions = {}
): any[] {
  // Map each AutoMem-managed hook key to the matcher the template now wants it under,
  // so a matcher change (e.g. SessionStart gaining "startup|clear") moves the hook
  // instead of leaving a stale copy firing under the old matcher.
  const managedKeyMatchers = new Map<string, string>();
  for (const templateEntry of templateHooks) {
    const matcher = templateEntry?.matcher ?? '';
    for (const hook of Array.isArray(templateEntry?.hooks) ? templateEntry.hooks : []) {
      for (const key of hookDedupKeys(hook, options)) {
        managedKeyMatchers.set(key, matcher);
      }
    }
  }
  if (managedKeyMatchers.size === 0) {
    return existingHooks;
  }

  const migrated: any[] = [];
  for (const entry of existingHooks) {
    const matcher = entry?.matcher ?? '';
    const sourceHooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    const kept = sourceHooks.filter((hook: any) => {
      return !hookDedupKeys(hook, options).some((key) => {
        const templateMatcher = managedKeyMatchers.get(key);
        return templateMatcher !== undefined && templateMatcher !== matcher;
      });
    });
    if (sourceHooks.length > 0 && kept.length === 0) {
      continue; // entry only carried AutoMem-managed hooks; the template re-adds them
    }
    migrated.push(kept.length === sourceHooks.length ? entry : { ...entry, hooks: kept });
  }
  return migrated;
}

export function mergeSettings(targetSettings: any, templateSettings: any): any {
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
        const migratedHooks = migrateManagedHookEntries(existingHooks, hookConfigs as any[]);
        merged.hooks[hookName] = mergeHookEntries(migratedHooks, hookConfigs as any[]);
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
    throw new Error(
      `Cannot parse existing settings.json at ${targetPath}: ${(error as Error).message}`,
      { cause: error }
    );
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

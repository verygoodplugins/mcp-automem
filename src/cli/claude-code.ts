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
  'automem-stop-nudge.sh',
  'automem-track-store.sh',
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
  'stop-nudge.sh',
  'track-store.sh',
  'queue-cleanup.sh',
  // Retired scripts stay managed even after they leave HOOK_SCRIPTS, or the
  // strip below silently stops matching the legacy entries it exists to remove.
  'session-memory.sh',
  'capture-build-result.sh',
  'capture-test-pattern.sh',
  'capture-deployment.sh',
]);

// Hooks the template no longer ships and the installer actively removes from
// existing installs. Additions must cite the retiring PR (#130 for the
// session-summary Stop hook; mechanical build/test/deploy capture retired in
// favor of the LLM-judged automem-stop-nudge.sh). Never list anything without
// a managed key.
const RETIRED_HOOK_KEYS = new Set<string>([
  'script:session-memory.sh',
  'script:capture-build-result.sh',
  'script:capture-test-pattern.sh',
  'script:capture-deployment.sh',
]);

// Exact historical template spellings (normalized before comparison). A hook
// command is rewritten to the current template spelling ONLY when it matches
// one of these — a user-customized command (different flags, paths) never
// does, so customizations survive while known-legacy forms converge.
const LEGACY_HOOK_COMMAND_SPELLINGS: ReadonlyArray<string> = [
  // Pre-#108 unwrapped env-prefix forms (no bash -c wrapper).
  'CLAUDE_HOOK_TYPE=build bash "$HOME/.claude/hooks/capture-build-result.sh"',
  'CLAUDE_HOOK_TYPE=test_run bash "$HOME/.claude/hooks/capture-test-pattern.sh"',
  'CLAUDE_HOOK_TYPE=deploy bash "$HOME/.claude/hooks/capture-deployment.sh"',
  // Queue-drainer generations: no -y/--limit, then --limit without -y, then
  // the install.sh-era bare-CLI form (a silent no-op without a global binary).
  'npx @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl"',
  'npx @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5',
  'command -v mcp-automem >/dev/null 2>&1 && mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5 || true',
];

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
  // Bare globally-installed CLI (install.sh era): `mcp-automem queue …`.
  // Allowlisted to `queue` so both drainer spellings share one key; the
  // leading char class keeps `@verygoodplugins/mcp-automem` and path segments
  // like `/opt/mcp-automem` from matching.
  const bareCliMatch = normalizedCommand.match(/(?:^|[\s;&|(])mcp-automem\s+(queue)\b/);
  if (bareCliMatch) {
    return `mcp-automem:${bareCliMatch[1]}`;
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

export function hookDedupKeys(hook: any, options: HookCommandComparisonOptions = {}): string[] {
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

function hookIsRetired(hook: any, options: HookCommandComparisonOptions = {}): boolean {
  const managedKey = managedHookScriptKey(normalizeHookCommand(hook?.command, options));
  return managedKey !== undefined && RETIRED_HOOK_KEYS.has(managedKey);
}

export function stripRetiredHookEntries(
  existingHooks: any[] = [],
  options: HookCommandComparisonOptions = {}
): any[] {
  const stripped: any[] = [];
  for (const entry of existingHooks) {
    const sourceHooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    const kept = sourceHooks.filter((hook: any) => !hookIsRetired(hook, options));
    if (sourceHooks.length > 0 && kept.length === 0) {
      continue; // entry only carried retired hooks
    }
    stripped.push(kept.length === sourceHooks.length ? entry : { ...entry, hooks: kept });
  }
  return stripped;
}

export function canonicalizeLegacyHookCommands(
  existingHooks: any[] = [],
  templateHooks: any[] = [],
  options: HookCommandComparisonOptions = {}
): any[] {
  const templateCommandByManagedKey = new Map<string, string>();
  for (const entry of templateHooks) {
    for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : []) {
      if (typeof hook?.command !== 'string') {
        continue;
      }
      const managedKey = managedHookScriptKey(normalizeHookCommand(hook.command, options));
      if (managedKey) {
        templateCommandByManagedKey.set(managedKey, hook.command);
      }
    }
  }
  if (templateCommandByManagedKey.size === 0) {
    return existingHooks;
  }

  const legacyNormalized = new Set(
    LEGACY_HOOK_COMMAND_SPELLINGS.map((spelling) => normalizeHookCommand(spelling, options))
  );

  return existingHooks.map((entry) => {
    const sourceHooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    let changed = false;
    const hooks = sourceHooks.map((hook: any) => {
      const normalized = normalizeHookCommand(hook?.command, options);
      if (!legacyNormalized.has(normalized)) {
        return hook;
      }
      const managedKey = managedHookScriptKey(normalized);
      const templateCommand = managedKey
        ? templateCommandByManagedKey.get(managedKey)
        : undefined;
      if (!templateCommand || templateCommand === hook.command) {
        return hook;
      }
      changed = true;
      return { ...hook, command: templateCommand };
    });
    return changed ? { ...entry, hooks } : entry;
  });
}

export function removeManagedHookEntries(
  hooks: Record<string, any[]>,
  options: HookCommandComparisonOptions = {}
): { hooks: Record<string, any[]>; removedCount: number } {
  const cleaned: Record<string, any[]> = {};
  let removedCount = 0;
  for (const [event, entries] of Object.entries(hooks ?? {})) {
    const keptEntries: any[] = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const sourceHooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const kept = sourceHooks.filter((hook: any) => {
        const isManaged = hookDedupKeys(hook, options).some((key) => key.startsWith('managed:'));
        if (isManaged) {
          removedCount += 1;
        }
        return !isManaged;
      });
      if (sourceHooks.length > 0 && kept.length === 0) {
        continue;
      }
      keptEntries.push(kept.length === sourceHooks.length ? entry : { ...entry, hooks: kept });
    }
    if (keptEntries.length > 0) {
      cleaned[event] = keptEntries;
    }
  }
  return { hooks: cleaned, removedCount };
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
    // Retire hooks the template no longer ships — across every event, so a
    // retired hook stranded under an event the template stopped registering
    // still gets removed.
    for (const [hookName, entries] of Object.entries(merged.hooks)) {
      const stripped = stripRetiredHookEntries(entries as any[]);
      if (stripped.length === 0) {
        delete merged.hooks[hookName];
      } else {
        merged.hooks[hookName] = stripped;
      }
    }
    for (const [hookName, hookConfigs] of Object.entries(templateSettings.hooks)) {
      if (!merged.hooks[hookName]) {
        merged.hooks[hookName] = hookConfigs;
      } else {
        const existingHooks = merged.hooks[hookName] as any[];
        const canonicalHooks = canonicalizeLegacyHookCommands(existingHooks, hookConfigs as any[]);
        const migratedHooks = migrateManagedHookEntries(canonicalHooks, hookConfigs as any[]);
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
  if (raw.includes('session-memory.sh') && !output.includes('session-memory.sh')) {
    log(
      'migrated: removed retired session-memory.sh Stop hook (backup created)',
      options.quiet
    );
  }
  const retiredCaptureScripts = [
    'capture-build-result.sh',
    'capture-test-pattern.sh',
    'capture-deployment.sh',
  ];
  const removedCapture = retiredCaptureScripts.filter(
    (name) => raw.includes(name) && !output.includes(name)
  );
  if (removedCapture.length > 0) {
    log(
      `migrated: removed retired capture hooks (${removedCapture.join(', ')}) — storage is now LLM-judged via automem-stop-nudge.sh`,
      options.quiet
    );
  }
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

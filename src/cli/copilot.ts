import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  COPILOT_HOOK_EVENT_NAMES,
  resolveCopilotHome,
  resolveCopilotHookSurfaces,
  type CopilotInstallFormat,
  type CopilotHookSurface,
} from './hook-model.js';
import {
  describeMarkedBlockDefect,
  scanMarkedBlock,
  stripMarkedBlock,
  upsertMarkedBlock,
  type MarkedBlockMarkers,
} from './host-toolkit.js';

export const COPILOT_RULES_START = '<!-- BEGIN AUTOMEM MEMORY RULES -->';
export const COPILOT_RULES_END = '<!-- END AUTOMEM MEMORY RULES -->';
const COPILOT_RULES_MARKERS: MarkedBlockMarkers = {
  start: COPILOT_RULES_START,
  end: COPILOT_RULES_END,
};

// --- Type Definitions (T002, T003) ---

export interface CopilotSetupOptions {
  targetDir?: string;
  format?: CopilotInstallFormat;
  profile?: string;
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

export interface ProfileDefinition {
  name: string;
  description: string;
  hooks: string[];
}

export const VALID_PROFILES = ['lean', 'full'] as const;
export type ProfileName = (typeof VALID_PROFILES)[number];
export const DEFAULT_PROFILE: ProfileName = 'lean';

export const EVENT_NAMES = {
  cli: COPILOT_HOOK_EVENT_NAMES['copilot-cli'],
  vscode: COPILOT_HOOK_EVENT_NAMES['vscode-copilot'],
} as const;

// --- Constants ---

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/copilot', import.meta.url))
);

const SUPPORT_SCRIPTS = [
  'automem-session-start.sh',
  'automem-track-store.sh',
  'automem-stop-nudge.sh',
  // PowerShell equivalents
  'automem-session-start.ps1',
  'automem-track-store.ps1',
  'automem-stop-nudge.ps1',
];

// Retired Copilot machinery: the session-summary rollup (session-memory),
// the mechanical build/test/deploy capture hooks, and the queue pipeline
// (queue-cleanup + python-command + process-session-memory + memory-filters).
// These are NEVER installed. They are listed only so a re-run of the installer
// and the uninstaller can delete the orphaned files from existing installs.
const RETIRED_SUPPORT_SCRIPTS = [
  'capture-build-result.sh',
  'capture-build-result.ps1',
  'capture-test-pattern.sh',
  'capture-test-pattern.ps1',
  'capture-deployment.sh',
  'capture-deployment.ps1',
  'session-memory.sh',
  'session-memory.ps1',
  'queue-cleanup.sh',
  'queue-cleanup.ps1',
  'python-command.sh',
  'python-command.ps1',
  'process-session-memory.py',
  'memory-filters.json',
];

/**
 * Returns the base names of all AutoMem support scripts (current + retired),
 * with extensions stripped. The uninstaller uses this to remove both the
 * scripts shipped today and the orphaned files left by older installs.
 */
export function getCopilotSupportScriptBaseNames(): string[] {
  return [
    ...new Set(
      [...SUPPORT_SCRIPTS, ...RETIRED_SUPPORT_SCRIPTS].map((s) =>
        s.replace(/\.(sh|ps1|py|json)$/, '')
      )
    ),
  ];
}

// --- Profile Loading (T004) ---

export function loadProfile(name: string): ProfileDefinition {
  if (!VALID_PROFILES.includes(name as ProfileName)) {
    throw new Error(`Invalid profile '${name}'. Valid profiles: ${VALID_PROFILES.join(', ')}`);
  }

  const profilePath = path.join(TEMPLATE_ROOT, 'profiles', `${name}.json`);

  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile file not found at ${profilePath} - package may be corrupted`);
  }

  const raw = fs.readFileSync(profilePath, 'utf8');
  const profile: ProfileDefinition = JSON.parse(raw);

  if (!Array.isArray(profile.hooks) || profile.hooks.length === 0) {
    throw new Error(`Profile '${name}' has no hooks defined`);
  }

  return profile;
}

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

function removeFileWithBackup(targetPath: string, options: CopilotSetupOptions): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  if (options.dryRun) {
    log(`dry-run: would remove ${targetPath}`, options.quiet);
    return true;
  }

  const backup = backupPath(targetPath);
  fs.copyFileSync(targetPath, backup);
  fs.unlinkSync(targetPath);
  log(`removed: ${targetPath} (backup: ${backup})`, options.quiet);
  return true;
}

function removeCliMemoryRules(targetPath: string, options: CopilotSetupOptions): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const existing = fs.readFileSync(targetPath, 'utf8');
  const scan = scanMarkedBlock(existing, COPILOT_RULES_MARKERS);
  if (scan.absent) {
    return false;
  }
  if (!scan.paired) {
    // Stripping across a stray marker walks from a start to the *next* end and takes
    // the user's content in between with it. Leave the file alone and say why.
    console.warn(
      `Warning: left ${targetPath} untouched — ${describeMarkedBlockDefect(scan, COPILOT_RULES_MARKERS)}. ` +
        'Remove the stray marker by hand, then re-run.'
    );
    return false;
  }
  if (options.dryRun) {
    log(`dry-run: would remove AutoMem rules from ${targetPath}`, options.quiet);
    return true;
  }

  const updated = stripMarkedBlock(existing, COPILOT_RULES_MARKERS).trim();
  if (!updated) {
    return removeFileWithBackup(targetPath, options);
  }

  const backup = backupPath(targetPath);
  fs.copyFileSync(targetPath, backup);
  fs.writeFileSync(targetPath, `${updated}\n`, 'utf8');
  log(`removed AutoMem rules from: ${targetPath} (backup: ${backup})`, options.quiet);
  return true;
}

function hookEventName(key: string, format: 'cli' | 'vscode'): string {
  return key in EVENT_NAMES.cli ? EVENT_NAMES[format][key as keyof typeof EVENT_NAMES.cli] : key;
}

function hookEventFormat(surface: CopilotHookSurface): 'cli' | 'vscode' {
  return surface === 'vscode-copilot' ? 'vscode' : 'cli';
}

function cloneHookEntriesForSurface(
  entries: CopilotHookEntry[],
  surface: CopilotHookSurface
): CopilotHookEntry[] {
  return entries.map((entry) => ({
    ...entry,
    env: {
      ...(entry.env ?? {}),
      AUTOMEM_HOOK_SURFACE: surface,
    },
  }));
}

/**
 * Remap event name keys in a hook JSON object based on the selected format.
 * Templates use CLI camelCase keys; --format vscode remaps to PascalCase, while
 * --format both writes both event spellings with surface-specific output env.
 */
function remapHookEventNames(
  hookData: CopilotHookFile,
  format: CopilotInstallFormat
): CopilotHookFile {
  const remapped: Record<string, CopilotHookEntry[]> = {};

  for (const [key, entries] of Object.entries(hookData.hooks)) {
    for (const surface of resolveCopilotHookSurfaces(format)) {
      const eventKey = hookEventName(key, hookEventFormat(surface));
      remapped[eventKey] = [
        ...(remapped[eventKey] ?? []),
        ...cloneHookEntriesForSurface(entries, surface),
      ];
    }
  }

  return { ...hookData, hooks: remapped };
}

// --- Core Installer Logic (T017-T022) ---

function removeStaleHooks(
  targetDir: string,
  profileHooks: string[],
  options: CopilotSetupOptions
): string[] {
  const hookTargetDir = path.join(targetDir, 'hooks');
  const removed: string[] = [];

  if (!fs.existsSync(hookTargetDir)) {
    return removed;
  }

  // Find all automem-*.json files currently installed
  const existing = fs
    .readdirSync(hookTargetDir)
    .filter((f) => f.startsWith('automem-') && f.endsWith('.json'));

  for (const hookFile of existing) {
    if (!profileHooks.includes(hookFile)) {
      const filePath = path.join(hookTargetDir, hookFile);
      if (options.dryRun) {
        log(`dry-run: would remove stale hook ${hookFile}`, options.quiet);
      } else {
        try {
          const backup = backupPath(filePath);
          fs.copyFileSync(filePath, backup);
          fs.unlinkSync(filePath);
          log(`removed stale hook: ${hookFile} (backup: ${backup})`, options.quiet);
        } catch (err) {
          log(`warning: failed to remove ${hookFile}: ${(err as Error).message}`, options.quiet);
        }
      }
      removed.push(hookFile);
    }
  }

  return removed;
}

function removeRetiredScripts(targetDir: string, options: CopilotSetupOptions): string[] {
  const scriptTargetDir = path.join(targetDir, 'scripts');
  const removed: string[] = [];

  if (!fs.existsSync(scriptTargetDir)) {
    return removed;
  }

  for (const scriptName of RETIRED_SUPPORT_SCRIPTS) {
    const filePath = path.join(scriptTargetDir, scriptName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    if (options.dryRun) {
      log(`dry-run: would remove retired script ${scriptName}`, options.quiet);
    } else {
      try {
        const backup = backupPath(filePath);
        fs.copyFileSync(filePath, backup);
        fs.unlinkSync(filePath);
        log(`removed retired script: ${scriptName} (backup: ${backup})`, options.quiet);
      } catch (err) {
        log(`warning: failed to remove ${scriptName}: ${(err as Error).message}`, options.quiet);
        continue;
      }
    }
    removed.push(scriptName);
  }

  return removed;
}

function installHookFiles(targetDir: string, profileHooks: string[], options: CopilotSetupOptions) {
  const hookTemplateDir = path.join(TEMPLATE_ROOT, 'hooks');
  const hookTargetDir = path.join(targetDir, 'hooks');
  const format = options.format ?? 'both';

  for (const hookFileName of profileHooks) {
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

    // Remap event names and output envelopes based on --format.
    hookData = remapHookEventNames(hookData, format);

    // Templates are authored against the fallback path; rewrite whenever the
    // actual install target differs, including when COPILOT_HOME is set.
    const templateDefaultDir = resolveCopilotHome({});
    if (targetDir !== templateDefaultDir) {
      const normalizedTarget = targetDir.replace(/\\/g, '/');
      for (const entries of Object.values(hookData.hooks)) {
        for (const entry of entries) {
          if (entry.bash) {
            entry.bash = entry.bash.replace(/\$HOME\/\.copilot/g, normalizedTarget);
          }
          if (entry.powershell) {
            const psTarget = targetDir.replace(/\//g, '\\');
            entry.powershell = entry.powershell.replace(/\$HOME\\\.copilot/g, psTarget);
          }
        }
      }
    }

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
      try {
        fs.chmodSync(targetPath, 0o755);
      } catch {
        // chmod may fail on Windows - that's OK for .sh/.py files
      }
    }

    if (!options.dryRun) {
      log(`installed script: ${scriptName}`, options.quiet);
    }
  }
}

function installMemoryRules(targetDir: string, options: CopilotSetupOptions) {
  const format = options.format ?? 'both';
  const installVscode = format === 'vscode' || format === 'both';
  const installCli = format === 'cli' || format === 'both';
  const vscodeTargetPath = path.join(targetDir, 'instructions', 'automem.instructions.md');
  const cliTargetPath = path.join(targetDir, 'copilot-instructions.md');

  if (!installVscode) {
    removeFileWithBackup(vscodeTargetPath, options);
  }
  if (!installCli) {
    removeCliMemoryRules(cliTargetPath, options);
  }

  // VS Code: <targetDir>/instructions/automem.instructions.md (with frontmatter)
  if (installVscode) {
    const vscodeTemplatePath = path.join(TEMPLATE_ROOT, 'automem.instructions.md');

    if (fs.existsSync(vscodeTemplatePath)) {
      const content = fs.readFileSync(vscodeTemplatePath, 'utf8');
      writeFileWithBackup(vscodeTargetPath, content, options);
      if (!options.dryRun) {
        log(`installed: ${vscodeTargetPath} (VS Code)`, options.quiet);
      }
    }
  }

  // CLI: <targetDir>/copilot-instructions.md (append AutoMem block using markers)
  if (installCli) {
    const cliTemplatePath = path.resolve(
      fileURLToPath(
        new URL('../../templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md', import.meta.url)
      )
    );
    if (fs.existsSync(cliTemplatePath)) {
      const templateContent = fs.readFileSync(cliTemplatePath, 'utf8');
      // Extract just the memory rules block (between the markdown fence markers)
      const blockStart = templateContent.indexOf('<memory_rules>');
      const blockEnd = templateContent.indexOf('</memory_rules>');
      if (blockStart === -1 || blockEnd === -1) {
        console.error(
          'Error: Could not find <memory_rules> markers in template - package may be corrupted'
        );
        return;
      }
      const rulesBlock = templateContent.slice(blockStart, blockEnd + '</memory_rules>'.length);

      const markedBlock = `${COPILOT_RULES_START}\n${rulesBlock}\n${COPILOT_RULES_END}`;

      const existing = fs.existsSync(cliTargetPath) ? fs.readFileSync(cliTargetPath, 'utf8') : '';
      // Validated before the dry-run bail so a preview surfaces a rules file this
      // command would refuse to rewrite, instead of promising an update that throws.
      const updated = upsertMarkedBlock(
        existing.length > 0 ? existing : null,
        markedBlock,
        COPILOT_RULES_MARKERS,
        cliTargetPath
      );

      if (options.dryRun) {
        log(`dry-run: would update ${cliTargetPath} (memory rules block)`, options.quiet);
        return;
      }

      if (updated !== existing) {
        writeFileWithBackup(cliTargetPath, updated, options);
      }
      log(`installed: ${cliTargetPath} (CLI memory rules)`, options.quiet);
    }
  }
}

// --- Public API ---

export async function applyCopilotSetup(cliOptions: CopilotSetupOptions): Promise<void> {
  const options: CopilotSetupOptions = {
    ...cliOptions,
    targetDir: path.resolve(cliOptions.targetDir ?? resolveCopilotHome()),
    format: cliOptions.format ?? 'both',
    profile: cliOptions.profile ?? DEFAULT_PROFILE,
  };

  const targetDir = options.targetDir!;
  const profileName = options.profile!;

  // Load and validate profile
  let profile: ProfileDefinition;
  try {
    profile = loadProfile(profileName);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // T019: Dry-run header
  if (options.dryRun) {
    log(`Configuring Copilot in ${targetDir} (dry run)`, options.quiet);
  } else {
    log(`Configuring Copilot in ${targetDir}`, options.quiet);
  }

  log(`Profile: ${profileName} (${profile.hooks.length} hooks)`, options.quiet);

  // T032: Create target directories (including when --dir points to non-existent path)
  if (!options.dryRun) {
    fs.mkdirSync(path.join(targetDir, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'instructions'), { recursive: true });
  }

  log('', options.quiet);

  // T012: Remove-first profile switching - remove hooks not in target profile
  const removed = removeStaleHooks(targetDir, profile.hooks, options);
  if (removed.length > 0) {
    log(`Removed ${removed.length} hook(s) not in '${profileName}' profile`, options.quiet);
    log('', options.quiet);
  }

  // Delete orphaned files from the retired session-summary + capture + queue
  // machinery left behind by older installs (parity with the Claude Code side).
  const retiredRemoved = removeRetiredScripts(targetDir, options);
  if (retiredRemoved.length > 0) {
    log(`Removed ${retiredRemoved.length} retired AutoMem script(s)`, options.quiet);
    log('', options.quiet);
  }

  // Install hook JSON files for the selected profile and support scripts
  installHookFiles(targetDir, profile.hooks, options);
  installSupportScripts(targetDir, options);

  // Install memory rules based on --format
  installMemoryRules(targetDir, options);

  // T021/T030: Post-installation summary (skip for dry-run - files listed inline already)
  const format = options.format ?? 'both';
  const rulesLabel = format === 'both' ? 'CLI and VS Code' : format === 'cli' ? 'CLI' : 'VS Code';
  if (!options.dryRun) {
    log('', options.quiet);
    log(
      `\u2713 Hook JSON files installed for '${profileName}' profile (${profile.hooks.length} hooks)`,
      options.quiet
    );
    log('\u2713 Support scripts installed for queue processing', options.quiet);
    log(`\u2713 Memory rules installed for ${rulesLabel}`, options.quiet);
    log('', options.quiet);
    log('Next steps:', options.quiet);
    log('1. Add the AutoMem MCP server to your Copilot config:', options.quiet);
    log(`   CLI:     ${path.join(targetDir, 'mcp-config.json')}`, options.quiet);
    log('   VS Code: .vscode/mcp.json (workspace) or VS Code settings (user)', options.quiet);
    log('   See INSTALLATION.md for the server entry JSON', options.quiet);
    log('2. Restart Copilot', options.quiet);
    log('', options.quiet);
    log('Note: Copilot will prompt to approve AutoMem MCP tools on first use', options.quiet);
    log(
      `per project. Approvals are saved to ${path.join(targetDir, 'permissions-config.json')}.`,
      options.quiet
    );
    log('', options.quiet);
    log('Note: Hook scripts run with -NoProfile on Windows to prevent PowerShell', options.quiet);
    log('profile output from corrupting hook JSON payloads. If a hook script needs', options.quiet);
    log(
      'custom PATH entries or modules from your profile, move that setup into the',
      options.quiet
    );
    log('script itself or into environment variables.', options.quiet);
  }
}

/**
 * Usage block for `mcp-automem copilot`. Single source of truth: printed by
 * `copilot --help` and interpolated into the top-level `help` output in
 * src/index.ts, so the two can't drift.
 */
export const COPILOT_USAGE = `COPILOT SETUP:
  npx @verygoodplugins/mcp-automem copilot [options]

  Options:
    --format <cli|vscode|both>  Memory rules and hook event name casing. cli = camelCase
                           hooks + CLI rules only. vscode = PascalCase hooks + VS Code
                           rules only. both = camelCase hooks + both rule sets (default).
    --profile <full|lean>  Hook profile. lean = session only (default); full = all hooks.
    --dir <path>           Target directory (default: $COPILOT_HOME or ~/.copilot)
    --dry-run             Show what would be changed
    --yes, -y             Skip confirmation prompts
    --quiet               Suppress non-error output
    --help, -h            Print this usage block and exit without installing`;

// T016: CLI argument parser
function parseCopilotArgs(args: string[]): CopilotSetupOptions {
  const options: CopilotSetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          console.error('Error: --dir requires a path value');
          process.exit(1);
        }
        options.targetDir = args[i + 1];
        i += 1;
        break;
      case '--format':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          console.error('Error: --format requires a value (cli|vscode|both)');
          process.exit(1);
        }
        options.format = args[i + 1] as CopilotInstallFormat;
        i += 1;
        break;
      case '--profile':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          console.error('Error: --profile requires a value (lean|full)');
          process.exit(1);
        }
        options.profile = args[i + 1];
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
  // Short-circuit before parsing: --help must never touch the filesystem, and
  // the value-flag guards in parseCopilotArgs exit(1) on a trailing --dir or
  // --format, which would swallow the help request. Return rather than exit so
  // the caller in src/index.ts still owns the exit code (0).
  if (args.includes('--help') || args.includes('-h')) {
    console.log(COPILOT_USAGE);
    return;
  }

  const options = parseCopilotArgs(args);

  // T027: Validate --format
  if (
    options.format !== undefined &&
    options.format !== 'cli' &&
    options.format !== 'vscode' &&
    options.format !== 'both'
  ) {
    console.error(`Error: Invalid format '${options.format}'. Valid options: cli, vscode, both`);
    process.exit(1);
  }

  // Validate --profile
  if (options.profile !== undefined && !VALID_PROFILES.includes(options.profile as ProfileName)) {
    console.error(
      `Error: Invalid profile '${options.profile}'. Valid profiles: ${VALID_PROFILES.join(', ')}`
    );
    process.exit(1);
  }

  // T016: Non-interactive terminal detection - auto-set yes=true
  if (!process.stdin.isTTY) {
    options.yes = true;
  }

  await applyCopilotSetup(options);
}

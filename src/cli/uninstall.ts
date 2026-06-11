import fs from 'fs';
import os from 'os';
import path from 'path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { automemOwnedFiles, removeManagedHookEntries } from './claude-code.js';
import {
  removeHermesMemoryProvider,
  removeMcpServerEntry,
  resolveHermesPaths,
} from './hermes-config.js';

interface UninstallOptions {
  platform: 'cursor' | 'claude-code' | 'hermes';
  projectDir?: string;
  rulesPath?: string;
  cleanAll?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

function log(message: string, quiet?: boolean) {
  if (!quiet) {
    console.log(message);
  }
}

async function confirm(message: string, defaultYes = false): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) {
    return defaultYes;
  }
  
  const rl = createInterface({ input, output });
  try {
    const prompt = defaultYes ? `${message} [Y/n]: ` : `${message} [y/N]: `;
    const answer = await rl.question(prompt);
    const normalized = answer.trim().toLowerCase();
    
    if (!normalized) {
      return defaultYes;
    }
    
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

function removeFileWithBackup(filePath: string, dryRun: boolean, quiet?: boolean): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  if (dryRun) {
    log(`[DRY RUN] Would remove: ${filePath}`, quiet);
    return true;
  }
  
  // Create backup before deletion
  const backupPath = `${filePath}.removed.${Date.now()}`;
  try {
    fs.copyFileSync(filePath, backupPath);
    fs.unlinkSync(filePath);
    log(`🗑️  Removed: ${filePath}`, quiet);
    log(`   Backup: ${backupPath}`, quiet);
    return true;
  } catch (error) {
    log(`❌ Failed to remove ${filePath}: ${(error as Error).message}`, quiet);
    return false;
  }
}

function removeDirectory(dirPath: string, dryRun: boolean, quiet?: boolean): boolean {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  
  if (dryRun) {
    log(`[DRY RUN] Would remove directory: ${dirPath}`, quiet);
    return true;
  }
  
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    log(`🗑️  Removed directory: ${dirPath}`, quiet);
    return true;
  } catch (error) {
    log(`❌ Failed to remove ${dirPath}: ${(error as Error).message}`, quiet);
    return false;
  }
}

function removeEnvKeysWithBackup(
  envPath: string,
  keys: string[],
  dryRun: boolean,
  quiet?: boolean,
): boolean {
  if (!fs.existsSync(envPath)) return false;
  const keySet = new Set(keys);
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    return !match || !keySet.has(match[1]);
  });
  if (filtered.join('\n') === lines.join('\n')) return false;

  if (dryRun) {
    log(`[DRY RUN] Would remove AutoMem environment keys from: ${envPath}`, quiet);
    return true;
  }

  const backupPath = `${envPath}.backup.${Date.now()}`;
  fs.copyFileSync(envPath, backupPath);
  const content = filtered.join('\n').replace(/\s+$/, '');
  fs.writeFileSync(envPath, content.length ? `${content}\n` : '', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // Best effort on platforms that do not support POSIX chmod.
  }
  log(`🗑️  Removed AutoMem environment keys from ${envPath}`, quiet);
  log(`   Backup: ${backupPath}`, quiet);
  return true;
}

function getClaudeDesktopConfigPath(): string {
  const homeDir = os.homedir();
  const platform = os.platform();
  
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  } else {
    // Linux/other
    return path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
  }
}

function getCursorConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.cursor', 'mcp.json');
}

function removeClaudeDesktopMemoryServer(dryRun: boolean, quiet?: boolean): boolean {
  const configPath = getClaudeDesktopConfigPath();
  
  if (!fs.existsSync(configPath)) {
    log('ℹ️  Claude Desktop config not found', quiet);
    return false;
  }
  
  if (dryRun) {
    log(`[DRY RUN] Would remove memory server from: ${configPath}`, quiet);
    return true;
  }
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    const hadMemory = config?.mcpServers?.memory;
    const hadAutomem = config?.mcpServers?.automem;
    
    if (!hadMemory && !hadAutomem) {
      log('ℹ️  No memory server configured in Claude Desktop', quiet);
      return false;
    }
    
    // Remove memory servers
    if (config?.mcpServers) {
      // Default server id is now "memory" but remove legacy "automem" if present
      delete config.mcpServers.memory;
      delete config.mcpServers.automem;
    }
    
    // Backup original
    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
    
    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    
    log(`🗑️  Removed memory server from Claude Desktop config`, quiet);
    log(`   Backup: ${backupPath}`, quiet);
    return true;
  } catch (error) {
    log(`❌ Failed to update Claude Desktop config: ${(error as Error).message}`, quiet);
    return false;
  }
}

function removeCursorMcpServer(dryRun: boolean, quiet?: boolean): boolean {
  const configPath = getCursorConfigPath();

  if (!fs.existsSync(configPath)) {
    log('ℹ️  Cursor MCP config not found', quiet);
    return false;
  }

  if (dryRun) {
    log(`[DRY RUN] Would remove memory server from: ${configPath}`, quiet);
    return true;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);

    const hadMemory = config?.mcpServers?.memory;
    const hadAutomem = config?.mcpServers?.automem;

    if (!hadMemory && !hadAutomem) {
      log('ℹ️  No memory server configured in Cursor MCP config', quiet);
      return false;
    }

    if (config?.mcpServers) {
      delete config.mcpServers.memory;   // default
      delete config.mcpServers.automem;  // legacy
    }

    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    log('🗑️  Removed memory server from Cursor MCP config', quiet);
    log(`   Backup: ${backupPath}`, quiet);
    return true;
  } catch (error) {
    log(`❌ Failed to update Cursor MCP config: ${(error as Error).message}`, quiet);
    return false;
  }
}

async function uninstallCursor(options: UninstallOptions): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  const cursorRulesDir = path.join(projectDir, '.cursor', 'rules');
  const automemRuleFile = path.join(cursorRulesDir, 'automem.mdc');
  
  log('\n🗑️  Uninstalling Cursor AutoMem...', options.quiet);
  
  let removedCount = 0;
  
  // Remove automem.mdc rule file
  if (removeFileWithBackup(automemRuleFile, options.dryRun ?? false, options.quiet)) {
    removedCount++;
  }
  
  // Remove empty .cursor/rules directory
  if (fs.existsSync(cursorRulesDir)) {
    const remaining = fs.readdirSync(cursorRulesDir);
    if (remaining.length === 0) {
      removeDirectory(cursorRulesDir, options.dryRun ?? false, options.quiet);
    }
  }
  
  if (removedCount > 0) {
    log(`\n✅ Removed Cursor AutoMem rule file`, options.quiet);
  } else {
    log('\nℹ️  No Cursor AutoMem rule file found to remove', options.quiet);
  }
}

async function uninstallHermes(options: UninstallOptions): Promise<void> {
  const paths = resolveHermesPaths({ dir: options.projectDir });
  // Mirror `hermes` setup's --rules: strip the AutoMem block from the same
  // rules file it was installed into (defaults to <hermes-home>/AGENTS.md).
  const rulesFile = options.rulesPath ?? paths.agentsPath;

  log('\n🗑️  Uninstalling Hermes AutoMem...', options.quiet);

  let didChange = false;
  if (fs.existsSync(paths.configPath)) {
    didChange = removeMcpServerEntry(paths.configPath, 'automem', {
      dryRun: options.dryRun,
      quiet: options.quiet,
    }) || didChange;
    didChange = removeMcpServerEntry(paths.configPath, 'memory', {
      dryRun: options.dryRun,
      quiet: options.quiet,
      onlyIfAutoMem: true,
    }) || didChange;
    didChange = removeHermesMemoryProvider(paths.configPath, 'automem', {
      dryRun: options.dryRun,
      quiet: options.quiet,
    }) || didChange;
  } else {
    log(`ℹ️  No Hermes config at ${paths.configPath}`, options.quiet);
  }

  if (fs.existsSync(rulesFile)) {
    const start = '<!-- BEGIN AUTOMEM HERMES RULES -->';
    const end = '<!-- END AUTOMEM HERMES RULES -->';
    const raw = fs.readFileSync(rulesFile, 'utf8');
    const startIdx = raw.indexOf(start);
    const endIdx = raw.indexOf(end);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      log(`ℹ️  No AutoMem rule block in ${rulesFile}`, options.quiet);
    } else if (options.dryRun) {
      log(`[DRY RUN] Would strip AutoMem block from: ${rulesFile}`, options.quiet);
    } else {
      const before = raw.slice(0, startIdx).replace(/\s+$/, '');
      const after = raw.slice(endIdx + end.length).replace(/^\s+/, '');
      const next = before && after ? `${before}\n\n${after}\n` : `${before}${after}`.replace(/\n+$/, '') + '\n';
      const backupPath = `${rulesFile}.backup.${Date.now()}`;
      fs.copyFileSync(rulesFile, backupPath);
      fs.writeFileSync(rulesFile, next, 'utf8');
      log(`🗑️  Stripped AutoMem block from ${rulesFile}`, options.quiet);
      log(`   Backup: ${backupPath}`, options.quiet);
      didChange = true;
    }
  }

  const providerDir = path.join(paths.home, 'plugins', 'automem');
  if (fs.existsSync(providerDir)) {
    didChange = removeDirectory(providerDir, options.dryRun ?? false, options.quiet) || didChange;
  }

  didChange = removeEnvKeysWithBackup(
    path.join(paths.home, '.env'),
    [
      'AUTOMEM_API_URL',
      'AUTOMEM_ENDPOINT',
      'AUTOMEM_API_KEY',
      'AUTOMEM_API_TOKEN',
      'AUTOMEM_HERMES_PROVIDER_TOOLS',
    ],
    options.dryRun ?? false,
    options.quiet,
  ) || didChange;

  if (didChange) {
    log('\n✅ Hermes AutoMem configuration removed', options.quiet);
  } else if (!options.dryRun) {
    log('\nℹ️  Nothing to remove for Hermes AutoMem', options.quiet);
  }
}

async function uninstallClaudeCode(options: UninstallOptions): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  
  log('\n🗑️  Uninstalling Claude Code AutoMem...', options.quiet);

  let settingsCleared = true;
  if (!fs.existsSync(settingsPath)) {
    log('ℹ️  No Claude Code settings.json found', options.quiet);
  } else if (options.dryRun) {
    log(
      `[DRY RUN] Would remove MCP permissions and AutoMem hook entries from: ${settingsPath}`,
      options.quiet
    );
  } else {
    settingsCleared = uninstallClaudeCodeSettings(settingsPath, options);
  }

  // Delete installer-owned files only once settings.json no longer references
  // them. If the settings update failed, removing the scripts would strand the
  // unchanged config pointing at missing files — broken hooks. Skip and warn.
  if (!settingsCleared) {
    log(
      '⚠️  Skipped removing AutoMem hook/script files because settings.json still references them (update failed above). Fix settings.json and re-run, or remove the files manually.',
      options.quiet
    );
    return;
  }

  // Remove installer-owned files (current hooks + retired machinery). The
  // list comes from the installer itself so install-time cleanup and
  // uninstall cannot drift; foreign files in the shared dirs are untouched.
  let filesRemoved = 0;
  for (const relativePath of automemOwnedFiles()) {
    const filePath = path.join(claudeDir, relativePath);
    if (removeFileWithBackup(filePath, options.dryRun ?? false, options.quiet)) {
      filesRemoved += 1;
    }
  }
  if (filesRemoved > 0 && !options.dryRun) {
    log(`\n✅ Removed ${filesRemoved} AutoMem hook/script file(s)`, options.quiet);
  }
}

// Returns true when settings.json no longer references AutoMem hooks (updated
// cleanly, or had nothing to remove), and false when the update failed — in
// which case the caller must NOT delete the on-disk scripts the config still
// points at.
function uninstallClaudeCodeSettings(settingsPath: string, options: UninstallOptions): boolean {
  const mcpPermissions = [
    'mcp__memory__store_memory',
    'mcp__memory__recall_memory',
    'mcp__memory__associate_memories',
    'mcp__memory__update_memory',
    'mcp__memory__delete_memory',
    'mcp__memory__check_database_health',
  ];

  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw);

    // Remove MCP permissions
    let permissionsRemoved = 0;
    if (settings.permissions?.allow) {
      const originalLength = settings.permissions.allow.length;
      settings.permissions.allow = settings.permissions.allow.filter(
        (perm: string) => !mcpPermissions.includes(perm)
      );
      permissionsRemoved = originalLength - settings.permissions.allow.length;
    }

    // Remove AutoMem-managed hook entries (current and retired spellings),
    // preserving hooks the installer didn't author.
    let hooksRemoved = 0;
    if (settings.hooks) {
      const result = removeManagedHookEntries(settings.hooks);
      hooksRemoved = result.removedCount;
      if (hooksRemoved > 0) {
        if (Object.keys(result.hooks).length > 0) {
          settings.hooks = result.hooks;
        } else {
          delete settings.hooks;
        }
      }
    }

    if (permissionsRemoved === 0 && hooksRemoved === 0) {
      log('ℹ️  No AutoMem configuration found in settings.json', options.quiet);
      return true;
    }

    // Backup and write
    const backupPath = `${settingsPath}.backup.${Date.now()}`;
    fs.copyFileSync(settingsPath, backupPath);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    if (permissionsRemoved > 0) {
      log(`🗑️  Removed ${permissionsRemoved} MCP permissions from settings.json`, options.quiet);
    }
    if (hooksRemoved > 0) {
      log(`🗑️  Removed ${hooksRemoved} AutoMem hook entries from settings.json`, options.quiet);
    }
    log(`   Backup: ${backupPath}`, options.quiet);
    log('\n✅ Claude Code AutoMem configuration removed', options.quiet);
    return true;
  } catch (error) {
    log(`❌ Failed to update settings.json: ${(error as Error).message}`, options.quiet);
    return false;
  }
}

export async function runUninstall(options: UninstallOptions): Promise<void> {
  log(`\n🚮 AutoMem Uninstaller`, options.quiet);
  log(`   Platform: ${options.platform}`, options.quiet);
  
  if (!options.yes && !options.dryRun) {
    const confirmed = await confirm('\n⚠️  This will remove AutoMem configuration. Continue?', false);
    if (!confirmed) {
      log('\nUninstall cancelled.', options.quiet);
      return;
    }
  }
  
  // Platform-specific uninstall
  if (options.platform === 'cursor') {
    await uninstallCursor(options);
  } else if (options.platform === 'claude-code') {
    await uninstallClaudeCode(options);
  } else if (options.platform === 'hermes') {
    await uninstallHermes(options);
  }
  
  // Clean up external changes (Claude Desktop config) if requested
  if (options.cleanAll) {
    log('\n🧹 Cleaning external configurations...', options.quiet);
    // Remove from Claude Desktop config (if present)
    removeClaudeDesktopMemoryServer(options.dryRun ?? false, options.quiet);
    // Remove from Cursor MCP config (if present)
    removeCursorMcpServer(options.dryRun ?? false, options.quiet);
  }
  
  log('\n✨ Uninstall complete!', options.quiet);
  
  if (options.platform === 'cursor' && !options.cleanAll && !options.dryRun) {
    log('\n💡 Note: This removed the project rule file.', options.quiet);
    log('   To also remove the MCP server config from Cursor, re-run with --clean-all', options.quiet);
  } else if (options.platform === 'claude-code' && !options.cleanAll && !options.dryRun) {
    log('\nNote: To also remove the memory server from Claude Desktop config, run:', options.quiet);
    log(`  npx @verygoodplugins/mcp-automem uninstall ${options.platform} --clean-all`, options.quiet);
  }
}

export function parseUninstallArgs(args: string[]): UninstallOptions | null {
  const allowed = ['cursor', 'claude-code', 'hermes'] as const;
  if (args.length === 0 || !allowed.includes(args[0] as typeof allowed[number])) {
    console.error('❌ Error: Platform required (cursor, claude-code, or hermes)');
    console.error('Usage: mcp-automem uninstall <cursor|claude-code|hermes> [options]');
    return null;
  }

  const options: UninstallOptions = {
    platform: args[0] as UninstallOptions['platform'],
  };
  
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
        if (i + 1 >= args.length) {
          console.error('Error: --dir requires a path value');
          process.exit(1);
        }
        options.projectDir = args[i + 1];
        i += 1;
        break;
      case '--rules':
        if (i + 1 >= args.length) {
          console.error('Error: --rules requires a path value');
          return null;
        }
        options.rulesPath = args[i + 1];
        i += 1;
        break;
      case '--clean-all':
        options.cleanAll = true;
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

export async function runUninstallCommand(args: string[] = []): Promise<void> {
  const options = parseUninstallArgs(args);
  if (!options) {
    process.exit(1);
  }
  await runUninstall(options);
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

interface UninstallOptions {
  platform: 'cursor' | 'claude-code' | 'copilot';
  projectDir?: string;
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

async function uninstallClaudeCode(options: UninstallOptions): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  
  log('\n🗑️  Uninstalling Claude Code AutoMem...', options.quiet);
  
  // MCP permissions to remove
  const mcpPermissions = [
    'mcp__memory__store_memory',
    'mcp__memory__recall_memory',
    'mcp__memory__associate_memories',
    'mcp__memory__update_memory',
    'mcp__memory__delete_memory',
    'mcp__memory__check_database_health',
  ];
  
  if (!fs.existsSync(settingsPath)) {
    log('ℹ️  No Claude Code settings.json found', options.quiet);
    return;
  }
  
  if (options.dryRun) {
    log(`[DRY RUN] Would remove MCP permissions from: ${settingsPath}`, options.quiet);
    return;
  }
  
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    
    if (!settings.permissions?.allow) {
      log('ℹ️  No permissions found in settings.json', options.quiet);
      return;
    }
    
    // Remove MCP permissions
    const originalLength = settings.permissions.allow.length;
    settings.permissions.allow = settings.permissions.allow.filter(
      (perm: string) => !mcpPermissions.includes(perm)
    );
    
    const removedCount = originalLength - settings.permissions.allow.length;
    
    if (removedCount === 0) {
      log('ℹ️  No AutoMem permissions found in settings.json', options.quiet);
      return;
    }
    
    // Backup and write
    const backupPath = `${settingsPath}.backup.${Date.now()}`;
    fs.copyFileSync(settingsPath, backupPath);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    
    log(`🗑️  Removed ${removedCount} MCP permissions from settings.json`, options.quiet);
    log(`   Backup: ${backupPath}`, options.quiet);
    log('\n✅ Claude Code AutoMem permissions removed', options.quiet);
  } catch (error) {
    log(`❌ Failed to update settings.json: ${(error as Error).message}`, options.quiet);
  }
}

async function uninstallCopilot(options: UninstallOptions): Promise<void> {
  const copilotDir = options.projectDir ?? path.join(os.homedir(), '.copilot');
  const hooksDir = path.join(copilotDir, 'hooks');
  const scriptsDir = path.join(copilotDir, 'scripts');

  log('\n🗑️  Uninstalling Copilot AutoMem...', options.quiet);

  let removedCount = 0;

  // Remove automem-*.json hook files
  if (fs.existsSync(hooksDir)) {
    const hookFiles = fs.readdirSync(hooksDir)
      .filter(f => f.startsWith('automem-') && f.endsWith('.json'));

    for (const hookFile of hookFiles) {
      if (removeFileWithBackup(path.join(hooksDir, hookFile), options.dryRun ?? false, options.quiet)) {
        removedCount++;
      }
    }
  }

  // Remove AutoMem support scripts (.sh and .ps1)
  if (fs.existsSync(scriptsDir)) {
    const automemScriptPatterns = [
      'capture-build-result', 'capture-test-pattern', 'capture-deployment',
      'session-memory', 'python-command', 'queue-cleanup',
      'automem-session-start', 'process-session-memory',
    ];

    const scriptFiles = fs.readdirSync(scriptsDir)
      .filter(f => {
        const base = f.replace(/\.(sh|ps1|py)$/, '');
        return automemScriptPatterns.includes(base);
      });

    for (const script of scriptFiles) {
      if (removeFileWithBackup(path.join(scriptsDir, script), options.dryRun ?? false, options.quiet)) {
        removedCount++;
      }
    }

    // Also remove memory-filters.json and memory-queue.jsonl
    for (const extra of ['memory-filters.json', 'memory-queue.jsonl']) {
      const extraPath = path.join(scriptsDir, extra);
      if (fs.existsSync(extraPath)) {
        if (removeFileWithBackup(extraPath, options.dryRun ?? false, options.quiet)) {
          removedCount++;
        }
      }
    }
  }

  if (removedCount > 0) {
    log(`\n✅ Removed ${removedCount} AutoMem files from Copilot hooks directory`, options.quiet);
  } else {
    log('\nℹ️  No AutoMem files found to remove', options.quiet);
  }
}

function removeCopilotMcpServer(copilotDir: string, dryRun: boolean, quiet?: boolean): boolean {
  const configPath = path.join(copilotDir, 'mcp-config.json');

  if (!fs.existsSync(configPath)) {
    log('ℹ️  Copilot MCP config not found', quiet);
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
      log('ℹ️  No memory server configured in Copilot MCP config', quiet);
      return false;
    }

    if (config?.mcpServers) {
      delete config.mcpServers.memory;
      delete config.mcpServers.automem;
    }

    const backupFile = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backupFile);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    log('🗑️  Removed memory server from Copilot MCP config', quiet);
    log(`   Backup: ${backupFile}`, quiet);
    return true;
  } catch (error) {
    log(`❌ Failed to update Copilot MCP config: ${(error as Error).message}`, quiet);
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
  } else if (options.platform === 'copilot') {
    await uninstallCopilot(options);
  }
  
  // Clean up external changes (Claude Desktop config) if requested
  if (options.cleanAll) {
    log('\n🧹 Cleaning external configurations...', options.quiet);
    if (options.platform === 'copilot') {
      const copilotDir = options.projectDir ?? path.join(os.homedir(), '.copilot');
      removeCopilotMcpServer(copilotDir, options.dryRun ?? false, options.quiet);
    } else {
      // Remove from Claude Desktop config (if present)
      removeClaudeDesktopMemoryServer(options.dryRun ?? false, options.quiet);
      // Remove from Cursor MCP config (if present)
      removeCursorMcpServer(options.dryRun ?? false, options.quiet);
    }
  }
  
  log('\n✨ Uninstall complete!', options.quiet);
  
  if (options.platform === 'cursor' && !options.cleanAll && !options.dryRun) {
    log('\n💡 Note: This removed the project rule file.', options.quiet);
    log('   To also remove the MCP server config from Cursor, re-run with --clean-all', options.quiet);
  } else if (options.platform === 'claude-code' && !options.cleanAll && !options.dryRun) {
    log('\nNote: To also remove the memory server from Claude Desktop config, run:', options.quiet);
    log(`  npx @verygoodplugins/mcp-automem uninstall ${options.platform} --clean-all`, options.quiet);
  } else if (options.platform === 'copilot' && !options.cleanAll && !options.dryRun) {
    log('\nNote: To also remove the MCP server config from Copilot, run:', options.quiet);
    log(`  npx @verygoodplugins/mcp-automem uninstall copilot --clean-all`, options.quiet);
  }
}

function parseUninstallArgs(args: string[]): UninstallOptions | null {
  if (args.length === 0 || (args[0] !== 'cursor' && args[0] !== 'claude-code' && args[0] !== 'copilot')) {
    console.error('❌ Error: Platform required (cursor, claude-code, or copilot)');
    console.error('Usage: mcp-automem uninstall <cursor|claude-code|copilot> [options]');
    return null;
  }
  
  const options: UninstallOptions = {
    platform: args[0] as 'cursor' | 'claude-code' | 'copilot',
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

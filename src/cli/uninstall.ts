import fs from 'fs';
import os from 'os';
import path from 'path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

interface UninstallOptions {
  platform: 'cursor' | 'claude-code';
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
  
  log('\n🗑️  Uninstalling Claude Code AutoMem...', options.quiet);
  
  const pathsToRemove = [
    path.join(claudeDir, 'hooks'),
    path.join(claudeDir, 'scripts'),
    path.join(claudeDir, 'settings.json'),
  ];
  
  let removedCount = 0;
  
  for (const itemPath of pathsToRemove) {
    if (fs.existsSync(itemPath)) {
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        if (removeDirectory(itemPath, options.dryRun ?? false, options.quiet)) {
          removedCount++;
        }
      } else {
        if (removeFileWithBackup(itemPath, options.dryRun ?? false, options.quiet)) {
          removedCount++;
        }
      }
    }
  }
  
  if (removedCount > 0) {
    log(`\n✅ Removed ${removedCount} Claude Code AutoMem items`, options.quiet);
  } else {
    log('\nℹ️  No Claude Code AutoMem files found to remove', options.quiet);
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

function parseUninstallArgs(args: string[]): UninstallOptions | null {
  if (args.length === 0 || (args[0] !== 'cursor' && args[0] !== 'claude-code')) {
    console.error('❌ Error: Platform required (cursor or claude-code)');
    console.error('Usage: mcp-automem uninstall <cursor|claude-code> [options]');
    return null;
  }
  
  const options: UninstallOptions = {
    platform: args[0] as 'cursor' | 'claude-code',
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

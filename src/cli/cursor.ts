import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

interface CursorSetupOptions {
  targetDir?: string;
  projectName?: string;
  projectDescription?: string;
  dryRun?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/cursor', import.meta.url))
);

function log(message: string, quiet?: boolean) {
  if (!quiet) {
    console.log(message);
  }
}

function detectProjectName(): string {
  // 1. Try package.json
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.name) {
        return pkg.name.replace(/^@.*?\//, ''); // Remove scope
      }
    } catch {
      // Continue to next method
    }
  }

  // 2. Try git remote
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    if (remote) {
      const match = remote.match(/\/([^\/]+?)(\.git)?$/);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Continue to next method
  }

  // 3. Fall back to directory name
  return path.basename(process.cwd());
}

function detectProjectDescription(): string {
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.description) {
        return pkg.description;
      }
    } catch {
      // Continue
    }
  }

  if (fs.existsSync('README.md')) {
    try {
      const readme = fs.readFileSync('README.md', 'utf8');
      const lines = readme.split('\n');
      // Get first non-heading, non-empty line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('[')) {
          return trimmed.substring(0, 200); // Limit length
        }
      }
    } catch {
      // Continue
    }
  }

  return 'A software project with persistent AI memory';
}

function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

function replaceTemplateVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
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

function writeFileWithBackup(targetPath: string, content: string, options: CursorSetupOptions) {
  if (options.dryRun) {
    log(`[DRY RUN] Would write: ${targetPath}`, options.quiet);
    return;
  }

  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const existed = fs.existsSync(targetPath);
  if (fs.existsSync(targetPath)) {
    const current = fs.readFileSync(targetPath, 'utf8');
    if (current === content) {
      log(`✓ Unchanged: ${path.basename(targetPath)}`, options.quiet);
      return;
    }
    const backup = backupPath(targetPath);
    fs.copyFileSync(targetPath, backup);
    log(`📦 Backup created: ${backup}`, options.quiet);
  }

  fs.writeFileSync(targetPath, content, 'utf8');
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(targetPath)}`, options.quiet);
}
  log(`✅ ${fileExisted ? 'Updated' : 'Created'}: ${path.basename(targetPath)}`, options.quiet);
}

function checkCursorConfigExists(targetDir: string): boolean {
  const settingsPath = path.join(targetDir, '.cursor', 'rules');
  return fs.existsSync(settingsPath);
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

function checkClaudeDesktopMemoryServer(): { exists: boolean; path: string; configured: boolean } {
  const configPath = getClaudeDesktopConfigPath();

  if (!fs.existsSync(configPath)) {
    return { exists: false, path: configPath, configured: false };
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const hasMemoryServer = config?.mcpServers?.memory || config?.mcpServers?.automem;
    return { exists: true, path: configPath, configured: Boolean(hasMemoryServer) };
  } catch {
    return { exists: true, path: configPath, configured: false };
  }
}

export async function applyCursorSetup(cliOptions: CursorSetupOptions): Promise<void> {
  const projectRoot = process.cwd();
  const projectName = cliOptions.projectName ?? detectProjectName();
  const projectDescription = cliOptions.projectDescription ?? detectProjectDescription();

  // Project-level installation
  const targetDir = cliOptions.targetDir ?? path.join(projectRoot, '.cursor', 'rules');
  const cursorrulesPath = path.join(projectRoot, '.cursorrules');

  const vars: Record<string, string> = {
    PROJECT_NAME: projectName,
    PROJECT_DESCRIPTION: projectDescription,
    CURRENT_MONTH: getCurrentMonth(),
    INSTALL_DATE: getCurrentDate(),
    COMPONENT: 'component',
    ROOT_CAUSE: 'root cause',
    SOLUTION: 'solution',
    FILES: 'files',
    SUMMARY: 'summary',
    IMPACT: 'impact',
    TYPE: 'feature',
    DURATION: '30',
    SPECIFIC_QUERY: 'specific query',
    TAG: 'tag',
    ERROR_MESSAGE: 'error message',
    USER_REQUEST_TOPIC: 'user request topic',
    BUG_DESCRIPTION: 'bug description',
  };

  log(`\n🔧 Setting up Cursor AutoMem for: ${projectName}`, cliOptions.quiet);
  log(`📁 Target directory: ${targetDir}\n`, cliOptions.quiet);

  // Create directory structure
  if (!cliOptions.dryRun) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Process template files
  const templates = [
    { src: 'memory-keeper.md.template', dest: 'memory-keeper.md' },
    { src: 'project-assistant.md.template', dest: 'project-assistant.md' },
    { src: 'AGENTS.md.template', dest: 'AGENTS.md' },
  ];

  for (const { src, dest } of templates) {
    const templatePath = path.join(TEMPLATE_ROOT, src);
    const targetPath = path.join(targetDir, dest);
    
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const processedContent = replaceTemplateVars(templateContent, vars);
    
    writeFileWithBackup(targetPath, processedContent, cliOptions);
  }

  // Create .cursorrules
  const cursorrulesTemplate = fs.readFileSync(
    path.join(TEMPLATE_ROOT, 'cursorrules.template'),
    'utf8'
  );
  const cursorrulesContent = replaceTemplateVars(cursorrulesTemplate, vars);
  
  writeFileWithBackup(cursorrulesPath, cursorrulesContent, cliOptions);

  // Check Claude Desktop memory server
  const memoryCheck = checkClaudeDesktopMemoryServer();
  
  log('\n📊 Configuration Status:', cliOptions.quiet);
  log(`  ✅ Cursor rules installed: ${targetDir}`, cliOptions.quiet);
  log(`  ✅ .cursorrules created: ${cursorrulesPath}`, cliOptions.quiet);
  
  if (!memoryCheck.exists) {
    log(`  ⚠️  Claude Desktop config not found`, cliOptions.quiet);
    log(`     Expected at: ${memoryCheck.path}`, cliOptions.quiet);
  } else if (!memoryCheck.configured) {
    log(`  ⚠️  Memory MCP server not configured in Claude Desktop`, cliOptions.quiet);
    log(`     Add to ${memoryCheck.path}:`, cliOptions.quiet);
    log(`     {`, cliOptions.quiet);
    log(`       "mcpServers": {`, cliOptions.quiet);
    log(`         "memory": {`, cliOptions.quiet);
    log(`           "command": "npx",`, cliOptions.quiet);
    log(`           "args": ["@verygoodplugins/mcp-automem"],`, cliOptions.quiet);
    log(`           "env": {`, cliOptions.quiet);
    log(`             "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001",`, cliOptions.quiet);
    log(`             "AUTOMEM_API_KEY": "your-api-key"`, cliOptions.quiet);
    log(`           }`, cliOptions.quiet);
    log(`         }`, cliOptions.quiet);
    log(`       }`, cliOptions.quiet);
    log(`     }`, cliOptions.quiet);
  } else {
    log(`  ✅ Memory server configured in Claude Desktop`, cliOptions.quiet);
  }

  log('\n✨ Cursor AutoMem setup complete!\n', cliOptions.quiet);
  log('Next steps:', cliOptions.quiet);
  log('  1. Restart Cursor to load the new rules', cliOptions.quiet);
  log('  2. Start a conversation - memory will be auto-recalled', cliOptions.quiet);
  log('  3. Important changes will be automatically stored', cliOptions.quiet);
  
  if (!memoryCheck.configured) {
    log('  4. Configure the memory server in Claude Desktop (see above)', cliOptions.quiet);
  }
  
  log('\n💡 Optional: Add memory-first behavior to ALL Cursor projects:', cliOptions.quiet);
  log('   See README section "Global User Rules" for a prompt snippet', cliOptions.quiet);
  log('   you can add to Cursor Settings > General > Rules for AI', cliOptions.quiet);
}

function parseCursorArgs(args: string[]): CursorSetupOptions {
  const options: CursorSetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
        options.targetDir = args[i + 1];
        i += 1;
        break;
      case '--name':
        options.projectName = args[i + 1];
        i += 1;
        break;
      case '--desc':
      case '--description':
        options.projectDescription = args[i + 1];
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

export async function runCursorSetup(args: string[] = []): Promise<void> {
  const options = parseCursorArgs(args);
  await applyCursorSetup(options);
}

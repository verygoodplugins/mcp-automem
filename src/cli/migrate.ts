import fs from 'fs';
import path from 'path';
import os from 'os';
import { applyCursorSetup } from './cursor.js';
import { applyClaudeCodeSetup } from './claude-code.js';
import { applyCopilotSetup } from './copilot.js';

interface MigrateOptions {
  from: 'manual' | 'none' | 'copilot';
  to: 'cursor' | 'claude-code' | 'copilot';
  projectDir?: string;
  dryRun?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

function log(message: string, quiet?: boolean) {
  if (!quiet) {
    console.log(message);
  }
}

function findManualMemoryUsage(projectDir: string): string[] {
  const found: string[] = [];
  const extensions = ['.ts', '.js', '.tsx', '.jsx', '.md'];
  
  function searchDir(dir: string) {
    if (dir.includes('node_modules') || dir.includes('.git')) {
      return;
    }
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('memory') && (content.includes('store') || content.includes('recall'))) {
              found.push(fullPath);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  
  searchDir(projectDir);
  return found;
}

async function analyzeManualUsage(projectDir: string, quiet?: boolean): Promise<void> {
  log('\n🔍 Analyzing manual memory usage...', quiet);
  
  const files = findManualMemoryUsage(projectDir);
  
  if (files.length === 0) {
    log('  ℹ️  No manual memory usage detected', quiet);
    return;
  }
  
  log(`\n📝 Found potential memory usage in ${files.length} files:`, quiet);
  files.slice(0, 10).forEach(file => {
    log(`  - ${path.relative(projectDir, file)}`, quiet);
  });
  
  if (files.length > 10) {
    log(`  ... and ${files.length - 10} more`, quiet);
  }
  
  log('\n💡 After migration, these manual calls will be handled automatically by AutoMem agents', quiet);
}

function analyzeCopilotHooks(copilotDir: string, quiet?: boolean): void {
  const hooksDir = path.join(copilotDir, 'hooks');

  log('\n🔍 Analyzing existing Copilot AutoMem hooks...', quiet);

  if (!fs.existsSync(hooksDir)) {
    log('  ℹ️  No Copilot hooks directory found', quiet);
    return;
  }

  const hookFiles = fs.readdirSync(hooksDir)
    .filter(f => f.startsWith('automem-') && f.endsWith('.json'));

  if (hookFiles.length === 0) {
    log('  ℹ️  No AutoMem hook files found in Copilot hooks directory', quiet);
    return;
  }

  log(`\n📝 Found ${hookFiles.length} AutoMem hook file(s):`, quiet);
  for (const f of hookFiles) {
    log(`  - ${f}`, quiet);
  }

  // Detect which profile they match
  if (hookFiles.length === 2 &&
      hookFiles.includes('automem-session-start.json') &&
      hookFiles.includes('automem-session-end.json')) {
    log('\n  Profile: lean (session-start + session-end)', quiet);
  } else if (hookFiles.length === 5) {
    log('\n  Profile: full (all hooks)', quiet);
  } else {
    log('\n  Profile: custom (does not match a standard profile)', quiet);
  }

  log('\n💡 After migration, these hooks will be replaced by the target platform configuration', quiet);
}

export async function runMigration(options: MigrateOptions): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  
  log(`\n🚀 Migrating to AutoMem (${options.to})`, options.quiet);
  log(`   From: ${options.from}`, options.quiet);
  log(`   To: ${options.to}`, options.quiet);
  log(`   Project: ${projectDir}\n`, options.quiet);
  
  // Analyze current state
  if (options.from === 'manual') {
    await analyzeManualUsage(projectDir, options.quiet);
  } else if (options.from === 'copilot') {
    const copilotDir = path.join(os.homedir(), '.copilot');
    analyzeCopilotHooks(copilotDir, options.quiet);
  }
  
  // Perform migration
  if (options.to === 'cursor') {
    await applyCursorSetup({
      targetDir: path.join(projectDir, '.cursor', 'rules'),
      dryRun: options.dryRun,
      quiet: options.quiet,
    });
  } else if (options.to === 'claude-code') {
    await applyClaudeCodeSetup({
      dryRun: options.dryRun,
      yes: options.yes,
    });
  } else if (options.to === 'copilot') {
    await applyCopilotSetup({
      targetDir: options.projectDir,
      dryRun: options.dryRun,
      yes: options.yes,
      quiet: options.quiet,
    });
  }
  
  log('\n✅ Migration complete!', options.quiet);
  log('\nRecommended next steps:', options.quiet);
  log('  1. Review the installed agent files', options.quiet);
  log('  2. Restart your editor to load new configurations', options.quiet);
  log('  3. Test memory recall in a new conversation', options.quiet);
  
  if (options.from === 'manual') {
    log('  4. Gradually remove manual memory calls as AutoMem handles them', options.quiet);
  }
}

function parseMigrateArgs(args: string[]): MigrateOptions | null {
  const options: Partial<MigrateOptions> = {};
  
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--from': {
        if (i + 1 >= args.length) {
          console.error('Error: --from requires a value (manual|none|copilot)');
          process.exit(1);
        }
        const fromValue = args[i + 1];
        if (fromValue === 'manual' || fromValue === 'none' || fromValue === 'copilot') {
          options.from = fromValue;
        } else {
          console.error(`Error: Invalid --from value "${fromValue}". Must be "manual", "none", or "copilot"`);
          process.exit(1);
        }
        i += 1;
        break;
      }
      case '--to': {
        if (i + 1 >= args.length) {
          console.error('Error: --to requires a value (cursor|claude-code|copilot)');
          process.exit(1);
        }
        const toValue = args[i + 1];
        if (toValue === 'cursor' || toValue === 'claude-code' || toValue === 'copilot') {
          options.to = toValue;
        } else {
          console.error(`Error: Invalid --to value "${toValue}". Must be "cursor", "claude-code", or "copilot"`);
          process.exit(1);
        }
        i += 1;
        break;
      }
      case '--dir':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          console.error('Error: --dir requires a path value');
          process.exit(1);
        }
        options.projectDir = args[i + 1];
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
  
  if (!options.from || !options.to) {
    console.error('❌ Error: Both --from and --to are required');
    console.error('Usage: mcp-automem migrate --from <manual|none|copilot> --to <cursor|claude-code|copilot>');
    return null;
  }
  
  return options as MigrateOptions;
}

export async function runMigrateCommand(args: string[] = []): Promise<void> {
  const options = parseMigrateArgs(args);
  if (!options) {
    process.exit(1);
  }
  await runMigration(options);
}

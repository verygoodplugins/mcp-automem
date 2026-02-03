import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

interface CodexSetupOptions {
  rulesPath?: string; // default: ./AGENTS.md
  projectName?: string;
  dryRun?: boolean;
  quiet?: boolean;
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/codex', import.meta.url))
);

function log(message: string, quiet?: boolean) {
  if (!quiet) console.log(message);
}

function detectProjectName(): string {
  // 1) package.json name
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.name) return String(pkg.name).replace(/^@.*?\//, '');
    } catch {
      // Ignore JSON parse errors; fall back to other name sources
    }
  }
  // 2) git remote
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    if (remote) {
      const match = remote.match(/\/([^/]+?)(\.git)?$/);
      if (match) return match[1];
    }
  } catch {
    // Ignore missing/invalid git remotes; fall back to directory name
  }
  // 3) directory
  return path.basename(process.cwd());
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function replaceTemplateVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${k}}}`, 'g'), v);
  }
  return result;
}

function backupPath(filePath: string): string {
  let candidate = `${filePath}.bak`;
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${filePath}.bak.${i++}`;
  }
  return candidate;
}

function writeFileWithBackup(targetPath: string, content: string, options: CodexSetupOptions) {
  if (options.dryRun) {
    log(`[DRY RUN] Would write: ${targetPath}`, options.quiet);
    return;
  }
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const existed = fs.existsSync(targetPath);
  if (existed) {
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

function upsertRulesWithMarkers(
  existing: string | null,
  block: string
): string {
  const start = '<!-- BEGIN AUTOMEM CODEX RULES -->';
  const end = '<!-- END AUTOMEM CODEX RULES -->';
  if (!existing) {
    return `${block}\n`;
  }
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + end.length);
    return `${before}${block}${after}`;
  }
  // Append with spacing
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}\n`;
}

export async function applyCodexSetup(cliOptions: CodexSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();
  const rulesPath = cliOptions.rulesPath ?? path.join(process.cwd(), 'AGENTS.md');

  const vars = {
    PROJECT_NAME: projectName,
    CURRENT_MONTH: getCurrentMonth(),
  };

  log(`\n🔧 Setting up Codex AutoMem rules for: ${projectName}`, cliOptions.quiet);
  log(`📄 Target rules file: ${rulesPath}\n`, cliOptions.quiet);

  // Load and process template
  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, vars);

  // Merge/append into AGENTS.md using markers
  const existingContent = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null;
  const finalContent = upsertRulesWithMarkers(existingContent, processed);
  writeFileWithBackup(rulesPath, finalContent, cliOptions);

  // Show configuration hint
  log('\n📊 Configuration Status:', cliOptions.quiet);
  log('  ✅ Project rules installed (AGENTS.md)', cliOptions.quiet);
  log('  ℹ️ Ensure Codex MCP config includes the memory server:', cliOptions.quiet);
  log('     ~/.codex/config.toml', cliOptions.quiet);
  log('     (see templates/codex/config.toml for an example)\n', cliOptions.quiet);

  log('✨ Codex AutoMem setup complete! Next steps:', cliOptions.quiet);
  log('  1. Restart Codex CLI/IDE to reload MCP servers', cliOptions.quiet);
  log('  2. Start a task - Codex should proactively recall/store with memory', cliOptions.quiet);
}

function parseArgs(args: string[]): CodexSetupOptions {
  const options: CodexSetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--rules':
        if (i + 1 >= args.length) {
          console.error('Error: --rules requires a path');
          process.exit(1);
        }
        options.rulesPath = args[++i];
        break;
      case '--name':
        if (i + 1 >= args.length) {
          console.error('Error: --name requires a value');
          process.exit(1);
        }
        options.projectName = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
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

export async function runCodexSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyCodexSetup(options);
}

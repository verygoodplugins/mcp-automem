import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

interface OpenClawSetupOptions {
  workspace?: string;
  mcporterServer?: string;
  projectName?: string;
  dryRun?: boolean;
  quiet?: boolean;
  skipPrompts?: boolean;
  endpoint?: string;
  apiKey?: string;
}

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../../templates/openclaw', import.meta.url))
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
      // fall through
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
    // fall through
  }
  // 3) directory name
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

function writeFileWithBackup(targetPath: string, content: string, options: OpenClawSetupOptions) {
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
  const start = '<!-- BEGIN AUTOMEM OPENCLAW RULES -->';
  const end = '<!-- END AUTOMEM OPENCLAW RULES -->';
  if (!existing) {
    return `${block}\n`;
  }
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block (include the end marker length)
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + end.length);
    return `${before}${block}${after}`;
  }
  // Append with spacing
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}\n`;
}

/**
 * Resolve OpenClaw workspace directory.
 *
 * Priority:
 * 1. Explicit --workspace flag
 * 2. OPENCLAW_WORKSPACE env var
 * 3. OpenClaw config file (agents.defaults.workspace or first agent workspace)
 * 4. Legacy CLAWDBOT_WORKSPACE env var
 * 5. Common default paths: ~/.openclaw/workspace, ~/clawd
 */
function resolveWorkspaceDir(explicit?: string): string | null {
  // 1. Explicit flag
  if (explicit) {
    const resolved = resolveTildePath(explicit);
    if (fs.existsSync(resolved)) return resolved;
    return resolved; // trust the user even if it doesn't exist yet
  }

  // 2. Environment variable
  const envWorkspace = process.env.OPENCLAW_WORKSPACE || process.env.CLAWDBOT_WORKSPACE;
  if (envWorkspace) {
    const resolved = resolveTildePath(envWorkspace);
    if (fs.existsSync(resolved)) return resolved;
  }

  // 3. OpenClaw config file
  const configWorkspace = readWorkspaceFromConfig();
  if (configWorkspace) return configWorkspace;

  // 4. Common default paths
  const homeDir = os.homedir();
  const candidates = [
    path.join(homeDir, '.openclaw', 'workspace'),
    path.join(homeDir, 'clawd'),
    path.join(homeDir, '.clawdbot', 'workspace'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      // Verify it looks like a workspace (has AGENTS.md or SOUL.md)
      const hasAgents = fs.existsSync(path.join(candidate, 'AGENTS.md'));
      const hasSoul = fs.existsSync(path.join(candidate, 'SOUL.md'));
      if (hasAgents || hasSoul) return candidate;
    }
  }

  // Last resort: return first candidate that exists as a directory
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function resolveTildePath(input: string): string {
  if (input.startsWith('~/') || input === '~') {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
}

/**
 * Try to read workspace path from OpenClaw config file.
 * Config lives at ~/.openclaw/config.json5 or ~/.openclaw/config.json
 */
function readWorkspaceFromConfig(): string | null {
  const homeDir = os.homedir();
  const configPaths = [
    path.join(homeDir, '.openclaw', 'config.json5'),
    path.join(homeDir, '.openclaw', 'config.json'),
    path.join(homeDir, '.clawdbot', 'config.json5'),
    path.join(homeDir, '.clawdbot', 'config.json'),
  ];

  for (const configPath of configPaths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      // Strip JSON5 comments for basic parsing
      const stripped = raw
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([}\]])/g, '$1');
      const config = JSON.parse(stripped);

      // agents.defaults.workspace
      const defaultWorkspace = config?.agents?.defaults?.workspace;
      if (defaultWorkspace && typeof defaultWorkspace === 'string') {
        const resolved = resolveTildePath(defaultWorkspace);
        if (fs.existsSync(resolved)) return resolved;
      }

      // First agent's workspace
      const agents = config?.agents?.list;
      if (Array.isArray(agents)) {
        for (const agent of agents) {
          if (agent?.workspace && typeof agent.workspace === 'string') {
            const resolved = resolveTildePath(agent.workspace);
            if (fs.existsSync(resolved)) return resolved;
          }
        }
      }
    } catch {
      // JSON5 parsing failed, continue
    }
  }

  return null;
}

/**
 * Check if mcporter has AutoMem configured.
 */
function checkMcporterConfig(serverName: string): {
  configured: boolean;
  configPath: string | null;
} {
  const homeDir = os.homedir();
  const mcporterPaths = [
    path.join(homeDir, '.mcporter', 'mcporter.json'),
    path.join(process.cwd(), 'config', 'mcporter.json'),
  ];

  for (const configPath of mcporterPaths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const servers = config?.mcpServers;
      if (servers && typeof servers === 'object') {
        // Check for exact server name or common automem names
        const names = [serverName, 'automem', 'automem-stdio', 'automem-remote'];
        for (const name of names) {
          if (servers[name]) {
            return { configured: true, configPath };
          }
        }
      }
    } catch {
      // continue
    }
  }

  return { configured: false, configPath: mcporterPaths[0] };
}

/**
 * Update TOOLS.md with AutoMem reference section.
 */
function updateToolsFile(
  workspaceDir: string,
  serverName: string,
  options: OpenClawSetupOptions
): void {
  const toolsPath = path.join(workspaceDir, 'TOOLS.md');
  const startMarker = '<!-- BEGIN AUTOMEM TOOLS -->';
  const endMarker = '<!-- END AUTOMEM TOOLS -->';

  const toolsBlock = `${startMarker}
### AutoMem (Persistent Graph Memory)

AutoMem gives you semantic memory that persists across all sessions and platforms. Use it via mcporter.

**Recall context:**
\`\`\`bash
mcporter call ${serverName}.recall_memory query="<topic>" limit:5
\`\`\`

**Store a memory:**
\`\`\`bash
mcporter call ${serverName}.store_memory \\
  content="<what you learned>" importance:0.7 \\
  tags='["openclaw","<topic>"]'
\`\`\`

**Health check:**
\`\`\`bash
mcporter call ${serverName}.check_database_health
\`\`\`

AutoMem is separate from file-based daily memory — use both. Files for raw daily logs, AutoMem for durable semantic recall across all conversations.
${endMarker}`;

  if (!fs.existsSync(toolsPath)) {
    // Create TOOLS.md with the block
    const content = `# TOOLS.md - Local Notes\n\nSkills define *how* tools work. This file is for *your* specifics.\n\n${toolsBlock}\n`;
    writeFileWithBackup(toolsPath, content, options);
    return;
  }

  const existing = fs.readFileSync(toolsPath, 'utf8');
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);

  let updated: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + endMarker.length);
    updated = `${before}${toolsBlock}${after}`;
  } else {
    // Check for unmarked AutoMem section and replace it
    const autoMemIdx = existing.indexOf('### AutoMem');
    if (autoMemIdx !== -1) {
      // Find the next section header or end of file
      const nextSectionMatch = existing.slice(autoMemIdx + 1).match(/\n(?:#{1,3} |---)/);
      const sectionEnd = nextSectionMatch
        ? autoMemIdx + 1 + (nextSectionMatch.index ?? existing.length)
        : existing.length;
      const before = existing.slice(0, autoMemIdx);
      const after = existing.slice(sectionEnd);
      updated = `${before}${toolsBlock}${after}`;
    } else {
      // Append before the final line if it's just "Add whatever helps..."
      const sep = existing.endsWith('\n') ? '\n' : '\n\n';
      updated = `${existing}${sep}${toolsBlock}\n`;
    }
  }

  writeFileWithBackup(toolsPath, updated, options);
}

export async function applyOpenClawSetup(cliOptions: OpenClawSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();
  const serverName = cliOptions.mcporterServer ?? 'automem';

  // Resolve workspace
  const workspaceDir = resolveWorkspaceDir(cliOptions.workspace);

  if (!workspaceDir) {
    console.error(`\n❌ Could not find OpenClaw workspace directory.`);
    console.error(`\n   Checked:`);
    console.error(`   • OPENCLAW_WORKSPACE environment variable`);
    console.error(`   • OpenClaw config (~/.openclaw/config.json5)`);
    console.error(`   • ~/.openclaw/workspace`);
    console.error(`   • ~/clawd`);
    console.error(`\n   Use --workspace <path> to specify manually.`);
    process.exit(1);
  }

  const agentsPath = path.join(workspaceDir, 'AGENTS.md');

  const vars: Record<string, string> = {
    PROJECT_NAME: projectName,
    CURRENT_MONTH: getCurrentMonth(),
    MCPORTER_SERVER: serverName,
  };

  log(`\n🔧 Setting up OpenClaw AutoMem for: ${projectName}`, cliOptions.quiet);
  log(`📁 Workspace: ${workspaceDir}`, cliOptions.quiet);
  log(`🔗 mcporter server: ${serverName}\n`, cliOptions.quiet);

  // 1. Install behavioral rules into AGENTS.md
  const templateContent = fs.readFileSync(path.join(TEMPLATE_ROOT, 'memory-rules.md'), 'utf8');
  const processed = replaceTemplateVars(templateContent, vars);

  const existingContent = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : null;
  const finalContent = upsertRulesWithMarkers(existingContent, processed);
  writeFileWithBackup(agentsPath, finalContent, cliOptions);

  // 2. Update TOOLS.md with reference commands
  updateToolsFile(workspaceDir, serverName, cliOptions);

  // 3. Check mcporter configuration
  const mcpCheck = checkMcporterConfig(serverName);

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log(`  ✅ Behavioral rules installed in AGENTS.md`, cliOptions.quiet);
  log(`  ✅ Tool reference updated in TOOLS.md`, cliOptions.quiet);

  if (mcpCheck.configured) {
    log(`  ✅ mcporter has AutoMem configured`, cliOptions.quiet);
  } else {
    log(`\n  ⚠️  AutoMem not found in mcporter config`, cliOptions.quiet);
    log(`\n  Add it with:`, cliOptions.quiet);
    log(``, cliOptions.quiet);
    log(`  # Local AutoMem (stdio):`, cliOptions.quiet);
    log(`  mcporter config add ${serverName} \\`, cliOptions.quiet);
    log(`    --command "npx" --arg "@verygoodplugins/mcp-automem" \\`, cliOptions.quiet);
    log(`    --env "AUTOMEM_ENDPOINT=http://127.0.0.1:8001" \\`, cliOptions.quiet);
    log(`    --scope home`, cliOptions.quiet);
    log(``, cliOptions.quiet);
    log(`  # Or Railway (remote HTTP):`, cliOptions.quiet);
    log(`  mcporter config add ${serverName} \\`, cliOptions.quiet);
    log(`    https://your-sse-sidecar.railway.app/mcp \\`, cliOptions.quiet);
    log(`    --transport http \\`, cliOptions.quiet);
    log(`    --header "Authorization=Bearer YOUR_TOKEN" \\`, cliOptions.quiet);
    log(`    --scope home`, cliOptions.quiet);
  }

  log('\n✨ OpenClaw AutoMem setup complete!\n', cliOptions.quiet);
  log('Next steps:', cliOptions.quiet);

  if (!mcpCheck.configured) {
    log('  1. Configure mcporter (see above)', cliOptions.quiet);
    log('  2. Verify: mcporter list automem', cliOptions.quiet);
    log('  3. Restart OpenClaw gateway', cliOptions.quiet);
    log('  4. Ask your agent a question — it should recall memories automatically', cliOptions.quiet);
  } else {
    log('  1. Restart OpenClaw gateway to pick up new rules', cliOptions.quiet);
    log('  2. Ask your agent a question — it should recall memories automatically', cliOptions.quiet);
  }

  log(`\n💡 Tip: Run with --dry-run to preview changes without modifying files`, cliOptions.quiet);
}

function parseArgs(args: string[]): OpenClawSetupOptions {
  const options: OpenClawSetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--workspace':
        if (i + 1 >= args.length) {
          console.error('Error: --workspace requires a path');
          process.exit(1);
        }
        options.workspace = args[++i];
        break;
      case '--server':
        if (i + 1 >= args.length) {
          console.error('Error: --server requires a name');
          process.exit(1);
        }
        options.mcporterServer = args[++i];
        break;
      case '--name':
        if (i + 1 >= args.length) {
          console.error('Error: --name requires a value');
          process.exit(1);
        }
        options.projectName = args[++i];
        break;
      case '--endpoint':
        if (i + 1 >= args.length) {
          console.error('Error: --endpoint requires a URL');
          process.exit(1);
        }
        options.endpoint = args[++i];
        break;
      case '--api-key':
        if (i + 1 >= args.length) {
          console.error('Error: --api-key requires a value');
          process.exit(1);
        }
        options.apiKey = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--yes':
      case '-y':
        options.skipPrompts = true;
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

export async function runOpenClawSetup(args: string[] = []): Promise<void> {
  const options = parseArgs(args);
  await applyOpenClawSetup(options);
}

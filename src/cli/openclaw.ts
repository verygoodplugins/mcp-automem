import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

interface OpenClawSetupOptions {
  workspace?: string;
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

function resolveTildePath(input: string): string {
  if (input.startsWith('~/') || input === '~') {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
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
      log(`✓ Unchanged: ${targetPath}`, options.quiet);
      return;
    }
    const backup = backupPath(targetPath);
    fs.copyFileSync(targetPath, backup);
    log(`📦 Backup created: ${backup}`, options.quiet);
  }
  fs.writeFileSync(targetPath, content, 'utf8');
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${targetPath}`, options.quiet);
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
      const hasAgents = fs.existsSync(path.join(candidate, 'AGENTS.md'));
      const hasSoul = fs.existsSync(path.join(candidate, 'SOUL.md'));
      if (hasAgents || hasSoul) return candidate;
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Try to read workspace path from OpenClaw config file.
 */
function readWorkspaceFromConfig(): string | null {
  const homeDir = os.homedir();
  const configPaths = [
    path.join(homeDir, '.openclaw', 'openclaw.json'),
    path.join(homeDir, '.openclaw', 'config.json5'),
    path.join(homeDir, '.openclaw', 'config.json'),
    path.join(homeDir, '.clawdbot', 'config.json5'),
    path.join(homeDir, '.clawdbot', 'config.json'),
  ];

  for (const configPath of configPaths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const stripped = raw
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([}\]])/g, '$1');
      const config = JSON.parse(stripped);

      const defaultWorkspace = config?.agents?.defaults?.workspace;
      if (defaultWorkspace && typeof defaultWorkspace === 'string') {
        const resolved = resolveTildePath(defaultWorkspace);
        if (fs.existsSync(resolved)) return resolved;
      }

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
 * Read and return the OpenClaw config (openclaw.json).
 * Returns null if file doesn't exist or can't be parsed.
 */
function readOpenClawConfig(): { config: any; configPath: string } | null {
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, '.openclaw', 'openclaw.json');

  if (!fs.existsSync(configPath)) {
    return { config: {}, configPath };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const stripped = raw
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1');
    return { config: JSON.parse(stripped), configPath };
  } catch {
    return { config: {}, configPath };
  }
}

/**
 * Remove old AGENTS.md AutoMem block if present from previous installs.
 */
function cleanOldAgentsBlock(workspaceDir: string, options: OpenClawSetupOptions): boolean {
  const agentsPath = path.join(workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) return false;

  const content = fs.readFileSync(agentsPath, 'utf8');
  const startMarker = '<!-- BEGIN AUTOMEM OPENCLAW RULES -->';
  const endMarker = '<!-- END AUTOMEM OPENCLAW RULES -->';

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return false;

  if (options.dryRun) {
    log(`[DRY RUN] Would remove old AutoMem block from AGENTS.md`, options.quiet);
    return true;
  }

  const backup = backupPath(agentsPath);
  fs.copyFileSync(agentsPath, backup);
  log(`📦 Backup created: ${backup}`, options.quiet);

  const before = content.slice(0, startIdx).trimEnd();
  const after = content.slice(endIdx + endMarker.length).trimStart();
  const cleaned = before + (after ? '\n\n' + after : '') + '\n';

  fs.writeFileSync(agentsPath, cleaned, 'utf8');
  log(`🧹 Removed old AutoMem block from AGENTS.md`, options.quiet);
  return true;
}

/**
 * Install the AutoMem skill to ~/.openclaw/skills/automem/SKILL.md
 */
function installSkill(options: OpenClawSetupOptions): void {
  const homeDir = os.homedir();
  const skillDir = path.join(homeDir, '.openclaw', 'skills', 'automem');
  const skillTarget = path.join(skillDir, 'SKILL.md');
  const skillSource = path.join(TEMPLATE_ROOT, 'skill', 'SKILL.md');

  if (!fs.existsSync(skillSource)) {
    console.error(`❌ Skill template not found: ${skillSource}`);
    process.exit(1);
  }

  const content = fs.readFileSync(skillSource, 'utf8');
  writeFileWithBackup(skillTarget, content, options);
}

/**
 * Configure env vars in openclaw.json under skills.entries.automem.env
 */
function configureEnvVars(options: OpenClawSetupOptions): void {
  const result = readOpenClawConfig();
  if (!result) return;

  const { config, configPath } = result;

  const endpoint = options.endpoint || process.env.AUTOMEM_ENDPOINT || 'http://127.0.0.1:8001';
  const apiKey = options.apiKey || process.env.AUTOMEM_API_KEY || '';

  // Deep-merge skills.entries.automem
  if (!config.skills) config.skills = {};
  if (!config.skills.entries) config.skills.entries = {};

  config.skills.entries.automem = {
    ...config.skills.entries.automem,
    enabled: true,
    env: {
      AUTOMEM_ENDPOINT: endpoint,
      ...(apiKey ? { AUTOMEM_API_KEY: apiKey } : {}),
      ...config.skills.entries?.automem?.env,
    },
  };

  // Ensure endpoint is always set even if existing config had different keys
  config.skills.entries.automem.env.AUTOMEM_ENDPOINT =
    config.skills.entries.automem.env.AUTOMEM_ENDPOINT || endpoint;

  if (options.dryRun) {
    log(`[DRY RUN] Would update: ${configPath}`, options.quiet);
    log(`[DRY RUN] skills.entries.automem = ${JSON.stringify(config.skills.entries.automem, null, 2)}`, options.quiet);
    return;
  }

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(configPath)) {
    const backup = backupPath(configPath);
    fs.copyFileSync(configPath, backup);
    log(`📦 Backup created: ${backup}`, options.quiet);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  log(`✅ Updated: ${configPath}`, options.quiet);
}

/**
 * Ensure memory/ directory exists in workspace.
 */
function ensureMemoryDir(workspaceDir: string, options: OpenClawSetupOptions): void {
  const memoryDir = path.join(workspaceDir, 'memory');
  if (!fs.existsSync(memoryDir)) {
    if (options.dryRun) {
      log(`[DRY RUN] Would create: ${memoryDir}/`, options.quiet);
    } else {
      fs.mkdirSync(memoryDir, { recursive: true });
      const gitkeepPath = path.join(memoryDir, '.gitkeep');
      if (!fs.existsSync(gitkeepPath)) {
        fs.writeFileSync(gitkeepPath, '', 'utf8');
      }
      log(`✅ Created: memory/`, options.quiet);
    }
  } else {
    log(`✓ Exists: memory/`, options.quiet);
  }
}

export async function applyOpenClawSetup(cliOptions: OpenClawSetupOptions): Promise<void> {
  const projectName = cliOptions.projectName ?? detectProjectName();

  // Resolve workspace
  const workspaceDir = resolveWorkspaceDir(cliOptions.workspace);

  if (!workspaceDir) {
    console.error(`\n❌ Could not find OpenClaw workspace directory.`);
    console.error(`\n   Checked:`);
    console.error(`   • OPENCLAW_WORKSPACE environment variable`);
    console.error(`   • OpenClaw config (~/.openclaw/openclaw.json)`);
    console.error(`   • ~/.openclaw/workspace`);
    console.error(`   • ~/clawd`);
    console.error(`\n   Use --workspace <path> to specify manually.`);
    process.exit(1);
  }

  log(`\n🔧 Setting up OpenClaw AutoMem for: ${projectName}`, cliOptions.quiet);
  log(`📁 Workspace: ${workspaceDir}`, cliOptions.quiet);
  log(`📦 Architecture: native skill (curl → AutoMem HTTP API)\n`, cliOptions.quiet);

  // 1. Install skill to ~/.openclaw/skills/automem/SKILL.md
  installSkill(cliOptions);

  // 2. Configure env vars in openclaw.json
  configureEnvVars(cliOptions);

  // 3. Ensure memory/ directory exists
  ensureMemoryDir(workspaceDir, cliOptions);

  // 4. Clean up old AGENTS.md block from previous installs
  cleanOldAgentsBlock(workspaceDir, cliOptions);

  // Summary
  const endpoint = cliOptions.endpoint || process.env.AUTOMEM_ENDPOINT || 'http://127.0.0.1:8001';

  log('\n📊 Configuration Status:', cliOptions.quiet);
  log(`  ✅ Skill installed: ~/.openclaw/skills/automem/SKILL.md`, cliOptions.quiet);
  log(`  ✅ Env vars configured in ~/.openclaw/openclaw.json`, cliOptions.quiet);
  log(`  ✅ memory/ directory ready`, cliOptions.quiet);
  log(`  🔗 Endpoint: ${endpoint}`, cliOptions.quiet);

  log('\n✨ OpenClaw AutoMem setup complete!\n', cliOptions.quiet);
  log('Next steps:', cliOptions.quiet);
  log('  1. Ensure AutoMem service is running at the configured endpoint', cliOptions.quiet);
  log('  2. Restart OpenClaw gateway to pick up the new skill', cliOptions.quiet);
  log('  3. Send a message — the bot will recall and store memories via curl', cliOptions.quiet);

  log('\n💡 What the bot should do:', cliOptions.quiet);
  log(`  • Recall memories via: curl $AUTOMEM_ENDPOINT/recall?query=...`, cliOptions.quiet);
  log(`  • Store memories via: curl -X POST $AUTOMEM_ENDPOINT/memory`, cliOptions.quiet);
  log('  • NOT mention disabled API keys or missing tools', cliOptions.quiet);
  log('  • Only check /health if curl calls are failing', cliOptions.quiet);

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

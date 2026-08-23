#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from 'dotenv';
import { HOST_SETUP_COMMANDS } from './cli/clients.js';
import { runConfig, runSetup } from './cli/setup.js';
import { runInstallCommand } from './cli/install.js';
import { runClaudeCodeSetup } from './cli/claude-code.js';
import { runCursorSetup } from './cli/cursor.js';
import { runCodexSetup } from './cli/codex.js';
import { runOpenClawSetup } from './cli/openclaw.js';
import { COPILOT_USAGE, runCopilotSetup } from './cli/copilot.js';
import { runHermesSetup } from './cli/hermes.js';
import { runGrokSetup } from './cli/grok.js';
import { runMigrateCommand } from './cli/migrate.js';
import { runUninstallCommand } from './cli/uninstall.js';
import { runQueueCommand } from './cli/queue.js';
import { AutoMemClient } from './automem-client.js';
import { parseWatchdogIntervalMs, startParentWatchdog } from './lifecycle.js';
import { readAutoMemApiKeyFromEnv, resolveAutoMemApiUrl } from './env.js';
import { createAutoMemMcpServer } from './mcp-surface.js';
import type { AutoMemConfig } from './types.js';

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdout.isTTY && process.stderr.isTTY);
}

const command = (process.argv[2] || '').toLowerCase();
const isServerMode = command.length === 0;
const KNOWN_COMMANDS = new Set([
  'help',
  '--help',
  '-h',
  'setup',
  'install',
  'config',
  // Per-host setup commands come from the client registry so routing a new host
  // cannot leave it unrecognized here — the drift that left `copilot` missing.
  ...HOST_SETUP_COMMANDS,
  'migrate',
  'uninstall',
  'queue',
  'recall',
]);
const commandArgs = process.argv.slice(3);
const isMachineReadableCommand =
  command === 'config' &&
  commandArgs.some((arg) => arg === '--json' || arg === '--format=json' || arg === '--format');
// Every host handler documents --quiet as "suppress output", and a help request
// exists to print a usage block — in both cases the dotenv banner is exactly the
// noise the caller asked us not to emit. Covers `help`/`--help`/`-h` as the
// command and as a flag on a subcommand (e.g. `copilot --help`).
const isHelpRequest =
  command === 'help' ||
  command === '--help' ||
  command === '-h' ||
  commandArgs.some((arg) => arg === '--help' || arg === '-h');
const wantsQuietOutput = commandArgs.some((arg) => arg === '--quiet');
// The guided installer renders a branded splash + curated review; the dotenv
// banner would corrupt that output, so silence it here too.
const shouldSilenceDotenv =
  isServerMode ||
  isMachineReadableCommand ||
  isHelpRequest ||
  wantsQuietOutput ||
  command === 'install' ||
  !KNOWN_COMMANDS.has(command);

// Prevent dotenv from writing its banner to stdout when the caller expects clean
// machine-readable output (stdio server mode, or `config --format=json`).
process.env.DOTENV_CONFIG_QUIET = shouldSilenceDotenv
  ? 'true'
  : (process.env.DOTENV_CONFIG_QUIET ?? 'false');
process.env.DOTENV_CONFIG_DEBUG = 'false';

if (isServerMode) {
  const logToStderr = (...args: unknown[]) => console.error(...args);
  console.log = logToStderr;
  console.info = logToStderr;
  console.debug = logToStderr;
  console.warn = logToStderr;
}

config({ quiet: shouldSilenceDotenv });

// Optional: allow upstream supervisors (AutoHub, etc.) to set a stable process title for safe cleanup.
// This prevents "kill by package name" from taking down other running MCP clients (Codex/Cursor/etc.).
try {
  const tag = String(process.env.AUTOMEM_PROCESS_TAG || process.env.MCP_PROCESS_TAG || '').trim();
  if (tag) {
    process.title = tag.startsWith('mcp-automem') ? tag : `mcp-automem:${tag}`;
    if (process.env.AUTOMEM_LOG_LEVEL === 'debug' || isInteractiveTerminal()) {
      console.error('[mcp-automem] process.title:', process.title);
    }
  }
} catch {
  // Best-effort only
}

function installStdioErrorGuards() {
  const handler = (error: unknown) => {
    const err = error as { code?: string } | undefined;
    if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') {
      process.exit(0);
    }
  };

  process.stdout.on('error', handler);
  process.stderr.on('error', handler);
}

// Read version from package.json - single source of truth
function getPackageVersion(): string {
  const packageJsonPath = path.resolve(fileURLToPath(new URL('../package.json', import.meta.url)));
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const PACKAGE_VERSION = getPackageVersion();


if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
AutoMem MCP Server - AI Memory Storage & Recall

USAGE:
  npx @verygoodplugins/mcp-automem <command> [options]

COMMANDS:
  setup              Interactive setup for .env configuration
  install            Guided installer for local/cloud AutoMem + agent setup
  config             Show configuration snippets
  claude-code        Set up AutoMem for Claude Code
  copilot            Set up AutoMem for GitHub Copilot
  cursor             Set up AutoMem for Cursor
  codex              Set up AutoMem for Codex
  openclaw           Set up AutoMem for OpenClaw
  hermes             Set up AutoMem for Hermes Agent
  grok               Set up AutoMem for Grok Build
  migrate            Migrate existing projects to AutoMem
  uninstall          Remove AutoMem configuration
  queue              Manage memory queue
  recall             Recall memories via CLI
  help               Show this help message

        CURSOR SETUP:
          npx @verygoodplugins/mcp-automem cursor [options]

          Options:
            --name <name>           Project name (auto-detected if not provided)
            --dir <path>            Target directory for .cursor/rules (default: .cursor/rules)
            --dry-run              Show what would be changed without modifying files
            --quiet                Suppress output

          This command installs the automem.mdc rule file and checks for MCP server configuration.
          For global behavior across all projects, add memory rules to Cursor Settings > Rules for AI.

CLAUDE CODE SETUP:
  npx @verygoodplugins/mcp-automem claude-code [options]

  Settings-level install. Recommended alternative: the AutoMem plugin
  (/plugin marketplace add verygoodplugins/mcp-automem, then
  /plugin install automem@verygoodplugins-mcp-automem).

  Options:
    --dir <path>           Target directory (default: ~/.claude)
    --profile <name>       silent (default) or nudged. 'nudged' also registers
                           the Stop storage-nudge hook; 'silent' leaves the
                           session end quiet (SessionStart recall + store tracker only)
    --dry-run             Show what would be changed
    --quiet               Suppress output
    --yes, -y             Skip confirmation prompts

${COPILOT_USAGE}

MIGRATION:
  npx @verygoodplugins/mcp-automem migrate --from <source> --to <target>
  
  Options:
    --from <manual|none>   Source configuration
    --to <cursor|claude-code> Target platform
    --dir <path>          Project directory
    --dry-run             Preview migration
    --yes, -y             Skip confirmation

UNINSTALL:
  npx @verygoodplugins/mcp-automem uninstall <cursor|claude-code|codex|hermes|grok> [options]

  Options:
    --dir <path>          Project / hermes-home / grok-home directory
    --rules <path>        Rules file to strip (default: codex <project>/AGENTS.md, hermes/grok <home>/AGENTS.md)
    --clean-all          Also remove MCP server config (Cursor/Claude Desktop)
    --dry-run           Show what would be removed
    --yes, -y           Skip confirmation

RECALL:
  npx @verygoodplugins/mcp-automem recall [options]
  
  Options:
    --query <text>        Search query
    --tags <tag1,tag2>    Filter by tags (comma-separated)
    --limit <number>      Maximum results (default: 5)

        EXAMPLES:
          # Set up Cursor in current project (installs automem.mdc rule)
          npx @verygoodplugins/mcp-automem cursor

          # Set up with custom project name
          npx @verygoodplugins/mcp-automem cursor --name my-project

          # Preview Claude Code setup without changing anything
          npx @verygoodplugins/mcp-automem claude-code --dry-run

          # Migrate manual memory usage to Cursor
          npx @verygoodplugins/mcp-automem migrate --from manual --to cursor

          # Uninstall Cursor AutoMem
          npx @verygoodplugins/mcp-automem uninstall cursor

          # Recall memories matching a query
          npx @verygoodplugins/mcp-automem recall --query "authentication decisions" --limit 5

CODEX SETUP:
  npx @verygoodplugins/mcp-automem codex [options]
  
  Options:
    --name <name>         Project name (auto-detected if not provided)
    --rules <path>        Target rules file (default: ./AGENTS.md)
    --dry-run             Show what would be changed
    --quiet               Suppress output

HERMES SETUP:
  npx @verygoodplugins/mcp-automem hermes [options]

  Options:
    --dir <path>          Hermes home directory (default: $HERMES_HOME or ~/.hermes)
    --name <name>         Project name (auto-detected if not provided)
    --endpoint <url>      AutoMem endpoint (default: $AUTOMEM_API_URL or http://127.0.0.1:8001)
    --api-key <key>       AutoMem API key (optional)
    --mode <mode>         Install mode: mcp, provider, or both (default: mcp)
    --rules <path>        Target rules file (default: <hermes-home>/AGENTS.md)
    --dry-run             Show what would be changed
    --quiet               Suppress output

GROK SETUP:
  npx @verygoodplugins/mcp-automem grok [options]

  Writes native ~/.grok/config.toml [mcp_servers.memory] with AUTOMEM_* env
  (required — Claude/Cursor compat imports can drop env and fail with fetch failed).

  Options:
    --dir <path>          Grok home directory (default: $GROK_HOME or ~/.grok)
    --name <name>         Project name (auto-detected if not provided)
    --endpoint <url>      AutoMem endpoint (default: $AUTOMEM_API_URL or http://127.0.0.1:8001)
    --api-key <key>       AutoMem API key (optional)
    --rules <path>        Target rules file (default: <grok-home>/AGENTS.md)
    --dry-run             Show what would be changed
    --quiet               Suppress output

OPENCLAW SETUP:
  npx @verygoodplugins/mcp-automem openclaw [options]

  Recommended happy path:
    curl -fsSL https://automem.ai/install.sh | bash

  Options:
    --mode <plugin|mcp|skill>   Integration mode (default: plugin)
    --scope <workspace|shared>  Install scope for mcp/skill modes (default: workspace)
    --workspace <path>          OpenClaw workspace directory (auto-detected)
    --endpoint <url>            AutoMem endpoint (default: http://127.0.0.1:8001)
    --api-key <key>             AutoMem API key (optional)
    --plugin-source <spec>      npm spec or path for plugin installs
    --name <name>               Project name used to seed default memory tags
    --replace-memory            Disable OpenClaw's built-in memory layer and use AutoMem as the only memory system
    --dry-run                   Show what would be changed
    --quiet                     Suppress output

GUIDED INSTALL:
  npx @verygoodplugins/mcp-automem install [options]

  Walks you through where AutoMem runs (Hosted Cloud / Local Docker / Existing
  Endpoint), verifies the endpoint, writes .env, and configures your agents.
  For Claude Code it offers the plugin (recommended) or a settings-level install.

  Options:
    --target <local|cloud|existing>  Where AutoMem runs
    --clients <list>                 Comma-separated agents: codex,claude-code,cursor,openclaw,hermes,grok
    --endpoint <url>                 Existing or hosted AutoMem endpoint
    --api-key <key>                  API key for authenticated endpoints
    --local-dir <path>               Local server directory (default: ~/.automem/server)
    --dry-run                        Show the review plan without writing files
    --yes, -y                        Apply without confirmation
    --no-agent-install               Configure endpoint only; skip agent writes

For more information, visit:
https://github.com/verygoodplugins/mcp-automem
`);
  process.exit(0);
}

if (command === 'setup') {
  await runSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'install') {
  await runInstallCommand(process.argv.slice(3));
  // Honor a non-zero exit set for a partial install (some agents need a manual step).
  process.exit(process.exitCode ?? 0);
}

if (command === 'config') {
  await runConfig(process.argv.slice(3));
  process.exit(0);
}

if (command === 'claude-code') {
  await runClaudeCodeSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'copilot') {
  await runCopilotSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'cursor') {
  await runCursorSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'codex') {
  await runCodexSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'openclaw') {
  await runOpenClawSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'hermes') {
  await runHermesSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'grok') {
  await runGrokSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === 'migrate') {
  await runMigrateCommand(process.argv.slice(3));
  process.exit(0);
}

if (command === 'uninstall') {
  await runUninstallCommand(process.argv.slice(3));
  process.exit(0);
}

if (command === 'queue') {
  await runQueueCommand(process.argv.slice(3));
  process.exit(0);
}

if (command === 'recall') {
  const AUTOMEM_API_URL = resolveAutoMemApiUrl().url;
  const AUTOMEM_API_KEY = readAutoMemApiKeyFromEnv();

  const client = new AutoMemClient({
    endpoint: AUTOMEM_API_URL,
    apiKey: AUTOMEM_API_KEY,
  });

  // Parse CLI args
  const args = process.argv.slice(3);
  let query = '';
  let tags: string[] = [];
  let limit = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--query' && args[i + 1]) {
      query = args[++i];
    } else if (args[i] === '--tags' && args[i + 1]) {
      tags = args[++i].split(',');
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  try {
    const results = await client.recallMemory({ query, tags, limit });
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('❌ Recall failed:', error);
    process.exit(1);
  }
}

if (!isServerMode) {
  console.error(`Unknown command: ${command}`);
  console.error('Run `mcp-automem help` for available commands.');
  process.exit(1);
}

const { url: AUTOMEM_API_URL, source: automemApiUrlSource } = resolveAutoMemApiUrl();
const AUTOMEM_API_KEY = readAutoMemApiKeyFromEnv();

if (automemApiUrlSource === 'default') {
  if (isInteractiveTerminal()) {
    console.warn(
      '⚠️  AUTOMEM_API_URL not set. Run `npx @verygoodplugins/mcp-automem setup` or export the environment variable before connecting.'
    );
  }
} else if (automemApiUrlSource === 'AUTOMEM_ENDPOINT') {
  console.warn(
    '⚠️  AUTOMEM_ENDPOINT is deprecated; rename it to AUTOMEM_API_URL. The old name still works for now.'
  );
}

const clientConfig: AutoMemConfig = {
  endpoint: AUTOMEM_API_URL,
  apiKey: AUTOMEM_API_KEY,
};

const client = new AutoMemClient(clientConfig);

const server = createAutoMemMcpServer({
  client,
  name: 'mcp-automem',
  version: PACKAGE_VERSION,
});

async function main() {
  // Capture the parent pid synchronously, before any await, so the watchdog
  // can later detect a reparent (orphaning). process.ppid is dynamic on
  // modern Node, so reading it here pins the original parent.
  const parentPid = process.ppid;

  installStdioErrorGuards();
  const transport = new StdioServerTransport();

  // Defense-in-depth self-termination. The stdio server has no built-in path
  // to exit when its client disconnects while idle; without these it lingers
  // as an orphaned ~108 MB process. Each trigger is idempotent via shutdown().
  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      void transport.close?.();
    } catch {
      /* best effort — we're exiting anyway */
    }
    process.exit(code);
  };

  // Layer 1 — stdin EOF (clean client disconnect). Node already drains the
  // event loop and exits on EOF; this makes the intent explicit.
  process.stdin.on('end', () => shutdown(0));
  process.stdin.on('close', () => shutdown(0));

  // Layer 2 — transport/protocol closed by the SDK.
  server.onclose = () => shutdown(0);

  // Layer 3 — supervisor signals (graceful termination).
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => shutdown(0));
  }

  // Layer 4 — parent-liveness watchdog (load-bearing on POSIX). Catches the
  // orphan case Layers 1-3 miss: an intermediate wrapper holds stdin open so
  // no EOF arrives, yet the client is gone. Relies on orphan reparenting, so
  // it is a no-op on Windows (process.ppid never changes there). Interval is
  // env-tunable via AUTOMEM_PARENT_WATCHDOG_MS; invalid/zero/negative values
  // fall back to the 30 s default (see parseWatchdogIntervalMs).
  const watchdogMs = parseWatchdogIntervalMs(process.env.AUTOMEM_PARENT_WATCHDOG_MS);
  startParentWatchdog(parentPid, watchdogMs, () => shutdown(0));

  await server.connect(transport);
  if (process.env.AUTOMEM_LOG_LEVEL === 'debug') {
    console.error('AutoMem MCP server running');
  }
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});

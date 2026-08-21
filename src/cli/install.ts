import fs from 'fs';
import { parse as parseDotenv } from 'dotenv';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { AGENT_CLIENTS, DEFAULT_AGENT_CLIENTS, type AgentClient } from './clients.js';
import { applyClaudeCodeSetup } from './claude-code.js';
import { applyCodexSetup } from './codex.js';
import { applyCursorSetup } from './cursor.js';
import { applyHermesSetup, type HermesInstallMode } from './hermes.js';
import { applyGrokSetup } from './grok.js';
import { applyOpenClawSetup } from './openclaw.js';
import { resolveGrokPaths } from './grok-config.js';
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';
import {
  AUTOMEM_API_KEY_NAMES,
  mergeEnvContent,
  removeEnvContentKeys,
  sameEndpoint,
  writeFileWithBackup,
} from './host-toolkit.js';
import { provisionViaInstaPodsLink, provisionViaRailway } from './cloud/installer-bridge.js';
// Re-exported so existing importers (and install.test.ts) keep a stable path.
export { formatEnvValue } from './host-toolkit.js';
import { playInstallerSplash, shouldUseInstallerAnimation } from './install-ui.js';
import { makeTheme } from './ui/theme.js';
import { keyValueRows, type TableRow } from './ui/table.js';
import { sectionTitle } from './ui/messages.js';
import { renderBrandHeader, renderSuccessCard, renderWorkingMascot } from './ui/brand.js';
import { startSpinner } from './ui/tasks.js';
import { startChecklist, type ChecklistStep } from './ui/checklist.js';
import { revealHeroLine, revealLines } from './ui/animate.js';
import {
  cancelable,
  promptConfirm,
  promptMultiselect,
  promptSelect,
  promptPassword,
  promptText,
  promptCaption,
} from './ui/prompts.js';

// Claude Code is plugin-first: the marketplace plugin bundles the MCP server +
// hooks and is the recommended path. The settings-level write (applyClaudeCodeSetup)
// stays available as the scriptable alternative. The CLI can't run the in-TUI
// /plugin slash commands, but when the `claude` binary is on PATH it CAN drive the
// supported `claude plugin …` subcommands, so plugin mode installs + configures the
// plugin directly and only falls back to printing these commands when `claude` is
// absent (or the install fails).
export const CLAUDE_CODE_PLUGIN_COMMANDS = [
  '/plugin marketplace add verygoodplugins/mcp-automem',
  '/plugin install automem@verygoodplugins-mcp-automem',
] as const;
export const CLAUDE_CODE_PLUGIN_API_KEY_HINT =
  'Claude Code plugin: run  /plugin configure automem@verygoodplugins-mcp-automem  and set api_key, or export AUTOMEM_API_KEY before using Claude Code.';

// Identity for the `claude plugin …` CLI path (the supported, non-interactive way to
// add the marketplace + install the plugin, distinct from the in-TUI slash commands).
export const CLAUDE_CODE_MARKETPLACE_SOURCE = 'verygoodplugins/mcp-automem';
export const CLAUDE_CODE_PLUGIN_REF = 'automem@verygoodplugins-mcp-automem';

export function claudePluginMarketplaceAddArgs(): string[] {
  return ['plugin', 'marketplace', 'add', CLAUDE_CODE_MARKETPLACE_SOURCE];
}

// `--config api_url=…` matches the plugin.json userConfig key; Claude Code stores it
// via the same path as the interactive /plugin configure flow. api_key is sensitive,
// so it must not be passed in argv where process inspectors can see it.
export function claudePluginInstallArgs(params: { endpoint: string; apiKey?: string }): string[] {
  return [
    'plugin',
    'install',
    CLAUDE_CODE_PLUGIN_REF,
    '--scope',
    'user',
    '--config',
    `api_url=${params.endpoint}`,
  ];
}

export type PluginCommandResult = { code: number; stdout: string; stderr: string };
export type PluginCommandRunner = (command: string, args: string[]) => PluginCommandResult;
export type ClaudeCodePluginInstallResult = { needsManualApiKey: boolean };

// A re-run that re-adds the marketplace or re-installs the plugin may exit non-zero
// just because it's already there — tolerate that rather than falling back to the
// manual commands every time.
function isAlreadyPresent(result: PluginCommandResult): boolean {
  return /already (installed|added|exists|registered|enabled)/i.test(
    `${result.stdout}\n${result.stderr}`
  );
}

// Drive `claude plugin …` to add the marketplace and install + configure the plugin
// non-interactively. Idempotent (skips the add when the marketplace is already
// registered; tolerates an already-installed plugin) and throws on any other failure
// so the caller can fall back to printing the /plugin slash commands.
export async function installClaudeCodePlugin(params: {
  endpoint: string;
  apiKey?: string;
  dryRun: boolean;
  runCommand: PluginCommandRunner;
}): Promise<ClaudeCodePluginInstallResult> {
  if (params.dryRun) return { needsManualApiKey: false };
  const { runCommand } = params;

  const marketplaces = runCommand('claude', ['plugin', 'marketplace', 'list']);
  const hasMarketplace =
    marketplaces.stdout.includes(CLAUDE_CODE_MARKETPLACE_SOURCE) ||
    /verygoodplugins[-/]mcp-automem/.test(marketplaces.stdout);
  if (!hasMarketplace) {
    const added = runCommand('claude', claudePluginMarketplaceAddArgs());
    if (added.code !== 0 && !isAlreadyPresent(added)) {
      throw new InstallError(
        "Couldn't add the AutoMem marketplace via `claude plugin marketplace add`.",
        'Run the two /plugin commands inside Claude Code instead (shown below).'
      );
    }
  }

  const installed = runCommand('claude', claudePluginInstallArgs(params));
  if (installed.code !== 0 && !isAlreadyPresent(installed)) {
    throw new InstallError(
      "Couldn't install the Claude Code plugin via `claude plugin install`.",
      'Run the two /plugin commands inside Claude Code instead (shown below).'
    );
  }

  return { needsManualApiKey: Boolean(params.apiKey) };
}

// How the guided installer wires Claude Code. Defaults to the recommended plugin.
export type ClaudeCodeMode = 'plugin' | 'settings';

// Re-exported so existing importers (and the CLI surface) keep one entry point,
// while the definitions themselves stay dependency-free in ./clients.js.
export { AGENT_CLIENTS, DEFAULT_AGENT_CLIENTS };
export type { AgentClient };
export type InstallTarget = 'local' | 'cloud' | 'existing';
// Hosted-cloud sub-target: InstaPods (open the setup page → paste the emailed
// URL+key), Railway (guided via the railway CLI), or 'other' (paste credentials
// you already have). InstaPods/Railway fall back to a manual paste if needed.
export const CLOUD_PROVIDERS = ['instapods', 'railway', 'other'] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number];
export type InstallActionKind =
  | 'prepare-local'
  | 'provision-cloud'
  | 'verify-endpoint'
  | 'write-env'
  | 'install-agent'
  | 'manual-step';

export type ParsedInstallOptions = {
  target?: InstallTarget;
  cloudProvider?: CloudProviderId;
  clients: AgentClient[];
  endpoint?: string;
  apiKey?: string;
  localDir?: string;
  hermesMode: HermesInstallMode;
  claudeCodeMode: ClaudeCodeMode;
  dryRun: boolean;
  yes: boolean;
  noAgentInstall: boolean;
};

export type ResolvedInstallOptions = ParsedInstallOptions & {
  target: InstallTarget;
};

export type DetectedClient = {
  client: AgentClient;
  root: string;
  exists: boolean;
};

export type InstallEnvironment = {
  cwd: string;
  homeDir: string;
  platform: NodeJS.Platform;
  clientRoots: Record<AgentClient, string>;
  prerequisites: {
    node: boolean;
    npm: boolean;
    docker: boolean;
    git: boolean;
    claude: boolean;
  };
  detectedClients: DetectedClient[];
};

export type InstallAction = {
  kind: InstallActionKind;
  title: string;
  detail: string;
  client?: AgentClient;
  paths: string[];
  command?: string;
  // Copy-paste commands for a manual step (e.g. the Claude Code plugin install).
  commands?: string[];
  secret?: boolean;
};

export type InstallPlan = {
  target: InstallTarget;
  endpoint?: string;
  apiKeyProvided: boolean;
  localDir: string;
  requiresReview: boolean;
  // A preview renders the same stages and the same file paths as a real run, so
  // the renderer needs to know which one this is to label them honestly.
  dryRun: boolean;
  // Deliberate --no-agent-install runs must not get the accidental-zero-agent
  // warning in the review.
  noAgentInstall: boolean;
  actions: InstallAction[];
};

type DetectOptions = {
  homeDir?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  commandExists?: (command: string) => boolean;
  pathExists?: (filePath: string) => boolean;
  env?: NodeJS.ProcessEnv;
};

type VerifyEndpointOptions = {
  endpoint: string;
  apiKey?: string;
  fetchFn?: (
    url: string,
    init?: { headers?: Record<string, string>; signal?: AbortSignal }
  ) => Promise<{
    ok: boolean;
    status: number;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }>;
  /** Per-request network timeout (ms). Default 10000. */
  timeoutMs?: number;
};

type WaitEndpointOptions = VerifyEndpointOptions & {
  attempts?: number;
  intervalMs?: number;
  // Called before each attempt — lets the caller surface retry progress.
  onAttempt?: (attempt: number, attempts: number) => void;
  /**
   * Require this many CONSECUTIVE successful verifies before declaring ready
   * (default 1). A freshly deployed service can flicker during early boot — health
   * is up but the auth'd recall route flaps as dynamic blueprints register / the
   * container restarts — so a single success is premature. Any failure resets the
   * streak.
   */
  stableChecks?: number;
};

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; logFile?: string }
) => void;

const AUTOMEM_REPO = 'https://github.com/verygoodplugins/automem';
const REDACTED = '<redacted>';

// Cap the openclaw CLI's `plugins install` in the guided flow. It shells out to
// an external process whose output we can't surface inside the live checklist, so
// a hang must not freeze the installer — it degrades to a soft per-agent failure.
const OPENCLAW_INSTALL_TIMEOUT_MS = 60_000;

// A user-facing failure: rendered as a clean themed line (never a Node stack
// trace), with an optional actionable hint. Everything that can fail during an
// apply throws one of these so the installer fails gracefully.
export class InstallError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'InstallError';
    this.hint = hint;
  }
}

// Shorten $HOME to ~ so review paths stay readable on one line.
function tildify(filePath: string, homeDir: string = os.homedir()): string {
  if (homeDir && (filePath === homeDir || filePath.startsWith(`${homeDir}${path.sep}`))) {
    return `~${filePath.slice(homeDir.length)}`;
  }
  return filePath;
}

// Discard any keystrokes sitting in the terminal buffer. Used right before the
// apply confirm: keys pressed during the typed plan reveal (impatient Enters
// included) would otherwise be delivered to the prompt the moment it opens.
// Best-effort and brief — resumes stdin in raw mode for a beat, swallowing
// whatever arrives, then restores the paused state inquirer expects.
async function drainBufferedStdin(windowMs = 50): Promise<void> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  const swallow = () => {};
  try {
    stdin.setRawMode?.(true);
    stdin.on('data', swallow);
    stdin.resume();
    await new Promise((resolve) => setTimeout(resolve, windowMs));
  } finally {
    stdin.pause();
    stdin.off('data', swallow);
    stdin.setRawMode?.(false);
  }
}

// A single themed status line (the rich plan is written directly, not boxed, so
// these closers match its left-aligned look instead of a clack rail).
function writeStatus(message: string, tone: 'info' | 'ok' | 'warn' = 'info'): void {
  const theme = makeTheme(process.stdout);
  const mark =
    tone === 'ok'
      ? theme.style.gold(theme.symbol.check)
      : tone === 'warn'
        ? theme.style.yellow(theme.symbol.warn)
        : theme.style.dim(theme.symbol.arrow);
  process.stdout.write(`\n${mark} ${message}\n`);
}

// The instruction that turns a preview into a real install depends on two things
// renderInstallPlan cannot see, so it lives here rather than in the plan body:
//   1. WHERE dry-run came from. `--dry-run` can be dropped; AUTOMEM_DRY_RUN=1 has
//      no flag to remove (parseInstallArgs seeds dryRun from it). Unsetting the
//      shell var is NOT sufficient advice either: index.ts runs dotenv config()
//      without `override`, so a cleared shell var just falls through to the same
//      key in ./.env. AUTOMEM_DRY_RUN=0 beats both (parseBooleanEnv accepts only
//      1/true/yes, and a real shell var outranks dotenv).
//   2. Whether there is a TTY. A headless re-run also needs --yes, or
//      shouldUseNonInteractivePreview sends it straight back into preview mode.
export function dryRunApplyHint(params: {
  interactive: boolean;
  args: string[];
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;
  const fromFlag = params.args.includes('--dry-run');
  const fromEnv = parseBooleanEnv(env.AUTOMEM_DRY_RUN);
  const disable =
    fromFlag && fromEnv
      ? 'drop --dry-run and set AUTOMEM_DRY_RUN=0 (it is on in your shell or .env)'
      : fromEnv
        ? 'set AUTOMEM_DRY_RUN=0 (it is on in your shell or .env)'
        : fromFlag
          ? 'drop --dry-run'
          : 'turn off dry-run mode';
  if (!params.interactive) return `To apply, ${disable}, then re-run with --yes.`;
  // TTY wording is for a human at a keyboard, not a script: say "preview" and
  // "install for real" instead of flag-native verbs like "drop".
  if (fromFlag && fromEnv)
    return 'To install for real, remove --dry-run, set AUTOMEM_DRY_RUN=0, and run it again.';
  if (fromEnv)
    return 'To install for real, set AUTOMEM_DRY_RUN=0 (it is on in your shell or .env) and run it again.';
  return 'To install for real, run the same command without --dry-run.';
}

// Single-quote a value for the reconstructed command when it contains anything
// a shell would interpret (spaces, &, ?, …) — an unquoted "/AutoMem Server"
// splits into two arguments on paste. Plain values stay bare for readability.
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Reconstruct the non-interactive command equivalent to a set of resolved wizard
// answers. Shown when a run stops without applying (declined confirm, failed
// verify) so the user's prompt answers survive as something they can paste. The
// API key is always the literal placeholder <your key> — never the value.
export function equivalentInstallCommand(options: {
  target: InstallTarget;
  endpoint?: string;
  cloudProvider?: CloudProviderId;
  clients: AgentClient[];
  claudeCodeMode?: ClaudeCodeMode;
  hermesMode?: HermesInstallMode;
  localDir?: string;
  noAgentInstall?: boolean;
  yes?: boolean;
  apiKeyProvided: boolean;
}): string {
  const parts = ['npx @verygoodplugins/mcp-automem install', `--target ${options.target}`];
  // --endpoint is rejected with --target local (the local server always binds the
  // compose default), so never reconstruct one there.
  if (options.endpoint && options.target !== 'local')
    parts.push(`--endpoint ${shellQuote(options.endpoint)}`);
  if (options.target === 'cloud' && options.cloudProvider)
    parts.push(`--cloud-provider ${options.cloudProvider}`);
  // YOUR_KEY_HERE (no shell metacharacters): '<your key>' would be parsed as
  // redirections when pasted, silently creating a file named 'key'.
  if (options.apiKeyProvided) parts.push('--api-key YOUR_KEY_HERE');
  if (options.target === 'local' && options.localDir)
    parts.push(`--local-dir ${shellQuote(options.localDir)}`);
  // clients [] with noAgentInstall unset is a CONFIRMED zero-tool selection
  // (the wizard's guard asked). Emitting neither flag would reopen the wizard —
  // or restore the headless default set — on re-run, so both map to the same
  // explicit flag.
  if (options.noAgentInstall || options.clients.length === 0) parts.push('--no-agent-install');
  else parts.push(`--clients ${options.clients.join(',')}`);
  if (!options.noAgentInstall && options.clients.includes('claude-code') && options.claudeCodeMode)
    parts.push(`--claude-code-mode ${options.claudeCodeMode}`);
  if (!options.noAgentInstall && options.clients.includes('hermes') && options.hermesMode)
    parts.push(`--hermes-mode ${options.hermesMode}`);
  // A headless run needed --yes to get past shouldUseNonInteractivePreview;
  // a retry command without it would only print a preview in the same shell.
  if (options.yes) parts.push('--yes');
  return parts.join(' ');
}

// Render a failure as a clean themed block — never a raw Error/stack. The message
// is shown as-is; InstallError hints add an actionable follow-up line. "Command
// failed: …" noise from execFileSync is stripped so users see intent, not internals.
export function formatInstallError(
  err: unknown,
  stream: NodeJS.WriteStream = process.stderr
): string {
  const theme = makeTheme(stream);
  let message = err instanceof Error ? err.message : String(err);
  message = message.replace(/^Command failed:.*$/m, '').trim() || 'AutoMem install failed.';
  const lines = [`\n${theme.style.red(theme.symbol.cross)} ${theme.style.bold(message)}`];
  if (err instanceof InstallError && err.hint) {
    // The hint is the recovery path — indent every line and keep it normal
    // weight (dim recovery text is illegible on light terminals).
    for (const hintLine of err.hint.split('\n')) {
      lines.push(`  ${hintLine}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function parseBooleanEnv(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';
}

function assertValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseTarget(value: string | undefined): InstallTarget | undefined {
  if (!value) return undefined;
  if (value === 'local' || value === 'cloud' || value === 'existing') return value;
  throw new Error(`Invalid install target: ${value}. Expected local, cloud, or existing.`);
}

function parseCloudProvider(value: string | undefined): CloudProviderId | undefined {
  if (!value) return undefined;
  if ((CLOUD_PROVIDERS as readonly string[]).includes(value)) return value as CloudProviderId;
  throw new Error(`Invalid cloud provider: ${value}. Expected ${CLOUD_PROVIDERS.join(' or ')}.`);
}

function parseHermesMode(value: string | undefined): HermesInstallMode | undefined {
  if (!value) return undefined;
  if (value === 'mcp' || value === 'provider' || value === 'both') return value;
  throw new Error(`Invalid Hermes install mode: ${value}. Expected mcp, provider, or both.`);
}

function parseClaudeCodeMode(value: string | undefined): ClaudeCodeMode | undefined {
  if (!value) return undefined;
  if (value === 'plugin' || value === 'settings') return value;
  throw new Error(`Invalid Claude Code mode: ${value}. Expected plugin or settings.`);
}

function parseClients(value: string | undefined): AgentClient[] | undefined {
  if (!value) return undefined;
  const requested = value
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean);
  const invalid = requested.find((client) => !AGENT_CLIENTS.includes(client as AgentClient));
  if (invalid) {
    throw new Error(
      `Invalid AutoMem client: ${invalid}. Expected one of ${AGENT_CLIENTS.join(', ')}.`
    );
  }
  return requested as AgentClient[];
}

export function parseInstallArgs(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): ParsedInstallOptions {
  let target = parseTarget(env.AUTOMEM_INSTALL_TARGET);
  let cloudProvider = parseCloudProvider(env.AUTOMEM_CLOUD_PROVIDER);
  let clients = parseClients(env.AUTOMEM_CLIENTS);
  const envEndpoint = env.AUTOMEM_API_URL || env.AUTOMEM_ENDPOINT;
  const envApiKey = env.AUTOMEM_API_KEY || env.AUTOMEM_API_TOKEN;
  let endpoint = envEndpoint;
  let apiKey = envApiKey;
  // Whether the key came from --api-key rather than the environment. An explicit flag
  // is the operator naming the credential for this run; an inherited one is not.
  let apiKeyFromFlag = false;
  let localDir = env.AUTOMEM_LOCAL_DIR;
  let hermesMode = parseHermesMode(env.AUTOMEM_HERMES_MODE);
  let claudeCodeMode = parseClaudeCodeMode(env.AUTOMEM_CLAUDE_CODE_MODE);
  let dryRun = parseBooleanEnv(env.AUTOMEM_DRY_RUN);
  let yes = parseBooleanEnv(env.AUTOMEM_YES);
  let noAgentInstall = parseBooleanEnv(env.AUTOMEM_NO_AGENT_INSTALL);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--target':
        target = parseTarget(assertValue(args, i, arg));
        i += 1;
        break;
      case '--cloud-provider':
        cloudProvider = parseCloudProvider(assertValue(args, i, arg));
        i += 1;
        break;
      case '--client':
        clients = parseClients(assertValue(args, i, arg));
        i += 1;
        break;
      case '--clients':
        clients = parseClients(assertValue(args, i, arg));
        i += 1;
        break;
      case '--endpoint':
        endpoint = assertValue(args, i, arg);
        i += 1;
        break;
      case '--api-key':
        apiKey = assertValue(args, i, arg);
        apiKeyFromFlag = true;
        i += 1;
        break;
      case '--local-dir':
        localDir = assertValue(args, i, arg);
        i += 1;
        break;
      case '--hermes-mode':
        hermesMode = parseHermesMode(assertValue(args, i, arg));
        i += 1;
        break;
      case '--claude-code-mode':
        claudeCodeMode = parseClaudeCodeMode(assertValue(args, i, arg));
        i += 1;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--yes':
      case '-y':
        yes = true;
        break;
      case '--no-agent-install':
        noAgentInstall = true;
        break;
      default:
        break;
    }
  }

  // An environment key belongs to the environment's endpoint. Selecting a different
  // host with --endpoint must not forward that credential to it — the per-host
  // installers receive this as an explicit apiKey, which bypasses their own pairing
  // checks, so the pairing has to happen here too.
  if (
    !apiKeyFromFlag &&
    envApiKey &&
    envEndpoint &&
    endpoint &&
    !sameEndpoint(endpoint, envEndpoint)
  ) {
    apiKey = undefined;
  }

  return {
    target,
    cloudProvider,
    clients: clients ?? [...DEFAULT_AGENT_CLIENTS],
    endpoint,
    apiKey,
    localDir,
    hermesMode: hermesMode ?? 'mcp',
    claudeCodeMode: claudeCodeMode ?? 'plugin',
    dryRun,
    yes,
    noAgentInstall,
  };
}

function defaultCommandExists(command: string): boolean {
  try {
    // On Windows, npm/docker/git are `.cmd`/`.bat` shims that execFileSync cannot
    // resolve without a shell, so probing 'npm' directly always throws and the
    // prerequisite check reports it missing. The command list is fixed (node, npm,
    // docker, git — never user input), so enabling the shell on win32 is safe.
    execFileSync(command, ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    return true;
  } catch {
    return false;
  }
}

export function detectInstallEnvironment(options: DetectOptions = {}): InstallEnvironment {
  const homeDir = options.homeDir ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? fs.existsSync;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const clientRoots: Record<AgentClient, string> = {
    codex: path.join(homeDir, '.codex'),
    'claude-code': path.join(homeDir, '.claude'),
    cursor: path.join(homeDir, '.cursor'),
    openclaw: path.join(homeDir, '.openclaw'),
    hermes: env.HERMES_HOME || path.join(homeDir, '.hermes'),
    grok: env.GROK_HOME || path.join(homeDir, '.grok'),
  };

  const candidates: DetectedClient[] = AGENT_CLIENTS.map((client) => ({
    client,
    root: clientRoots[client],
    exists: pathExists(clientRoots[client]),
  }));

  return {
    cwd,
    homeDir,
    platform: options.platform ?? process.platform,
    clientRoots,
    prerequisites: {
      node: commandExists('node'),
      npm: commandExists('npm'),
      docker: commandExists('docker'),
      git: commandExists('git'),
      // Soft prerequisite: only the plugin auto-install path uses it, and that path
      // falls back to printed /plugin commands when claude is absent. Never required.
      claude: commandExists('claude'),
    },
    detectedClients: candidates.filter((client) => client.exists),
  };
}

function defaultLocalDir(homeDir: string): string {
  return path.join(homeDir, '.automem', 'server');
}

function hermesPaths(environment: InstallEnvironment, mode: HermesInstallMode): string[] {
  const base = [
    path.join(environment.clientRoots.hermes, 'config.yaml'),
    path.join(environment.clientRoots.hermes, 'AGENTS.md'),
  ];
  if (mode === 'provider' || mode === 'both') {
    base.push(
      path.join(environment.clientRoots.hermes, 'plugins', 'automem', '__init__.py'),
      path.join(environment.clientRoots.hermes, 'plugins', 'automem', 'plugin.yaml'),
      path.join(environment.clientRoots.hermes, '.env')
    );
  }
  return base;
}

function agentPaths(
  client: AgentClient,
  environment: InstallEnvironment,
  options: Pick<ResolvedInstallOptions, 'hermesMode'>
): string[] {
  switch (client) {
    case 'codex':
      // Only AGENTS.md is written by the codex installer. The MCP server
      // registration in ~/.codex/config.toml is advice-only (codex.ts logs a
      // pointer at templates/codex/config.toml, it never writes the file), so
      // listing it here would make the plan promise a write that never happens.
      return [path.join(environment.cwd, 'AGENTS.md')];
    case 'claude-code':
      return [
        path.join(environment.homeDir, '.claude', 'settings.json'),
        path.join(environment.homeDir, '.claude', 'hooks'),
        path.join(environment.homeDir, '.claude', 'scripts'),
      ];
    case 'cursor':
      // Only the project rule file is written. ~/.cursor/mcp.json is advice-only
      // (cursor.ts reads it to detect the memory server and logs a pointer when
      // it's missing — it never writes the file), so listing it here would make
      // the plan over-promise a write the executor never performs (same rule as
      // codex's config.toml above).
      return [path.join(environment.cwd, '.cursor', 'rules', 'automem.mdc')];
    case 'openclaw':
      return [path.join(environment.clientRoots.openclaw, 'openclaw.json')];
    case 'hermes':
      return hermesPaths(environment, options.hermesMode);
    case 'grok': {
      const grok = resolveGrokPaths({ dir: environment.clientRoots.grok });
      return [grok.configPath, grok.agentsPath];
    }
  }
}

function displayKey(apiKey: string | undefined): string | undefined {
  return apiKey ? REDACTED : undefined;
}

export function buildInstallPlan(params: {
  options: ResolvedInstallOptions;
  environment: InstallEnvironment;
}): InstallPlan {
  const { options, environment } = params;
  const localDir = options.localDir ?? defaultLocalDir(environment.homeDir);
  // The local server always binds DEFAULT_AUTOMEM_API_URL (docker compose). A custom
  // --endpoint with --target local would be shown in the approved plan but silently
  // discarded at write time, so reject the contradiction up front rather than
  // persisting a different endpoint than the user approved.
  if (
    options.target === 'local' &&
    options.endpoint &&
    options.endpoint.replace(/\/$/, '') !== DEFAULT_AUTOMEM_API_URL.replace(/\/$/, '')
  ) {
    throw new InstallError(
      `--endpoint is not supported with --target local — the local server always binds ${DEFAULT_AUTOMEM_API_URL}.`,
      'Use --target existing to point AutoMem at a custom endpoint.'
    );
  }
  const endpoint = options.target === 'local' ? DEFAULT_AUTOMEM_API_URL : options.endpoint;
  const actions: InstallAction[] = [];

  if (options.target === 'local') {
    actions.push({
      kind: 'prepare-local',
      title: 'Prepare local AutoMem server',
      detail: `Clone or update ${AUTOMEM_REPO}, write local tokens, and start Docker Compose in ${localDir}.`,
      paths: [localDir, path.join(localDir, '.env')],
      command: `git clone ${AUTOMEM_REPO} ${localDir} && docker compose up -d --build`,
      secret: true,
    });
  } else if (options.target === 'cloud' && !options.endpoint && options.cloudProvider !== 'other') {
    // InstaPods + Railway produce the endpoint + token during apply (after this plan
    // is approved), so they're unknown here; the plan discloses what runs and the
    // cost, and the verify step kicks in once apply has the real endpoint. The
    // 'other' provider pastes credentials up front, so it skips this and flows
    // straight to verify + write-env like an existing endpoint.
    const railway = options.cloudProvider === 'railway';
    actions.push({
      kind: 'provision-cloud',
      title: railway ? 'Deploy AutoMem on Railway' : 'Set up AutoMem on InstaPods',
      detail: railway
        ? 'Sign in via the railway CLI, deploy the AutoMem template straight from the terminal (usage-based, ~$1–5/mo), and capture the endpoint + API token — falling back to a browser deploy if the CLI deploy can’t complete.'
        : 'Open the InstaPods setup page (it deploys AutoMem and emails your API URL + key, Grow plan ~$15/mo), then paste them — or paste credentials you already have.',
      paths: [],
    });
  }

  if (endpoint) {
    actions.push({
      kind: 'verify-endpoint',
      title: 'Verify AutoMem endpoint',
      detail: `Check ${endpoint.replace(/\/$/, '')}/health${options.apiKey ? ' and an authenticated recall probe' : ''}.`,
      paths: [],
      command: options.apiKey
        ? `curl -H "Authorization: Bearer ${REDACTED}" ${endpoint.replace(/\/$/, '')}/recall?limit=1`
        : `curl ${endpoint.replace(/\/$/, '')}/health`,
      secret: Boolean(options.apiKey),
    });
  }

  actions.push({
    kind: 'write-env',
    title: 'Write AutoMem environment',
    detail: `Persist AUTOMEM_API_URL=${endpoint ?? '<prompted>'}${
      options.apiKey ? ` and AUTOMEM_API_KEY=${displayKey(options.apiKey)}` : ''
    } in .env for local MCP runs.`,
    paths: [path.join(environment.cwd, '.env')],
    secret: Boolean(options.apiKey),
  });

  if (!options.noAgentInstall) {
    for (const client of options.clients) {
      // Claude Code plugin mode can't be performed by the CLI (it needs the
      // /plugin slash commands inside Claude Code), so it's a guided manual step
      // instead of a file write. Settings mode keeps the scriptable path.
      if (client === 'claude-code' && options.claudeCodeMode === 'plugin') {
        if (environment.prerequisites.claude) {
          // `claude` is on PATH — install + configure the plugin directly via the
          // supported `claude plugin …` CLI instead of a copy-paste hand-off.
          actions.push({
            kind: 'install-agent',
            title: 'Install the Claude Code plugin (recommended)',
            detail:
              'Add the marketplace and install + configure the plugin via `claude plugin install` — the MCP server, hooks, and skill come bundled and auto-update.',
            client,
            paths: [],
          });
        } else {
          // No `claude` binary — fall back to the guided copy-paste slash commands.
          actions.push({
            kind: 'manual-step',
            title: 'Install the Claude Code plugin (recommended)',
            detail:
              'Run these inside Claude Code — the plugin bundles the MCP server, hooks, and auto-updates.',
            client,
            paths: [],
            commands: [...CLAUDE_CODE_PLUGIN_COMMANDS],
          });
        }
        continue;
      }
      actions.push({
        kind: 'install-agent',
        title: `Install ${clientLabel(client)} integration`,
        detail:
          client === 'hermes'
            ? `Run the Hermes AutoMem installer in ${options.hermesMode} mode with reviewed paths and backups.`
            : client === 'claude-code'
              ? 'Write the settings-level Claude Code hooks + permissions (plugin is the recommended alternative).'
              : `Run the ${clientLabel(client)} AutoMem installer with reviewed paths and backups.`,
        client,
        paths: agentPaths(client, environment, options),
      });
    }
  }

  return {
    target: options.target,
    endpoint,
    apiKeyProvided: Boolean(options.apiKey),
    localDir,
    requiresReview: actions.some(
      (action) => action.paths.length > 0 || action.kind === 'prepare-local'
    ),
    dryRun: options.dryRun,
    noAgentInstall: Boolean(options.noAgentInstall),
    actions,
  };
}

export function shouldUseNonInteractivePreview(params: {
  interactive: boolean;
  yes: boolean;
  dryRun: boolean;
}): boolean {
  return !params.interactive && !params.yes && !params.dryRun;
}

function argsSpecifyClients(args: string[]): boolean {
  return args.includes('--clients') || args.includes('--client');
}

function argsSpecifyHermesMode(args: string[]): boolean {
  return args.includes('--hermes-mode') || Boolean(process.env.AUTOMEM_HERMES_MODE);
}

function argsSpecifyClaudeCodeMode(args: string[]): boolean {
  return args.includes('--claude-code-mode') || Boolean(process.env.AUTOMEM_CLAUDE_CODE_MODE);
}

export function validateInstallPrerequisites(
  options: ResolvedInstallOptions,
  environment: InstallEnvironment
): string[] {
  const missing: string[] = [];

  // npm is only needed for the agent installs (their configs launch the server via
  // `npx`). An endpoint-only run (no agents selected) just verifies + writes .env,
  // so it must not be blocked on npm.
  const installingAgents = !options.noAgentInstall && options.clients.length > 0;
  if (installingAgents && !environment.prerequisites.npm) {
    missing.push('npm');
  }
  if (options.target === 'local') {
    if (!environment.prerequisites.docker) {
      missing.push('docker');
    }
    if (!environment.prerequisites.git) {
      missing.push('git');
    }
  }

  return missing;
}

export async function verifyAutoMemEndpoint(
  options: VerifyEndpointOptions
): Promise<{ ok: true } | { ok: false; message: string }> {
  const endpoint = options.endpoint.replace(/\/$/, '');
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (!fetchFn) {
    return { ok: false, message: 'fetch is not available in this Node runtime.' };
  }

  // Bound every probe with an AbortController (same pattern as automem-client.ts)
  // so a hung endpoint (bad DNS, stalled connect, dead proxy) fails fast instead
  // of blocking the installer at the verify step.
  const timeoutMs = options.timeoutMs ?? 10_000;
  const withTimeout = async (
    url: string,
    init?: { headers?: Record<string, string> }
  ): Promise<{
    ok: boolean;
    status: number;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const health = await withTimeout(`${endpoint}/health`);
    if (!health.ok) {
      return { ok: false, message: `Health check failed with HTTP ${health.status}.` };
    }

    // A 200 alone is not proof this is AutoMem — a reverse-proxy login wall,
    // captive portal, or unrelated service can return 200 with an HTML body.
    // Require a JSON body carrying a string `status` field. AutoMem returns
    // "healthy" or "degraded" (when Qdrant is down); accept any status string,
    // reject non-JSON bodies and JSON without a status.
    let healthBody: unknown;
    try {
      healthBody = typeof health.json === 'function' ? await health.json() : undefined;
    } catch {
      return {
        ok: false,
        message: `Health check returned HTTP ${health.status} but the body was not JSON — is ${endpoint} really an AutoMem endpoint?`,
      };
    }
    const status = (healthBody as { status?: unknown } | null | undefined)?.status;
    if (typeof status !== 'string') {
      return {
        ok: false,
        message: `Health check returned HTTP ${health.status} without an AutoMem status field — is ${endpoint} really an AutoMem endpoint?`,
      };
    }

    if (options.apiKey) {
      const recall = await withTimeout(`${endpoint}/recall?limit=1`, {
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
      });
      if (!recall.ok) {
        return {
          ok: false,
          message: `Authenticated recall probe failed with HTTP ${recall.status}.`,
        };
      }
    }

    return { ok: true };
  } catch (error) {
    const err = error as Error;
    const reason = err.name === 'AbortError' ? `timed out after ${timeoutMs / 1000}s` : err.message;
    return { ok: false, message: `Could not reach AutoMem endpoint ${endpoint}: ${reason}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForAutoMemEndpoint(
  options: WaitEndpointOptions
): Promise<{ ok: true } | { ok: false; message: string }> {
  const attempts = options.attempts ?? 30;
  const intervalMs = options.intervalMs ?? 1000;
  const stableChecks = Math.max(1, options.stableChecks ?? 1);
  let last: { ok: true } | { ok: false; message: string } = {
    ok: false,
    message: 'AutoMem endpoint was not checked.',
  };
  let streak = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.onAttempt?.(attempt, attempts);
    last = await verifyAutoMemEndpoint({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs,
    });
    // Require `stableChecks` CONSECUTIVE successes so a fresh deploy that flickers
    // during early boot (health up, auth'd recall flapping) isn't declared ready on a
    // lucky single hit. Any failure resets the streak.
    streak = last.ok ? streak + 1 : 0;
    if (last.ok && streak >= stableChecks) {
      return last;
    }
    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }

  // Reaching here means we ran out of attempts. `last` may be a failure, or a success
  // that never strung together `stableChecks` in a row (kept flickering).
  const detail = last.ok
    ? `did not stay healthy for ${stableChecks} consecutive checks`
    : last.message;
  return {
    ok: false,
    message: `AutoMem endpoint did not become healthy after ${attempts} attempts: ${detail}`,
  };
}

function mergeEnvFile(
  filePath: string,
  updates: Record<string, string>,
  dryRun: boolean,
  removeKeys: readonly string[] = []
): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const merged = mergeEnvContent(existing, updates);
  // .env files written by the installer carry secrets — the project .env can hold
  // AUTOMEM_API_KEY and the local server .env holds AUTOMEM_API_TOKEN/ADMIN_API_TOKEN
  // — so restrict them to 0o600, matching the uninstall path's perms.
  writeFileWithBackup(filePath, removeEnvContentKeys(merged, removeKeys), {
    dryRun,
    quiet: true,
    secret: true,
  });
}

/**
 * Write the project `.env` for a resolved endpoint/key pair.
 *
 * Split out of the install flow so the credential rule below is reachable from a
 * test with a real file — the defect it fixes is only visible in what the file
 * still contains afterwards, not in any in-memory value.
 *
 * Returns the key names it removed (and the endpoint they belonged to) so the
 * caller can say so out loud; silently deleting a user's credential is worse than
 * the bug.
 */
export function writeProjectEnv(params: {
  envPath: string;
  endpoint: string;
  apiKey?: string;
  dryRun?: boolean;
}): { removedKeys: string[]; previousEndpoint?: string } {
  const { envPath, endpoint, apiKey } = params;
  const existingEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const envUpdates: Record<string, string> = {
    AUTOMEM_API_URL: endpoint,
    // Canonical name is AUTOMEM_API_KEY (the service/docs are standardizing on
    // _KEY); the server still reads the AUTOMEM_API_TOKEN alias.
    ...(apiKey ? { AUTOMEM_API_KEY: apiKey } : {}),
  };
  // Keep deprecated aliases in sync only if the file already uses them, so they
  // can't diverge from the canonical names (and we don't add them on fresh files).
  if (/^AUTOMEM_ENDPOINT=/m.test(existingEnv)) envUpdates.AUTOMEM_ENDPOINT = endpoint;
  if (apiKey && /^AUTOMEM_API_TOKEN=/m.test(existingEnv)) envUpdates.AUTOMEM_API_TOKEN = apiKey;

  // A key persisted in .env belongs to the endpoint it was written for, and the stdio
  // server loads this file at startup. Rewriting AUTOMEM_API_URL while leaving the old
  // credential in place would send that bearer token to the new host on every request,
  // so it is removed under both supported names.
  //
  // Derived from the file rather than from a parse-time flag: this is reached whenever
  // no key resolved for this run — an unset shell environment gets here without ever
  // taking the --endpoint/--api-key mismatch branch. Removal needs a persisted endpoint
  // to compare against; a .env holding a key and no URL is not evidence of a mismatch,
  // so it is left alone.
  const previousEndpoint =
    readEnvFileValue(envPath, 'AUTOMEM_API_URL') ?? readEnvFileValue(envPath, 'AUTOMEM_ENDPOINT');
  const persistedKeyNames = apiKey
    ? []
    : AUTOMEM_API_KEY_NAMES.filter((name) => readEnvFileValue(envPath, name));
  const removedKeys =
    persistedKeyNames.length > 0 && previousEndpoint && !sameEndpoint(previousEndpoint, endpoint)
      ? [...persistedKeyNames]
      : [];

  mergeEnvFile(envPath, envUpdates, params.dryRun ?? false, removedKeys);
  return { removedKeys, previousEndpoint };
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Read a single KEY's effective value from an existing .env, so a re-run can reuse
// previously-written secrets instead of regenerating them — and so the credential
// pairing compares against the endpoint that is actually in effect.
//
// Delegates to dotenv, which is literally the parser that loads this file at server
// startup. A hand-rolled reader kept disagreeing with it in ways that matter here:
// it took the *first* assignment where dotenv takes the last, and it unwrapped only
// double quotes, so `KEY='value'` or a trailing `# comment` compared as a different
// endpoint and removed a still-valid key. Matching the real parser retires that whole
// class rather than the two spellings that were reported.
function readEnvFileValue(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const value = parseDotenv(fs.readFileSync(filePath, 'utf8'))[key];
  return value ? value : undefined;
}

// `docker --version` succeeds with the daemon stopped (Docker Desktop quit but
// CLI on PATH), so the presence check alone can't catch the most common local
// failure. `docker info` needs the daemon. Only called when Local Docker was
// actually chosen, so the extra ~seconds never tax other targets.
function dockerDaemonRunning(): boolean {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 15000 });
  return result.status === 0;
}

function defaultRunCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; logFile?: string } = {}
): void {
  // With logFile set, the child's output is contained there instead of flooding
  // the wizard (docker compose builds print hundreds of lines). Failures still
  // throw; the caller decides how much of the log to surface.
  if (options.logFile) {
    const fd = fs.openSync(options.logFile, 'a');
    try {
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', fd, fd],
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`${command} exited with code ${result.status ?? 'unknown'}`);
      }
    } finally {
      fs.closeSync(fd);
    }
    return;
  }
  execFileSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
}

// Capturing runner for the `claude plugin …` calls: needs the exit code + output
// (not inherited stdio) so installClaudeCodePlugin can read marketplace/plugin state
// and tolerate "already installed". spawnSync never throws on a non-zero exit.
function defaultPluginCommand(command: string, args: string[]): PluginCommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export async function prepareLocalServer(params: {
  localDir: string;
  apiKey?: string;
  dryRun: boolean;
  runCommand?: CommandRunner;
}): Promise<{ endpoint: string; apiKey: string }> {
  const runCommand = params.runCommand ?? defaultRunCommand;
  const envFile = path.join(params.localDir, '.env');
  // Re-running a local install must not rotate the server tokens: a fresh token
  // would invalidate every agent .env already pointing at this server. Reuse the
  // existing localDir/.env tokens when present; generate only when absent, or when
  // an explicit --api-key overrides the stored AutoMem token.
  const apiKey = params.apiKey || readEnvFileValue(envFile, 'AUTOMEM_API_TOKEN') || randomToken();
  const adminToken = readEnvFileValue(envFile, 'ADMIN_API_TOKEN') || randomToken();

  if (params.dryRun) {
    return { endpoint: DEFAULT_AUTOMEM_API_URL, apiKey };
  }

  fs.mkdirSync(path.dirname(params.localDir), { recursive: true });
  try {
    if (fs.existsSync(path.join(params.localDir, '.git'))) {
      runCommand('git', ['-C', params.localDir, 'pull', '--ff-only']);
    } else {
      runCommand('git', ['clone', AUTOMEM_REPO, params.localDir]);
    }
  } catch {
    throw new InstallError(
      `Couldn't fetch the AutoMem server into ${tildify(params.localDir)}.`,
      'Check your network and that git can reach github.com, then re-run. (Git output is above.)'
    );
  }

  mergeEnvFile(
    path.join(params.localDir, '.env'),
    {
      AUTOMEM_API_TOKEN: apiKey,
      ADMIN_API_TOKEN: adminToken,
    },
    false
  );
  const composeLog = path.join(params.localDir, 'install.log');
  try {
    runCommand('docker', ['compose', '--env-file', '.env', 'up', '-d', '--build'], {
      cwd: params.localDir,
      env: { ...process.env, AUTOMEM_API_TOKEN: apiKey, ADMIN_API_TOKEN: adminToken },
      logFile: composeLog,
    });
  } catch {
    // Surface only the tail — the full compose transcript lives in the log.
    let tail = '';
    try {
      const logLines = fs.readFileSync(composeLog, 'utf8').trimEnd().split('\n');
      tail = logLines.slice(-15).join('\n');
    } catch {
      /* no log — docker may have failed to launch at all */
    }
    throw new InstallError(
      "Local AutoMem server didn't start (docker compose).",
      `Is Docker Desktop running? Open it, then re-run this installer.\n` +
        `Also common: a port already in use — FalkorDB :3000, Qdrant :6333, or the API :8001 ` +
        `(run \`docker ps\` to find the conflict).\n` +
        `Full build log: ${tildify(composeLog)}${tail ? `\nLast lines:\n${tail}` : ''}`
    );
  }

  return { endpoint: DEFAULT_AUTOMEM_API_URL, apiKey };
}

// The user picked a labeled option; the review should echo that label back, not
// the internal enum value ("existing" / "cloud" / "local").
function targetLabel(target: InstallTarget): string {
  switch (target) {
    case 'cloud':
      return 'hosted cloud';
    case 'local':
      return 'local docker';
    case 'existing':
      return 'existing endpoint';
  }
}

function clientLabel(client: AgentClient): string {
  switch (client) {
    case 'codex':
      return 'Codex';
    case 'claude-code':
      return 'Claude Code';
    case 'cursor':
      return 'Cursor';
    case 'openclaw':
      return 'OpenClaw';
    case 'hermes':
      return 'Hermes';
    case 'grok':
      return 'Grok Build';
  }
}

// One actionable line per agent that failed to apply, so a partial install ends
// with a clear "here's how to finish it by hand" rather than a dead end.
export function manualFixHint(client: AgentClient): string {
  switch (client) {
    case 'openclaw':
      return 'OpenClaw: run  openclaw plugins install @verygoodplugins/mcp-automem --force';
    case 'hermes':
      return 'Hermes: re-run  npx @verygoodplugins/mcp-automem install --clients hermes';
    case 'cursor':
      return 'Cursor: re-run  npx @verygoodplugins/mcp-automem install --clients cursor';
    case 'codex':
      return 'Codex: re-run  npx @verygoodplugins/mcp-automem install --clients codex';
    case 'claude-code':
      return 'Claude Code: re-run  npx @verygoodplugins/mcp-automem install --clients claude-code';
    case 'grok':
      return 'Grok: re-run  npx @verygoodplugins/mcp-automem install --clients grok';
  }
}

function actionTag(action: InstallAction): string {
  switch (action.kind) {
    case 'prepare-local':
      return 'local';
    case 'provision-cloud':
      return 'cloud';
    case 'verify-endpoint':
      return 'verify';
    case 'write-env':
      return 'write';
    case 'install-agent':
      return 'agent';
    case 'manual-step':
      return 'guide';
  }
}

type RenderTheme = ReturnType<typeof makeTheme>;

// Distinct hue per stage kind so the plan scans at a glance.
function tagStyle(theme: RenderTheme, kind: InstallActionKind): (text: string) => string {
  switch (kind) {
    case 'prepare-local':
      return theme.style.magenta;
    case 'provision-cloud':
      return theme.style.magenta;
    case 'verify-endpoint':
      return theme.style.blue;
    case 'write-env':
      return theme.style.gold;
    case 'install-agent':
      return theme.style.green;
    case 'manual-step':
      return theme.style.yellow;
  }
}

// A small per-agent glyph (unicode terminals only; ascii falls back to a bullet).
function clientGlyph(client: AgentClient, theme: RenderTheme): string {
  if (!theme.unicode) return '-';
  const glyphs: Record<AgentClient, string> = {
    codex: '⌘',
    'claude-code': '✦',
    cursor: '❯',
    openclaw: '◆',
    hermes: '☿',
    grok: '⚡',
  };
  return glyphs[client] ?? '•';
}

// One concise line per stage. The title already names the action, so detail is
// only the single most useful fact (or nothing for an agent install). Secrets are
// never rendered as values — "+ API key" stands in for a provided key.
function renderActionDetail(
  action: InstallAction,
  plan: InstallPlan,
  theme: RenderTheme
): string[] {
  const detail = (value: string): string => `     ${theme.style.dim(value)}`;
  const endpoint = (plan.endpoint ?? '<prompted>').replace(/\/$/, '');
  switch (action.kind) {
    case 'verify-endpoint':
      return [detail(`${endpoint}/health${plan.apiKeyProvided ? '  + auth probe' : ''}`)];
    case 'write-env':
      return [
        detail(
          `AUTOMEM_API_URL=${plan.endpoint ?? '<prompted>'}${plan.apiKeyProvided ? '  + API key' : ''}`
        ),
        detail('saved in the folder you ran this from:'),
      ];
    case 'prepare-local':
      return [detail(`docker compose in ${tildify(plan.localDir)}`)];
    case 'provision-cloud':
      return [detail(action.detail)];
    case 'manual-step':
      return [detail(action.detail)];
    case 'install-agent':
      // Path-writing agent installs are self-explanatory (title + path lines),
      // but a manual/plugin-style action with no paths carries its authored
      // explanation in `detail` — the plugin path's ONLY description. Show it.
      return action.paths.length === 0 && action.detail ? [detail(action.detail)] : [];
  }
}

export function renderInstallPlan(
  plan: InstallPlan,
  stream: NodeJS.WriteStream = process.stdout
): string {
  const theme = makeTheme(stream);
  const out: string[] = [sectionTitle('Install review', theme)];

  // At-a-glance summary chip.
  const agentCount = plan.actions.filter((action) => action.client).length;
  const chip = `${plan.actions.length} stages · ${targetLabel(plan.target)} · ${
    agentCount ? `${agentCount} AI tool${agentCount === 1 ? '' : 's'}` : 'no AI tools'
  }${plan.dryRun ? ' · dry run' : ''}`;
  out.push(`  ${theme.style.dim(chip)}`, '');

  const rows: TableRow[] = [
    { label: 'setup', value: targetLabel(plan.target), status: 'ok' },
    {
      label: 'endpoint',
      // A cloud plan's endpoint arrives during setup — expected, not a warning.
      value:
        plan.endpoint ??
        theme.style.dim(plan.target === 'cloud' ? 'provisioned during setup' : 'not set yet'),
      status: plan.endpoint || plan.target === 'cloud' ? (plan.endpoint ? 'ok' : 'muted') : 'warn',
    },
    {
      label: 'api key',
      value: plan.apiKeyProvided ? REDACTED : theme.style.dim('not set'),
      status: 'muted',
    },
  ];
  if (plan.target === 'local') {
    rows.push({ label: 'server', value: theme.style.dim(tildify(plan.localDir)), status: 'muted' });
  }
  if (agentCount === 0 && !plan.noAgentInstall) {
    // A zero-agent plan is legal but almost never what a first-time user meant —
    // say it in the review instead of quietly omitting the clause. A deliberate
    // --no-agent-install run skips the warning (it asked for exactly this).
    rows.push({
      label: 'ai tools',
      value: 'none selected — nothing will be connected',
      status: 'warn',
    });
  }
  out.push(keyValueRows(rows, theme), '', sectionTitle('Stages', theme));

  let writesFiles = false;
  for (const action of plan.actions) {
    const title =
      action.kind === 'install-agent' && action.client
        ? `${clientGlyph(action.client, theme)} ${action.title}`
        : action.title;
    out.push(
      `  ${tagStyle(theme, action.kind)(`[${actionTag(action)}]`)} ${theme.style.bold(title)}`
    );
    out.push(...renderActionDetail(action, plan, theme));
    for (const cmd of action.commands ?? []) {
      out.push(`     ${theme.style.gold('$')} ${cmd}`);
    }
    // One dim path line per file — no per-file backup line (mentioned once below).
    for (const filePath of action.paths) {
      writesFiles = true;
      out.push(`     ${theme.style.dim(tildify(filePath))}`);
    }
  }

  if (writesFiles) {
    // The path list above is identical in both modes, so this note carries the
    // difference. A dry run must not advertise backups of "changed" files — it
    // changes nothing — and should say how to actually apply the plan.
    // Stay flag-agnostic here: the renderer cannot see TTY state, and the flag
    // that actually applies the plan depends on it (a non-TTY run also needs
    // --yes, or shouldUseNonInteractivePreview sends it straight back to a
    // preview). The caller's closing status line owns that instruction.
    out.push(
      '',
      plan.dryRun
        ? `  ${theme.style.yellow(
            `dry run ${theme.symbol.arrow} nothing is written; the paths above are what a real run would change`
          )}`
        : `  ${theme.style.dim(`backups ${theme.symbol.arrow} each changed file keeps a .bak copy`)}`
    );
  }

  return out.join('\n');
}

async function resolveInteractiveOptions(
  parsed: ParsedInstallOptions,
  environment: InstallEnvironment,
  clientsExplicit: boolean,
  hermesModeExplicit: boolean,
  claudeCodeModeExplicit: boolean
): Promise<ResolvedInstallOptions> {
  let target = parsed.target;
  if (!target) {
    target = await cancelable(
      promptSelect<InstallTarget>({
        message: 'Where should AutoMem run?',
        options: [
          {
            value: 'cloud',
            label: 'Hosted Cloud (recommended)',
            hint: 'easiest — we set it up for you, ~$1–15/mo depending on provider',
          },
          {
            value: 'local',
            label: 'Local Docker',
            // Docker-aware: tell the user NOW whether this path can even start,
            // instead of letting them discover a missing prerequisite mid-wizard.
            hint: environment.prerequisites.docker
              ? 'free, runs on this computer — Docker detected'
              : 'free, runs on this computer — needs Docker (not found here)',
          },
          {
            value: 'existing',
            label: 'Existing Endpoint',
            hint: 'paste an AutoMem URL + key you already have',
          },
        ],
        initialValue: 'cloud',
      })
    );
  }

  let endpoint = parsed.endpoint;
  let apiKey = parsed.apiKey;
  let localDir = parsed.localDir ?? defaultLocalDir(environment.homeDir);

  let cloudProvider = parsed.cloudProvider;
  if (target === 'cloud' && !cloudProvider) {
    cloudProvider = await cancelable(
      promptSelect<CloudProviderId>({
        message: 'How do you want to set up your hosted AutoMem?',
        options: [
          {
            value: 'instapods',
            label: 'InstaPods',
            hint: 'they run it for you and email your URL + key — ~$15/mo',
          },
          {
            value: 'railway',
            label: 'Railway (guided)',
            hint: 'we open Railway, walk you through sign-in, and grab your keys — ~$1–5/mo',
          },
          {
            value: 'other',
            label: 'Other — I already have a URL + key',
            hint: 'already deployed somewhere; just paste your endpoint + token',
          },
        ],
        initialValue: 'instapods',
      })
    );
  }

  if (target === 'local' && !parsed.dryRun) {
    // Fail at the decision, not three prompts later. Dry runs stay open so the
    // path can still be previewed on a machine without Docker.
    if (!environment.prerequisites.docker) {
      throw new InstallError(
        "AutoMem's local option needs Docker on this machine.",
        `Get Docker Desktop (free): https://www.docker.com/products/docker-desktop\n` +
          `Install it, open it once so it's running, then re-run this installer.\n` +
          `Or pick Hosted Cloud — no Docker needed.`
      );
    }
    // The CLI existing doesn't mean the daemon is up — Docker Desktop quit but
    // still on PATH is the most common local-install failure. Catch it here.
    if (!dockerDaemonRunning()) {
      throw new InstallError(
        'Docker is installed but not running.',
        `Open Docker Desktop, wait until it says it's running, then re-run this installer.\n` +
          `Or pick Hosted Cloud — no Docker needed.`
      );
    }
  }
  if (target === 'local') {
    promptCaption("Where the server's files live — the default is fine.");
    localDir = (
      await cancelable(
        promptText({
          message: 'Local AutoMem server directory',
          defaultValue: localDir,
        })
      )
    ).trim();
    endpoint = endpoint ?? DEFAULT_AUTOMEM_API_URL;
  }

  // InstaPods/Railway provision endpoint + token during apply. 'existing', and the
  // cloud 'other' option, collect them here up front. (A cloud run with an explicit
  // --endpoint still skips provisioning via the apply-phase `!endpoint` guard.)
  const collectEndpointHere =
    target === 'existing' || (target === 'cloud' && cloudProvider === 'other');

  if (collectEndpointHere && !endpoint) {
    promptCaption("Your AutoMem server's web address — you got this when you set it up.");
    endpoint = (
      await cancelable(
        promptText({
          message: 'AutoMem API URL',
          validate: (value) =>
            /^https?:\/\/\S+$/.test(value.trim()) ||
            "That doesn't look like a URL — try something like https://your-automem.example",
        })
      )
    ).trim();
  }

  if (collectEndpointHere && !apiKey) {
    promptCaption("Its password, if it has one. Many setups don't.");
    // Masked: the key must never echo in cleartext as the user types.
    const entered = (
      await cancelable(
        promptPassword({
          message: "AutoMem API key (leave blank if you don't have one)",
        })
      )
    ).trim();
    apiKey = entered || undefined;
  }

  let clients = parsed.clients;
  if (!parsed.noAgentInstall && !clientsExplicit) {
    const detected = new Set(environment.detectedClients.map((client) => client.client));
    // On a fresh machine nothing is detected, nothing is pre-checked, and Enter
    // submits an empty selection — silently skipping the tool's entire purpose.
    // Loop: an empty submit gets one explicit confirm; No re-opens the list.
    for (;;) {
      const selected = await cancelable(
        promptMultiselect<AgentClient>({
          message: 'Connect AutoMem to which AI tools?',
          options: AGENT_CLIENTS.map((client) => ({
            value: client,
            label: clientLabel(client),
            hint: detected.has(client)
              ? 'detected on this machine'
              : 'not found here — pick it anyway if you use it',
          })),
          // Pre-check everything detected on this machine (Hermes included) so a
          // user who already runs an agent reaches its follow-up prompts by default.
          initialValues: AGENT_CLIENTS.filter((client) => detected.has(client)),
          required: false,
        })
      );
      if (selected.length > 0) {
        clients = selected;
        break;
      }
      const skipAgents = await cancelable(
        promptConfirm({
          message:
            'No AI tools selected — AutoMem will be set up but nothing will use it. Continue anyway?',
          initialValue: false,
        })
      );
      if (skipAgents) {
        clients = [];
        break;
      }
    }
  }

  let hermesMode = parsed.hermesMode;
  if (!parsed.noAgentInstall && clients.includes('hermes') && !hermesModeExplicit) {
    hermesMode = await cancelable(
      promptSelect<HermesInstallMode>({
        message: 'How should AutoMem integrate with Hermes?',
        options: [
          {
            value: 'provider',
            label: 'Native memory provider',
            hint: "recommended — replaces Hermes's built-in memory",
          },
          {
            value: 'mcp',
            label: 'MCP tools only',
            hint: 'standard protocol connection — works everywhere',
          },
          {
            value: 'both',
            label: 'Both',
            hint: 'advanced; exposes two AutoMem paths',
          },
        ],
        initialValue: 'provider',
      })
    );
  }

  let claudeCodeMode = parsed.claudeCodeMode;
  if (!parsed.noAgentInstall && clients.includes('claude-code') && !claudeCodeModeExplicit) {
    claudeCodeMode = await cancelable(
      promptSelect<ClaudeCodeMode>({
        message: 'How should AutoMem integrate with Claude Code?',
        options: [
          {
            value: 'plugin',
            label: 'Plugin (recommended)',
            hint: 'bundles the MCP server + hooks, prompts for your endpoint, auto-updates',
          },
          {
            value: 'settings',
            label: 'Settings-level install',
            hint: 'writes ~/.claude hooks + permissions directly; no auto-update',
          },
        ],
        initialValue: 'plugin',
      })
    );
  }

  return {
    ...parsed,
    target,
    cloudProvider,
    endpoint,
    apiKey,
    localDir,
    clients,
    hermesMode,
    claudeCodeMode,
  };
}

async function applyAgentInstall(
  client: AgentClient,
  params: {
    endpoint?: string;
    apiKey?: string;
    dryRun: boolean;
    hermesMode: HermesInstallMode;
    claudeCodeMode: ClaudeCodeMode;
  }
): Promise<void> {
  // quiet: true everywhere — the guided installer shows its own themed checklist,
  // so the per-agent installers must not dump their own ✅/📦 output into the flow.
  switch (client) {
    case 'codex':
      await applyCodexSetup({ dryRun: params.dryRun, quiet: true, yes: true });
      break;
    case 'claude-code':
      // Plugin mode is a guided manual step (the plan + outro print the /plugin
      // commands); only the settings path writes files from the CLI.
      if (params.claudeCodeMode === 'plugin') break;
      await applyClaudeCodeSetup({ dryRun: params.dryRun, quiet: true, yes: true });
      break;
    case 'cursor':
      await applyCursorSetup({ dryRun: params.dryRun, quiet: true, skipPrompts: true });
      break;
    case 'openclaw':
      await applyOpenClawSetup({
        mode: 'plugin',
        scope: 'shared',
        endpoint: params.endpoint ?? DEFAULT_AUTOMEM_API_URL,
        apiKey: params.apiKey,
        dryRun: params.dryRun,
        quiet: true,
        skipPrompts: true,
        // The guided flow can't show the openclaw CLI's own output (it runs inside
        // the live checklist), so cap the wait — a hung plugin install becomes a
        // soft per-agent failure with a manual command instead of a 2-min freeze.
        timeoutMs: OPENCLAW_INSTALL_TIMEOUT_MS,
      });
      break;
    case 'hermes':
      await applyHermesSetup({
        mode: params.hermesMode,
        endpoint: params.endpoint ?? DEFAULT_AUTOMEM_API_URL,
        apiKey: params.apiKey,
        dryRun: params.dryRun,
        quiet: true,
        yes: true,
      });
      break;
    case 'grok':
      await applyGrokSetup({
        endpoint: params.endpoint ?? DEFAULT_AUTOMEM_API_URL,
        apiKey: params.apiKey,
        dryRun: params.dryRun,
        quiet: true,
        yes: true,
      });
      break;
  }
}

export async function runInstallCommand(args: string[] = []): Promise<void> {
  // parseInstallArgs (and the splash/header) run before the main pipeline's own
  // try/catch, so a bad flag value would otherwise escape as a raw Node stack
  // trace from the top-level-await dispatch in index.ts. Wrap the whole run so
  // those throws render as a clean themed line too.
  try {
    await runGuidedInstall(args);
  } catch (err) {
    process.stderr.write(formatInstallError(err));
    process.exit(1);
  }
}

async function runGuidedInstall(args: string[] = []): Promise<void> {
  const parsed = parseInstallArgs(args);
  const environment = detectInstallEnvironment();
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const clientsExplicit = Boolean(process.env.AUTOMEM_CLIENTS) || argsSpecifyClients(args);
  const hermesModeExplicit = argsSpecifyHermesMode(args);
  const claudeCodeModeExplicit = argsSpecifyClaudeCodeMode(args);

  // The splash is Unicode mascot art, so only animate when the terminal can
  // render unicode — otherwise fall through to the plain one-line brand header.
  const animate =
    shouldUseInstallerAnimation({
      stdinIsTTY: Boolean(process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      env: process.env,
      args,
    }) && makeTheme(process.stdout).unicode;
  await playInstallerSplash({ enabled: animate, color: !process.env.NO_COLOR });
  // The animated splash only fires on an interactive TTY; everywhere else lead
  // with a one-line branded header so dry-runs and pipes still identify the tool.
  if (animate) {
    // A typed welcome at AutoVault's cadence — the one deliberate "typing" beat.
    await revealHeroLine("Let's set up your agents' memory.");
  } else {
    process.stdout.write(renderBrandHeader(process.stdout, { compact: true }));
  }

  if (shouldUseNonInteractivePreview({ interactive, yes: parsed.yes, dryRun: parsed.dryRun })) {
    const fallback: ResolvedInstallOptions = {
      ...parsed,
      target: parsed.target ?? 'existing',
      dryRun: true,
    };
    const plan = buildInstallPlan({ options: fallback, environment });
    process.stdout.write(`\n${renderInstallPlan(plan)}\n`);
    writeStatus('No TTY detected. Re-run with --yes (or AUTOMEM_YES=1) to apply automatically.');
    return;
  }

  try {
    if (interactive && !parsed.yes) {
      // One line of framing before the first question: how long this takes and —
      // the cheapest trust win in the flow — that nothing happens until the
      // reviewed plan is approved.
      const theme = makeTheme(process.stdout);
      process.stdout.write(
        `  ${theme.style.dim('About 2 minutes. Nothing is written until you approve the plan at the end.')}\n`
      );
    }
    const resolved = interactive
      ? await resolveInteractiveOptions(
          parsed,
          environment,
          clientsExplicit,
          hermesModeExplicit,
          claudeCodeModeExplicit
        )
      : ({ ...parsed, target: parsed.target ?? 'existing' } as ResolvedInstallOptions);
    const missingPrerequisites = validateInstallPrerequisites(resolved, environment);
    if (!resolved.dryRun && missingPrerequisites.length > 0) {
      throw new InstallError(
        `Missing prerequisites for the ${resolved.target} install: ${missingPrerequisites.join(', ')}.`,
        'Install the missing tool(s) and re-run.'
      );
    }

    const plan = buildInstallPlan({ options: resolved, environment });
    // Deliberate, typed reveal: prose types in a word at a time, rules/tables snap
    // in whole. Slower than a dump so the review reads as it builds.
    await revealLines(`\n${renderInstallPlan(plan)}`, {
      typed: true,
      wordDelayMs: 34,
      lineBeatMs: 55,
      structuralBeatMs: 72,
    });

    if (resolved.dryRun) {
      writeStatus(`Dry run only. No files were changed. ${dryRunApplyHint({ interactive, args })}`);
      return;
    }

    if (!resolved.yes) {
      process.stdout.write('\n');
      // Discard keystrokes buffered while the plan was typing out — a buffered
      // Enter would otherwise answer this confirm the instant it opens and
      // silently discard the whole wizard (default is No).
      await drainBufferedStdin();
      const approved = await cancelable(
        promptConfirm({ message: 'Apply this AutoMem install plan?', initialValue: false })
      );
      if (!approved) {
        // Six prompts of answers shouldn't evaporate on a No — hand them back
        // as the equivalent one-liner so re-running skips the wizard entirely.
        writeStatus('Nothing was installed — no files were changed.');
        const theme = makeTheme(process.stdout);
        process.stdout.write(
          `  ${theme.style.dim('Your answers, ready to re-run:')}\n` +
            `  ${theme.style.gold('$')} ${equivalentInstallCommand({ ...resolved, apiKeyProvided: Boolean(resolved.apiKey) })}\n`
        );
        return;
      }
    }

    // Apply phase: a working mascot, then a static line for streaming docker,
    // then a live checklist that ticks each remaining step ✓ as it completes.
    const theme = makeTheme(process.stdout);
    process.stdout.write(renderWorkingMascot(process.stdout));
    process.stdout.write(`\n${sectionTitle('Applying', theme)}\n`);

    let endpoint = resolved.endpoint ?? plan.endpoint;
    let apiKey = resolved.apiKey;

    // Local docker/git stream their own output (inherited stdio), so they run
    // BEFORE the live checklist — a redraw region can't share the screen with it.
    if (resolved.target === 'local') {
      process.stdout.write(
        `  ${theme.style.dim(theme.symbol.arrow)} Building the local server — the first time can take a few minutes ` +
          `${theme.style.dim(`(log: ${tildify(path.join(plan.localDir, 'install.log'))})`)}…\n`
      );
      const local = await prepareLocalServer({ localDir: plan.localDir, apiKey, dryRun: false });
      endpoint = local.endpoint;
      apiKey = local.apiKey;
      process.stdout.write(
        `  ${theme.style.gold(theme.symbol.check)} Local AutoMem server ready\n`
      );

      const spin = startSpinner('Waiting for AutoMem to come online…');
      const ready = await waitForAutoMemEndpoint({ endpoint });
      if (!ready.ok) {
        spin.error('AutoMem did not come online');
        throw new InstallError('AutoMem did not become healthy in time.', ready.message);
      }
      spin.stop('AutoMem is online');
    }

    // InstaPods (open setup page → paste) and Railway (guided railway CLI) provision
    // interactively BEFORE the live checklist, for the same reason as local. Both
    // degrade to a manual endpoint/token paste, so the cloud path is never worse
    // than today. ('other' already collected its endpoint up front, so !endpoint
    // is false here and this is skipped.)
    if (resolved.target === 'cloud' && !endpoint) {
      const providerLabel = resolved.cloudProvider === 'railway' ? 'Railway' : 'InstaPods';
      process.stdout.write(
        `  ${theme.style.dim(theme.symbol.arrow)} Setting up AutoMem on ${providerLabel}…\n`
      );
      const provisioned =
        resolved.cloudProvider === 'railway'
          ? await provisionViaRailway({ interactive, autoConfirm: resolved.yes })
          : await provisionViaInstaPodsLink({ interactive });
      endpoint = provisioned.endpoint;
      apiKey = provisioned.apiKey;

      // A freshly provisioned cloud deploy isn't reachable the instant the CLI
      // returns — a Railway/InstaPods multi-service app cold-starts (build done !=
      // serving, the embedding model downloads on first boot, and a just-generated
      // domain needs DNS). Budget ~5 min (150 × 2s) so we don't false-fail verify on a
      // still-booting deployment (the embedding-model download is the long pole).
      if (endpoint) {
        const spin = startSpinner(
          'Waiting for AutoMem to come online (a fresh deploy can take a few minutes)…'
        );
        // stableChecks: a fresh deploy flickers during early boot (health up before the
        // auth'd recall blueprint registers / the container restarts once), so require a
        // few consecutive health+recall passes before declaring it ready.
        const ready = await waitForAutoMemEndpoint({
          endpoint,
          apiKey,
          attempts: 150,
          intervalMs: 2000,
          stableChecks: 3,
        });
        if (ready.ok) {
          spin.stop('AutoMem is online');
        } else {
          spin.error('AutoMem is not responding yet');
          throw new InstallError(
            `AutoMem deployed, but ${endpoint} isn't responding yet.`,
            `A multi-service deploy can take a few minutes. Check the provider's logs (e.g. \`railway logs\`), then finish with:\n  npx @verygoodplugins/mcp-automem install --target existing --endpoint ${endpoint}${apiKey ? ' --api-key YOUR_KEY_HERE' : ''}`
          );
        }
      }
    }

    if (!endpoint) {
      throw new InstallError('An AutoMem endpoint is required to continue.');
    }

    const agentSteps = resolved.noAgentInstall
      ? []
      : resolved.clients.map((client) => ({ client, key: `agent:${client}` }));
    const steps: ChecklistStep[] = [
      { key: 'verify', label: 'Verify endpoint' },
      { key: 'env', label: 'Write .env' },
      ...agentSteps.map(({ client, key }) => ({
        key,
        label:
          client === 'claude-code' && resolved.claudeCodeMode === 'plugin'
            ? `${clientGlyph(client, theme)} Claude Code (plugin — see below)`
            : `${clientGlyph(client, theme)} Configure ${clientLabel(client)}`,
      })),
    ];

    const list = startChecklist(steps);
    const agentFailures: {
      client: AgentClient;
      message: string;
      hint?: string;
      showPluginCommands?: boolean;
    }[] = [];
    try {
      list.start('verify');
      // Retry rather than single-shot: a just-provisioned cloud endpoint can still
      // flicker for a beat after the warmup (the happy path passes on attempt 1, so
      // local/existing targets see no added delay).
      const verify = await waitForAutoMemEndpoint({
        endpoint,
        apiKey,
        attempts: 8,
        intervalMs: 2000,
        // From the second try onward, show the ladder — 16 quiet seconds of
        // spinner otherwise reads as a hang.
        onAttempt: (attempt, attempts) => {
          if (attempt > 1)
            list.update('verify', `Verify endpoint — attempt ${attempt}/${attempts}`);
        },
      });
      if (!verify.ok) {
        list.fail('verify');
        // Retry against the endpoint we actually verified — for a cloud run
        // that's the freshly provisioned deployment. Reconstructing the
        // resolve-time cloud options would re-provision (and re-bill) a second
        // deployment instead of reconnecting to the one that already exists.
        const retryCommand =
          resolved.target === 'local'
            ? equivalentInstallCommand({ ...resolved, apiKeyProvided: Boolean(apiKey) })
            : equivalentInstallCommand({
                ...resolved,
                target: 'existing',
                cloudProvider: undefined,
                endpoint,
                apiKeyProvided: Boolean(apiKey),
              });
        // Be precise about machine state per target: a cloud deploy already
        // exists (and may bill), a local run has cloned/started containers.
        const machineState =
          resolved.target === 'cloud'
            ? 'Your cloud deployment exists — no AutoMem files were written on this machine yet.'
            : resolved.target === 'local'
              ? 'The local server may still be starting — no agent files were changed.'
              : "Nothing was installed — your machine wasn't changed.";
        throw new InstallError(
          "Couldn't reach your AutoMem server.",
          `${machineState}\n` +
            `Check the URL is right, or wait a minute (the server may still be starting) and re-run:\n` +
            `  ${retryCommand}\n` +
            `Technical detail: ${verify.message}`
        );
      }
      list.done('verify', `Endpoint verified (${endpoint.replace(/\/$/, '')})`);

      list.start('env');
      const envPath = path.join(environment.cwd, '.env');
      const envResult = writeProjectEnv({ envPath, endpoint, apiKey });
      list.done(
        'env',
        envResult.removedKeys.length
          ? `Wrote ${tildify(envPath)} (removed ${envResult.removedKeys.join(', ')} — issued for ${envResult.previousEndpoint})`
          : `Wrote ${tildify(envPath)}`
      );

      // Each agent installs independently: a failure (e.g. the openclaw CLI hanging
      // or absent) marks just that step ✗ and is collected for a manual-fix note —
      // it never aborts the others. Only verify/env above are fatal.
      for (const { client, key } of agentSteps) {
        if (client === 'claude-code' && resolved.claudeCodeMode === 'plugin') {
          // Plugin mode: auto-install via `claude plugin …` when the binary is on
          // PATH; otherwise leave it for the /plugin commands printed in the outro.
          if (!environment.prerequisites.claude) {
            list.done(key);
            continue;
          }
          list.start(key);
          try {
            const pluginInstall = await installClaudeCodePlugin({
              endpoint,
              apiKey,
              dryRun: false,
              runCommand: defaultPluginCommand,
            });
            if (pluginInstall.needsManualApiKey) {
              list.fail(
                key,
                `${clientGlyph(client, theme)} Claude Code plugin needs API key configuration`
              );
              agentFailures.push({
                client,
                message:
                  'Claude Code plugin was installed, but authenticated endpoints require an API key configured in Claude Code.',
                hint: CLAUDE_CODE_PLUGIN_API_KEY_HINT,
                showPluginCommands: false,
              });
            } else {
              list.done(key, `${clientGlyph(client, theme)} Claude Code plugin installed`);
            }
          } catch (pluginErr) {
            list.fail(key, `${clientGlyph(client, theme)} Claude Code plugin needs a manual step`);
            agentFailures.push({
              client,
              message: pluginErr instanceof Error ? pluginErr.message : String(pluginErr),
              showPluginCommands: true,
            });
          }
          continue;
        }
        list.start(key);
        try {
          await applyAgentInstall(client, {
            endpoint,
            apiKey,
            dryRun: false,
            hermesMode: resolved.hermesMode,
            claudeCodeMode: resolved.claudeCodeMode,
          });
          list.done(key, `${clientGlyph(client, theme)} ${clientLabel(client)} configured`);
        } catch (agentErr) {
          list.fail(
            key,
            `${clientGlyph(client, theme)} ${clientLabel(client)} needs a manual step`
          );
          agentFailures.push({
            client,
            message: agentErr instanceof Error ? agentErr.message : String(agentErr),
          });
        }
      }
    } catch (applyErr) {
      list.stop(); // clear the animation + restore the cursor before the error renders
      throw applyErr;
    }

    const nextSteps: string[] = [`endpoint  ${endpoint}`];
    // The finish line earns its box only if it says what to do NOW: restart the
    // tools that were just wired, and a concrete way to see memory working.
    // Only surface the manual /plugin commands when the auto-install didn't run or
    // didn't succeed — i.e. the `claude` binary was absent, or the install failed.
    const pluginAutoInstallFailed = agentFailures.some(
      (failure) => failure.client === 'claude-code' && failure.showPluginCommands !== false
    );
    // Plugin mode without the `claude` binary installs nothing yet — the /plugin
    // commands below ARE the install. Restarting Claude Code before running them
    // would do nothing, so keep it out of the restart line.
    const claudePluginIsManual =
      !resolved.noAgentInstall &&
      resolved.clients.includes('claude-code') &&
      resolved.claudeCodeMode === 'plugin' &&
      (!environment.prerequisites.claude || pluginAutoInstallFailed);
    const installedClients = resolved.noAgentInstall
      ? []
      : resolved.clients.filter(
          (client) =>
            !agentFailures.some((failure) => failure.client === client) &&
            !(client === 'claude-code' && claudePluginIsManual)
        );
    if (installedClients.length > 0) {
      nextSteps.push(
        `Restart ${installedClients.map((client) => clientLabel(client)).join(' / ')} to pick up the connection.`
      );
      nextSteps.push('Try it: ask "what do you remember about me?"');
    }
    nextSteps.push('Docs: https://automem.ai');
    if (claudePluginIsManual) {
      nextSteps.push('Claude Code plugin — run these inside Claude Code:');
      for (const cmd of CLAUDE_CODE_PLUGIN_COMMANDS) {
        nextSteps.push(`  ${cmd}`);
      }
      if (apiKey) nextSteps.push(`  ${CLAUDE_CODE_PLUGIN_API_KEY_HINT}`);
    }
    if (agentFailures.length > 0) {
      const subject =
        agentFailures.length === 1
          ? '1 AI tool needs a manual step:'
          : `${agentFailures.length} AI tools need a manual step:`;
      nextSteps.push(subject);
      for (const failure of agentFailures) {
        nextSteps.push(`  ${failure.hint ?? manualFixHint(failure.client)}`);
      }
    }
    nextSteps.push('Backups: every changed file keeps a <file>.bak copy.');
    // The card is a box, so rows snap in whole (never half-drawn) but slowly —
    // a deliberate beat per row so the finish lands instead of flashing past.
    // Deliberate --no-agent-install runs keep the plain title; the callout is
    // for a wizard user who ended up with nothing connected.
    const zeroAgents = !resolved.noAgentInstall && resolved.clients.length === 0;
    if (zeroAgents) {
      nextSteps.splice(
        1,
        0,
        'Connect one: npx @verygoodplugins/mcp-automem install --clients claude-code (or your tool).'
      );
    }
    const cardTitle =
      agentFailures.length > 0
        ? 'AutoMem is installed — with follow-ups'
        : zeroAgents
          ? 'AutoMem is installed — but not connected to any AI tool'
          : 'AutoMem is installed';
    await revealLines(renderSuccessCard(cardTitle, nextSteps), {
      typed: true,
      wordDelayMs: 42,
      lineBeatMs: 75,
      structuralBeatMs: 120,
    });
    // A partial install (some agents needed a manual step) still completes the
    // rest, but exits non-zero so scripts/CI notice the follow-ups.
    if (agentFailures.length > 0) process.exitCode = 1;
  } catch (err) {
    // Expected failures (bad endpoint, docker port clash, missing prereqs) render
    // as a clean themed line — never a raw Node stack trace. Cancels already exited.
    process.stderr.write(formatInstallError(err));
    process.exit(1);
  }
}

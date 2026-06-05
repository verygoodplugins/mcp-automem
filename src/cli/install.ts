import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { applyClaudeCodeSetup } from './claude-code.js';
import { applyCodexSetup } from './codex.js';
import { applyCursorSetup } from './cursor.js';
import { applyHermesSetup } from './hermes.js';
import { applyOpenClawSetup } from './openclaw.js';
import { DEFAULT_AUTOMEM_API_URL } from './templates.js';
import { backupPath, writeFileWithBackup } from './host-toolkit.js';
import { playInstallerSplash, shouldUseInstallerAnimation } from './install-ui.js';

export const AGENT_CLIENTS = [
  'codex',
  'claude-code',
  'cursor',
  'openclaw',
  'hermes',
] as const;

export type AgentClient = (typeof AGENT_CLIENTS)[number];
export const DEFAULT_AGENT_CLIENTS = [
  'codex',
  'claude-code',
  'cursor',
  'openclaw',
] as const satisfies readonly AgentClient[];
export type InstallTarget = 'local' | 'cloud' | 'existing';
export type InstallActionKind =
  | 'prepare-local'
  | 'verify-endpoint'
  | 'write-env'
  | 'install-agent'
  | 'manual-step';

export type ParsedInstallOptions = {
  target?: InstallTarget;
  clients: AgentClient[];
  endpoint?: string;
  apiKey?: string;
  localDir?: string;
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
  secret?: boolean;
};

export type InstallPlan = {
  target: InstallTarget;
  endpoint?: string;
  apiKeyProvided: boolean;
  localDir: string;
  requiresReview: boolean;
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
  fetchFn?: (url: string, init?: { headers?: Record<string, string> }) => Promise<{
    ok: boolean;
    status: number;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }>;
};

type WaitEndpointOptions = VerifyEndpointOptions & {
  attempts?: number;
  intervalMs?: number;
};

type CommandRunner = (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => void;

const AUTOMEM_REPO = 'https://github.com/verygoodplugins/automem';
const REDACTED = '<redacted>';

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

function parseClients(value: string | undefined): AgentClient[] | undefined {
  if (!value) return undefined;
  const requested = value
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean);
  const invalid = requested.find((client) => !AGENT_CLIENTS.includes(client as AgentClient));
  if (invalid) {
    throw new Error(`Invalid AutoMem client: ${invalid}. Expected one of ${AGENT_CLIENTS.join(', ')}.`);
  }
  return requested as AgentClient[];
}

export function parseInstallArgs(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): ParsedInstallOptions {
  let target = parseTarget(env.AUTOMEM_INSTALL_TARGET);
  let clients = parseClients(env.AUTOMEM_CLIENTS);
  let endpoint = env.AUTOMEM_API_URL || env.AUTOMEM_ENDPOINT;
  let apiKey = env.AUTOMEM_API_KEY || env.AUTOMEM_API_TOKEN;
  let localDir = env.AUTOMEM_LOCAL_DIR;
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
        i += 1;
        break;
      case '--local-dir':
        localDir = assertValue(args, i, arg);
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

  return {
    target,
    clients: clients ?? [...DEFAULT_AGENT_CLIENTS],
    endpoint,
    apiKey,
    localDir,
    dryRun,
    yes,
    noAgentInstall,
  };
}

function defaultCommandExists(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
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
    },
    detectedClients: candidates.filter((client) => client.exists),
  };
}

function defaultLocalDir(homeDir: string): string {
  return path.join(homeDir, '.automem', 'server');
}

function agentPaths(client: AgentClient, environment: InstallEnvironment): string[] {
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
      return [
        path.join(environment.cwd, '.cursor', 'rules', 'automem.mdc'),
        path.join(environment.clientRoots.cursor, 'mcp.json'),
      ];
    case 'openclaw':
      return [path.join(environment.clientRoots.openclaw, 'openclaw.json')];
    case 'hermes':
      return [
        path.join(environment.clientRoots.hermes, 'config.yaml'),
        path.join(environment.clientRoots.hermes, 'AGENTS.md'),
      ];
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
  const endpoint = options.endpoint ?? (options.target === 'local' ? DEFAULT_AUTOMEM_API_URL : undefined);
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
  } else if (options.target === 'cloud') {
    actions.push({
      kind: 'manual-step',
      title: 'Create hosted AutoMem service',
      detail: 'Open InstaPods or Railway, deploy AutoMem, then paste the generated HTTPS endpoint and API token into this wizard.',
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
      actions.push({
        kind: 'install-agent',
        title: `Install ${client} integration`,
        detail: `Run the existing ${client} AutoMem installer with reviewed paths and backups.`,
        client,
        paths: agentPaths(client, environment),
      });
    }
  }

  return {
    target: options.target,
    endpoint,
    apiKeyProvided: Boolean(options.apiKey),
    localDir,
    requiresReview: actions.some((action) => action.paths.length > 0 || action.kind === 'prepare-local'),
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

export function validateInstallPrerequisites(
  options: ResolvedInstallOptions,
  environment: InstallEnvironment
): string[] {
  const missing: string[] = [];

  if (!options.noAgentInstall && !environment.prerequisites.npm) {
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

export async function verifyAutoMemEndpoint(options: VerifyEndpointOptions): Promise<{ ok: true } | { ok: false; message: string }> {
  const endpoint = options.endpoint.replace(/\/$/, '');
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (!fetchFn) {
    return { ok: false, message: 'fetch is not available in this Node runtime.' };
  }

  try {
    const health = await fetchFn(`${endpoint}/health`);
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
      const recall = await fetchFn(`${endpoint}/recall?limit=1`, {
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
      });
      if (!recall.ok) {
        return { ok: false, message: `Authenticated recall probe failed with HTTP ${recall.status}.` };
      }
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, message: `Could not reach AutoMem endpoint: ${(error as Error).message}` };
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
  let last: { ok: true } | { ok: false; message: string } = {
    ok: false,
    message: 'AutoMem endpoint was not checked.',
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await verifyAutoMemEndpoint({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      fetchFn: options.fetchFn,
    });
    if (last.ok) {
      return last;
    }
    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }

  return {
    ok: false,
    message: `AutoMem endpoint did not become healthy after ${attempts} attempts: ${last.message}`,
  };
}

function mergeEnvFile(filePath: string, updates: Record<string, string>, dryRun: boolean): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z0-9_]+)=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }

  const content = `${next.filter((line, index) => line.trim() || index < next.length - 1).join(os.EOL).replace(/\s+$/, '')}${os.EOL}`;
  writeFileWithBackup(filePath, content, { dryRun, quiet: true });
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function defaultRunCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  execFileSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
}

async function prepareLocalServer(params: {
  localDir: string;
  apiKey?: string;
  dryRun: boolean;
  runCommand?: CommandRunner;
}): Promise<{ endpoint: string; apiKey: string }> {
  const runCommand = params.runCommand ?? defaultRunCommand;
  const apiKey = params.apiKey || randomToken();
  const adminToken = randomToken();

  if (params.dryRun) {
    return { endpoint: DEFAULT_AUTOMEM_API_URL, apiKey };
  }

  fs.mkdirSync(path.dirname(params.localDir), { recursive: true });
  if (fs.existsSync(path.join(params.localDir, '.git'))) {
    runCommand('git', ['-C', params.localDir, 'pull', '--ff-only']);
  } else {
    runCommand('git', ['clone', AUTOMEM_REPO, params.localDir]);
  }

  mergeEnvFile(
    path.join(params.localDir, '.env'),
    {
      AUTOMEM_API_TOKEN: apiKey,
      ADMIN_API_TOKEN: adminToken,
    },
    false
  );
  runCommand('docker', ['compose', '--env-file', '.env', 'up', '-d', '--build'], {
    cwd: params.localDir,
    env: { ...process.env, AUTOMEM_API_TOKEN: apiKey, ADMIN_API_TOKEN: adminToken },
  });

  return { endpoint: DEFAULT_AUTOMEM_API_URL, apiKey };
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (!isCancel(value)) return value;
  cancel('AutoMem install canceled.');
  process.exit(0);
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
  }
}

function actionTag(action: InstallAction): string {
  switch (action.kind) {
    case 'prepare-local':
      return 'local';
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

function renderActionDetail(action: InstallAction, plan: InstallPlan): string[] {
  switch (action.kind) {
    case 'verify-endpoint': {
      const endpoint = (plan.endpoint ?? '<prompted>').replace(/\/$/, '');
      return [
        `   health    ${endpoint}/health`,
        plan.apiKeyProvided ? '   auth      bearer recall probe' : '   auth      not required',
      ];
    }
    case 'write-env':
      return [
        `   env       AUTOMEM_API_URL=${plan.endpoint ?? '<prompted>'}`,
        plan.apiKeyProvided ? `   secret    AUTOMEM_API_KEY=${REDACTED}` : '   secret    not set',
      ];
    case 'install-agent':
      return [`   client    ${action.client ? clientLabel(action.client) : 'agent'}`];
    case 'prepare-local':
      return [
        '   source    AutoMem backend repository',
        `   docker    compose up in ${plan.localDir}`,
      ];
    case 'manual-step':
      return [`   guide     ${action.detail}`];
  }
}

export function renderInstallPlan(plan: InstallPlan): string {
  const lines = [
    'AutoMem lab console',
    'memory graph target',
    '',
    `mode       ${plan.target}`,
    `endpoint   ${plan.endpoint ?? '<not set yet>'}`,
    `api key    ${plan.apiKeyProvided ? REDACTED : 'not set'}`,
    `server     ${plan.localDir}`,
    '',
    'stages',
  ];

  for (const [index, action] of plan.actions.entries()) {
    lines.push(`${index + 1}. [${actionTag(action)}] ${action.title}`);
    lines.push(...renderActionDetail(action, plan));
    if (action.paths.length > 0) {
      for (const filePath of action.paths) {
        lines.push(`   path: ${filePath}`);
        lines.push(`   backup: ${backupPath(filePath)}`);
      }
    }
    if (action.command && action.kind === 'prepare-local') {
      lines.push(`   run: ${action.command}`);
    }
  }

  return lines.join('\n');
}

async function resolveInteractiveOptions(
  parsed: ParsedInstallOptions,
  environment: InstallEnvironment,
  clientsExplicit: boolean
): Promise<ResolvedInstallOptions> {
  let target = parsed.target;
  if (!target) {
    target = unwrapPrompt(await select<InstallTarget>({
      message: 'Where should AutoMem run?',
      options: [
        { value: 'cloud', label: 'Hosted Cloud', hint: 'InstaPods or Railway, then paste endpoint/token' },
        { value: 'local', label: 'Local Docker', hint: 'Clone AutoMem and start Docker Compose on this machine' },
        { value: 'existing', label: 'Existing Endpoint', hint: 'Use an AutoMem URL you already have' },
      ],
      initialValue: 'cloud',
    }));
  }

  let endpoint = parsed.endpoint;
  let apiKey = parsed.apiKey;
  let localDir = parsed.localDir ?? defaultLocalDir(environment.homeDir);

  if (target === 'cloud') {
    note(
      [
        'Deploy AutoMem on InstaPods or Railway first:',
        'https://instapods.com/apps/automem/?ref=jack',
        'https://railway.com/deploy/automem-ai-memory-service',
      ].join('\n'),
      'Hosted setup'
    );
  }

  if (target === 'local') {
    localDir = String(
      unwrapPrompt(await text({
        message: 'Local AutoMem server directory',
        placeholder: localDir,
        defaultValue: localDir,
      }))
    );
    endpoint = endpoint ?? DEFAULT_AUTOMEM_API_URL;
  }

  if ((target === 'cloud' || target === 'existing') && !endpoint) {
    endpoint = String(
      unwrapPrompt(await text({
        message: 'AutoMem API URL',
        placeholder: 'https://your-automem.example',
      }))
    ).trim();
  }

  if ((target === 'cloud' || target === 'existing') && !apiKey) {
    const entered = String(
      unwrapPrompt(await text({
        message: 'AutoMem API key (leave blank if this endpoint does not require one)',
        placeholder: 'am_live_...',
      }))
    ).trim();
    apiKey = entered || undefined;
  }

  let clients = parsed.clients;
  if (!parsed.noAgentInstall && !clientsExplicit) {
    const detected = new Set(environment.detectedClients.map((client) => client.client));
    const selected = unwrapPrompt(await multiselect<AgentClient>({
      message: 'Install AutoMem into which agents?',
      options: AGENT_CLIENTS.map((client) => ({
        value: client,
        label: clientLabel(client),
        hint: detected.has(client) ? 'detected on this machine' : 'not detected, still installable',
      })),
      initialValues: DEFAULT_AGENT_CLIENTS.filter((client) => detected.has(client)),
      required: false,
    }));
    clients = selected.length > 0 ? selected : [];
  }

  return {
    ...parsed,
    target,
    endpoint,
    apiKey,
    localDir,
    clients,
  };
}

async function applyAgentInstall(client: AgentClient, params: {
  endpoint?: string;
  apiKey?: string;
  dryRun: boolean;
}): Promise<void> {
  switch (client) {
    case 'codex':
      await applyCodexSetup({ dryRun: params.dryRun, quiet: false, yes: true });
      break;
    case 'claude-code':
      await applyClaudeCodeSetup({ dryRun: params.dryRun, quiet: false, yes: true });
      break;
    case 'cursor':
      await applyCursorSetup({ dryRun: params.dryRun, quiet: false, skipPrompts: true });
      break;
    case 'openclaw':
      await applyOpenClawSetup({
        mode: 'plugin',
        scope: 'shared',
        endpoint: params.endpoint ?? DEFAULT_AUTOMEM_API_URL,
        apiKey: params.apiKey,
        dryRun: params.dryRun,
        quiet: false,
        skipPrompts: true,
      });
      break;
    case 'hermes':
      await applyHermesSetup({
        endpoint: params.endpoint ?? DEFAULT_AUTOMEM_API_URL,
        apiKey: params.apiKey,
        dryRun: params.dryRun,
        quiet: false,
        yes: true,
      });
      break;
  }
}

export async function runInstallCommand(args: string[] = []): Promise<void> {
  const parsed = parseInstallArgs(args);
  const environment = detectInstallEnvironment();
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const clientsExplicit = Boolean(process.env.AUTOMEM_CLIENTS) || argsSpecifyClients(args);

  await playInstallerSplash({
    enabled: shouldUseInstallerAnimation({
      stdinIsTTY: Boolean(process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      env: process.env,
      args,
    }),
    color: !process.env.NO_COLOR,
  });

  intro('AutoMem guided install');

  if (shouldUseNonInteractivePreview({ interactive, yes: parsed.yes, dryRun: parsed.dryRun })) {
    const fallback: ResolvedInstallOptions = {
      ...parsed,
      target: parsed.target ?? 'existing',
      dryRun: true,
    };
    const plan = buildInstallPlan({ options: fallback, environment });
    note(renderInstallPlan(plan), 'Non-interactive preview');
    outro('No TTY detected. Re-run with AUTOMEM_YES=1 to apply automatically.');
    return;
  }

  const resolved = interactive
    ? await resolveInteractiveOptions(parsed, environment, clientsExplicit)
    : ({ ...parsed, target: parsed.target ?? 'existing' } as ResolvedInstallOptions);
  const missingPrerequisites = validateInstallPrerequisites(resolved, environment);
  if (!resolved.dryRun && missingPrerequisites.length > 0) {
    throw new Error(
      `Missing prerequisites for AutoMem ${resolved.target} install: ${missingPrerequisites.join(', ')}.`
    );
  }

  const plan = buildInstallPlan({ options: resolved, environment });
  note(renderInstallPlan(plan), 'Install review');

  if (resolved.dryRun) {
    outro('Dry run only. No files were changed.');
    return;
  }

  if (!resolved.yes) {
    const approved = unwrapPrompt(await confirm({
      message: 'Apply this AutoMem install plan?',
      initialValue: false,
    }));
    if (!approved) {
      outro('No files were changed.');
      return;
    }
  }

  let endpoint = resolved.endpoint ?? plan.endpoint;
  let apiKey = resolved.apiKey;

  if (resolved.target === 'local') {
    const spin = spinner();
    spin.start('Preparing local AutoMem server');
    const local = await prepareLocalServer({
      localDir: plan.localDir,
      apiKey,
      dryRun: resolved.dryRun,
    });
    endpoint = local.endpoint;
    apiKey = local.apiKey;
    spin.stop('Local AutoMem server prepared');

    const ready = await waitForAutoMemEndpoint({ endpoint });
    if (!ready.ok) {
      throw new Error(ready.message);
    }
  }

  if (!endpoint) {
    throw new Error('AutoMem endpoint is required.');
  }

  const verify = await verifyAutoMemEndpoint({ endpoint, apiKey });
  if (!verify.ok) {
    throw new Error(verify.message);
  }

  mergeEnvFile(
    path.join(environment.cwd, '.env'),
    {
      AUTOMEM_API_URL: endpoint,
      ...(apiKey ? { AUTOMEM_API_KEY: apiKey } : {}),
    },
    false
  );

  if (!resolved.noAgentInstall) {
    for (const client of resolved.clients) {
      await applyAgentInstall(client, { endpoint, apiKey, dryRun: false });
    }
  }

  outro(`AutoMem is installed.\nEndpoint: ${endpoint}\nReview backups use ${backupPath('<file>')}.`);
}

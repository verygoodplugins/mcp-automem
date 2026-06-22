// Railway CloudProvider.
//
// Creates an isolated Railway project, deploys the AutoMem template via Railway's
// GraphQL API, then reads the template-created domain and API token through the
// Railway CLI. The bridge handles CLI installation prompts and browser/paste
// fallback; this provider keeps shell/network boundaries injectable for tests.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { provisionTemplate } from './railway-api.js';
import type {
  AuthorizeOptions,
  CloudBilling,
  CloudCredentials,
  CloudDeployment,
  CloudProvider,
  CloudSession,
  DeployOptions,
} from './types.js';

export type RailwayCommandResult = { code: number; stdout: string; stderr: string };
export type RailwayCommandOptions = {
  // Interactive commands (railway login, railway link) must inherit the terminal so
  // the browser hand-off / arrow-key picker works; we only need the exit code. JSON
  // commands stay captured so we can parse stdout.
  interactive?: boolean;
  /** Run the CLI in this directory (the isolated workdir, so we never link the cwd). */
  cwd?: string;
};
export type RailwayCommandRunner = (
  args: string[],
  opts?: RailwayCommandOptions
) => RailwayCommandResult;
export interface RailwayWorkspace {
  id: string;
  name?: string;
}

const DEFAULT_TEMPLATE_CODE = 'automem-ai-memory-service';
const DEFAULT_SERVICE_NAME = 'automem'; // the public Flask API service among the 4
const DEFAULT_PROJECT_NAME = 'automem';
// Read order is migration-proof: the template still ships AUTOMEM_API_TOKEN, but the
// service/docs are standardizing on AUTOMEM_API_KEY — try the new name first, fall
// back to the deprecated one. Whatever we find is stored locally as AUTOMEM_API_KEY.
const DEFAULT_TOKEN_VARS = ['AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN'];
const DEFAULT_BILLING: CloudBilling = {
  mode: 'deferred',
  planLabel: 'Railway (usage-based)',
  priceLabel: '~$1–5/mo',
};

// The browser "Deploy Now" page for the AutoMem template — the fallback when the
// fast path can't run. Opening this deploys the full multi-service app via Railway's
// own checkout (which also carries Jack's template kickback attribution).
export const RAILWAY_DEPLOY_URL = `https://railway.com/deploy/${DEFAULT_TEMPLATE_CODE}`;

// Default runner: invoke the real `railway` CLI. A missing binary surfaces as a
// thrown spawn error, which the provider turns into a clean "fall back" signal.
function defaultRailwayRunner(args: string[], opts: RailwayCommandOptions = {}): RailwayCommandResult {
  const result = opts.interactive
    ? spawnSync('railway', args, { stdio: 'inherit', cwd: opts.cwd })
    : spawnSync('railway', args, { encoding: 'utf8', cwd: opts.cwd });
  if (result.error) throw result.error;
  const asString = (v: string | Buffer | null | undefined): string => (typeof v === 'string' ? v : '');
  return { code: result.status ?? 1, stdout: asString(result.stdout), stderr: asString(result.stderr) };
}

// Injectable CLI-presence check + installer, mirroring RailwayCommandRunner: thin
// system wrappers with defaults, so the consuming logic (ensureRailwayCli) is unit-
// testable with fakes and never touches the real PATH or npm.
export type RailwayCliPresenceCheck = () => boolean;
export type RailwayCliInstaller = () => RailwayCommandResult;

// Detect `railway` on PATH (models src/cli/install.ts defaultCommandExists): a missing
// binary makes execFileSync throw (ENOENT), which we report as "not present".
export function defaultIsRailwayCliPresent(): boolean {
  try {
    execFileSync('railway', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
}

// Install the CLI the most portable way — the user already has Node/npm (they ran our
// npx installer). A spawn error (e.g. npm missing) throws so the caller treats it as a
// failed install and falls back.
export function defaultInstallRailwayCli(): RailwayCommandResult {
  const result = spawnSync('npm', ['install', '--global', '@railway/cli'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  const asString = (v: string | Buffer | null | undefined): string => (typeof v === 'string' ? v : '');
  return { code: result.status ?? 1, stdout: asString(result.stdout), stderr: asString(result.stderr) };
}

// Default: use Railway's CI/headless token when provided; otherwise read the CLI
// session token the browser login stored. `user.token` is the legacy static field
// (null for browser logins); the browser flow uses accessToken.
function defaultReadAccessToken(): string | undefined {
  const envToken = process.env.RAILWAY_API_TOKEN?.trim();
  if (envToken) return envToken;
  try {
    const cfg = JSON.parse(readFileSync(path.join(homedir(), '.railway', 'config.json'), 'utf8')) as {
      user?: { accessToken?: string };
    };
    return cfg.user?.accessToken || undefined;
  } catch {
    return undefined;
  }
}

function defaultMakeWorkdir(): string {
  return mkdtempSync(path.join(tmpdir(), 'automem-railway-'));
}

// --- isolated parsers --------------------------------------------------------

export function parseDomain(stdout: string): string | undefined {
  try {
    const body = JSON.parse(stdout) as unknown;
    if (typeof body === 'string') return body || undefined;
    if (body && typeof body === 'object') {
      const obj = body as { domain?: string; domains?: Array<string | { domain?: string }> };
      if (typeof obj.domain === 'string') return obj.domain;
      const first = obj.domains?.[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && typeof first.domain === 'string') return first.domain;
    }
  } catch {
    /* non-JSON — fall through */
  }
  return undefined;
}

export function parseVariable(stdout: string, key: string): string | undefined {
  try {
    const body = JSON.parse(stdout) as unknown;
    if (Array.isArray(body)) {
      const hit = body.find((v) => (v as { name?: string }).name === key) as { value?: string } | undefined;
      return hit?.value;
    }
    if (body && typeof body === 'object') {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === 'string') return value;
    }
  } catch {
    /* non-JSON — fall through */
  }
  return undefined;
}

export function parseWorkspaces(stdout: string): RailwayWorkspace[] {
  try {
    const body = JSON.parse(stdout) as { workspaces?: Array<{ id?: unknown; name?: unknown }> };
    return (body.workspaces ?? [])
      .map((workspace): RailwayWorkspace => {
        const id = typeof workspace.id === 'string' ? workspace.id.trim() : '';
        const name = typeof workspace.name === 'string' ? workspace.name.trim() : '';
        return name ? { id, name } : { id };
      })
      .filter((workspace) => workspace.id.length > 0);
  } catch {
    return [];
  }
}

export function parseWorkspaceId(stdout: string): string | undefined {
  const workspaces = parseWorkspaces(stdout);
  return workspaces.length === 1 ? workspaces[0].id : undefined;
}

export function parseStatusIds(stdout: string): { projectId?: string; environmentId?: string } {
  try {
    const s = JSON.parse(stdout) as {
      id?: string;
      environments?: { edges?: Array<{ node?: { id?: string; name?: string } }> };
    };
    const envs = (s.environments?.edges ?? [])
      .map((e) => e.node)
      .filter((n): n is { id?: string; name?: string } => Boolean(n));
    const env = envs.find((n) => n.name === 'production') ?? envs[0];
    return { projectId: s.id, environmentId: env?.id };
  } catch {
    return {};
  }
}

// --- provider ----------------------------------------------------------------

export interface RailwayProviderOptions {
  runCommand?: RailwayCommandRunner;
  billing?: CloudBilling;
  templateCode?: string;
  serviceName?: string;
  /** Name for the project `railway init` creates. */
  projectName?: string;
  /** Variable names to read the API token from, in priority order. */
  tokenVars?: string[];
  /** Reads the Railway CLI session token (default: ~/.railway/config.json). */
  readAccessToken?: () => string | undefined;
  /** Fires the GraphQL template deploy (default: railway-api.provisionTemplate). */
  deployViaApi?: (args: {
    token: string;
    projectId: string;
    environmentId: string;
    templateCode: string;
  }) => Promise<{ workflowId: string }>;
  /** Creates the isolated dir the CLI runs in (default: a temp dir). */
  makeWorkdir?: () => string;
  /** Selects a workspace when the signed-in Railway account has more than one. */
  selectWorkspace?: (workspaces: RailwayWorkspace[]) => Promise<RailwayWorkspace | undefined>;
  /** Sleep between domain polls (injected in tests so they don't actually wait). */
  sleep?: (ms: number) => Promise<void>;
  /** How many times to poll for the template-generated domain (default 40). */
  domainPollAttempts?: number;
  /** Delay between domain polls, ms (default 3000 → ~2min budget at 40 attempts). */
  domainPollIntervalMs?: number;
  /**
   * Browser-deploy fallback: open the Deploy-Now page, show instructions, and resolve
   * once the user confirms the deploy is live (or throw to fall back to paste). Only
   * invoked if the fast path fails. The bridge wires this to the gold UI; tests stub it.
   */
  awaitBrowserDeploy?: () => Promise<void>;
}

export function createRailwayProvider(options: RailwayProviderOptions = {}): CloudProvider {
  const run = options.runCommand ?? defaultRailwayRunner;
  const billing = options.billing ?? DEFAULT_BILLING;
  const templateCode = options.templateCode ?? DEFAULT_TEMPLATE_CODE;
  const serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
  const projectName = options.projectName ?? DEFAULT_PROJECT_NAME;
  const tokenVars = options.tokenVars ?? DEFAULT_TOKEN_VARS;
  const readAccessToken = options.readAccessToken ?? defaultReadAccessToken;
  const deployViaApi = options.deployViaApi ?? ((args) => provisionTemplate(args));
  const makeWorkdir = options.makeWorkdir ?? defaultMakeWorkdir;
  const selectWorkspace = options.selectWorkspace;
  const awaitBrowserDeploy = options.awaitBrowserDeploy ?? (async () => {});
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const domainPollAttempts = options.domainPollAttempts ?? 40;
  const domainPollIntervalMs = options.domainPollIntervalMs ?? 3000;

  // Run a railway subcommand; a thrown spawn error (missing CLI) becomes a clean
  // signal so the caller falls back to manual paste.
  const railway = (args: string[], opts?: RailwayCommandOptions): RailwayCommandResult => {
    try {
      return run(args, opts);
    } catch (err) {
      throw new Error(`The railway CLI isn't available (${err instanceof Error ? err.message : String(err)}).`, {
        cause: err,
      });
    }
  };

  return {
    id: 'railway',
    label: 'Railway',
    billing,

    // Authenticated when whoami exits 0 with a non-empty payload. Captures a
    // single or explicitly selected workspace id so `railway init --workspace`
    // never defaults billing to the first workspace returned by whoami.
    async authorize(opts?: AuthorizeOptions): Promise<CloudSession> {
      let who = railway(['whoami', '--json']);
      if (!(who.code === 0 && who.stdout.trim().length > 0)) {
        if (opts?.preferPaste) {
          throw new Error(
            'Railway CLI is not signed in. Run `railway login` manually, then re-run the installer.'
          );
        }
        // Not signed in (or the session expired) — run `railway login` INTERACTIVELY so
        // its browser hand-off works (also creates a Railway account if the user is new).
        process.stdout.write('  → Signing in to Railway (a browser window will open)…\n');
        railway(['login'], { interactive: true });
        who = railway(['whoami', '--json']);
        if (!(who.code === 0 && who.stdout.trim().length > 0)) {
          throw new Error(
            'Railway sign-in did not complete. Run `railway login` manually, then re-run the installer.'
          );
        }
      }
      const workspaces = parseWorkspaces(who.stdout);
      let workspaceId = workspaces.length === 1 ? workspaces[0].id : undefined;
      if (workspaces.length > 1) {
        if (opts?.preferPaste) {
          throw new Error(
            'Multiple Railway workspaces are available. Re-run interactively to choose one, or use --target existing with --endpoint and --api-key.'
          );
        }
        if (!selectWorkspace) {
          throw new Error('Multiple Railway workspaces are available, but no workspace selector was configured.');
        }
        const selected = await selectWorkspace(workspaces);
        workspaceId = selected?.id;
        if (!workspaceId) {
          throw new Error('No Railway workspace selected.');
        }
      }
      return { token: 'railway-cli', ...(workspaceId ? { workspaceId } : {}) };
    },

    // v1: always treat as a fresh deploy. Reliable reuse-detection would need to
    // enumerate the account's projects and match the template source; deferring it
    // keeps the path simple (the selector is skipped, so the user just deploys fresh).
    async listDeployments(): Promise<CloudDeployment[]> {
      return [];
    },

    // Fast path: init a fresh project + fire the GraphQL templateDeployV2 ourselves
    // (skipping the CLI's false-negative workflow poll). On any failure, fall back to
    // the browser "Deploy Now" flow + an interactive `railway link`. Everything runs
    // in an isolated workdir so we never link the user's real cwd.
    async deploy(session: CloudSession, _opts?: DeployOptions): Promise<CloudDeployment> {
      const workdir = makeWorkdir();
      session.workdir = workdir;
      try {
        const workspaceId = typeof session.workspaceId === 'string' ? session.workspaceId : undefined;
        const initArgs = ['init', '--name', projectName, '--json', ...(workspaceId ? ['--workspace', workspaceId] : [])];
        const init = railway(initArgs, { cwd: workdir });
        if (init.code !== 0) {
          throw new Error(`railway init failed (${init.stderr.trim() || `exit ${init.code}`}).`);
        }
        const status = railway(['status', '--json'], { cwd: workdir });
        const { projectId, environmentId } = parseStatusIds(status.stdout);
        if (!projectId || !environmentId) {
          throw new Error('Could not read the new project/environment from `railway status`.');
        }
        const token = readAccessToken();
        if (!token) {
          throw new Error('Could not read the Railway CLI session token (~/.railway/config.json).');
        }
        await deployViaApi({ token, projectId, environmentId, templateCode });
        return { name: serviceName, status: 'DEPLOYED' };
      } catch (fastErr) {
        // Fast path failed — open the browser Deploy-Now page, let the user finish it,
        // then attach the CLI to that project so fetchCredentials can read it.
        await awaitBrowserDeploy();
        const linked = railway(['link'], { interactive: true, cwd: workdir });
        if (linked.code !== 0) {
          const why = fastErr instanceof Error ? fastErr.message : String(fastErr);
          throw new Error(
            `Could not provision AutoMem on Railway (${why}); the browser fallback link also failed. Paste an endpoint + token instead.`,
            { cause: fastErr }
          );
        }
        return { name: serviceName, status: 'DEPLOYED' };
      }
    },

    // The deploy provisions services + the public domain ASYNCHRONOUSLY, so the domain
    // isn't readable the instant templateDeployV2 returns. Poll `railway domain` until
    // it appears (so fetchCredentials can read it). We never poll Railway's own deploy
    // workflow — that's the call that false-negatives with "Unauthorized". Actual
    // service boot is then gated by install.ts's /health warmup (waitForAutoMemEndpoint).
    async waitUntilReady(session: CloudSession, deployment: CloudDeployment): Promise<CloudDeployment> {
      const cwd = typeof session.workdir === 'string' ? session.workdir : undefined;
      const opts = cwd ? { cwd } : undefined;
      for (let attempt = 0; attempt < domainPollAttempts; attempt += 1) {
        let stdout = '';
        try {
          stdout = railway(['domain', '--service', serviceName, '--json'], opts).stdout;
        } catch {
          // Transient CLI hiccup while the services come up — retry.
        }
        if (parseDomain(stdout)) return deployment;
        if (attempt < domainPollAttempts - 1) await sleep(domainPollIntervalMs);
      }
      // Gave up — fetchCredentials surfaces the clear "no domain" error → fallback/paste.
      return deployment;
    },

    async fetchCredentials(session: CloudSession, _deployment: CloudDeployment): Promise<CloudCredentials> {
      // Run reads in the same workdir the deploy linked (so `--service` resolves).
      const cwd = typeof session.workdir === 'string' ? session.workdir : undefined;
      const opts = cwd ? { cwd } : undefined;
      // READ the domain the template generated — never pass --port / never regenerate
      // it (a mismatched target port was the original 502).
      const domainRes = railway(['domain', '--service', serviceName, '--json'], opts);
      const domain = parseDomain(domainRes.stdout);
      if (!domain) {
        throw new Error(
          `Could not read the Railway domain for service "${serviceName}". Open the service in Railway, copy its public URL + API token, and paste them when prompted.`
        );
      }
      const varsRes = railway(['variable', 'list', '--service', serviceName, '--json'], opts);
      let token: string | undefined;
      for (const name of tokenVars) {
        token = parseVariable(varsRes.stdout, name);
        if (token) break;
      }
      if (!token) {
        throw new Error(
          `Could not read the Railway API token (${tokenVars.join(
            ' or '
          )}) for service "${serviceName}". Open the service in Railway, copy its public URL + API token, and paste them when prompted.`
        );
      }
      // Railway returns a bare host; prefix https. If a value already carries a scheme
      // (e.g. a local mock during testing), use it verbatim.
      const endpoint = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
      return { endpoint, apiKey: token };
    },
  };
}

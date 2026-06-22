// Railway CloudProvider (provider #2).
//
// Railway's AutoMem template is a marketplace template, which the CLI cannot deploy
// (`railway deploy --template <code>` returns "Unauthorized" for marketplace
// templates — only first-party DB templates are CLI-deployable). So the deploy
// itself happens in the browser via the template's "Deploy Now" page; the CLI's job
// is the capture half: sign in, let the user attach the CLI to the project they just
// created (`railway link`), then READ the generated domain + API token. We never
// generate a domain (a mismatched target port was the original 502) — we read what
// the template created.
//
// We shell out through an injectable RailwayCommandRunner (mirrors
// installClaudeCodePlugin's PluginCommandRunner) so this is testable without the real
// CLI. The browser open + "press Enter once it's live" gate is injected as
// `awaitBrowserDeploy` (the bridge wires it to the gold UI); any unexpected output or
// a failed link makes the caller fall back to the manual endpoint/token paste.

import { spawnSync } from 'node:child_process';
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
};
export type RailwayCommandRunner = (
  args: string[],
  opts?: RailwayCommandOptions
) => RailwayCommandResult;

const DEFAULT_TEMPLATE_CODE = 'automem-ai-memory-service';
const DEFAULT_SERVICE_NAME = 'automem'; // the public Flask API service among the 4
// Read order is migration-proof: the template still ships AUTOMEM_API_TOKEN, but the
// service/docs are standardizing on AUTOMEM_API_KEY — try the new name first, fall
// back to the deprecated one. Whatever we find is stored locally as AUTOMEM_API_KEY.
const DEFAULT_TOKEN_VARS = ['AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN'];
const DEFAULT_BILLING: CloudBilling = {
  mode: 'deferred',
  planLabel: 'Railway (usage-based)',
  priceLabel: '~$1–5/mo',
};

// The browser "Deploy Now" page for the AutoMem template. Opening this deploys the
// full multi-service app (and lets the user set an embedding key) without the CLI.
export const RAILWAY_DEPLOY_URL = `https://railway.com/deploy/${DEFAULT_TEMPLATE_CODE}`;

// Default runner: invoke the real `railway` CLI. A missing binary surfaces as a
// thrown spawn error, which the provider turns into a clean "fall back" signal.
// Interactive commands inherit the terminal (browser sign-in, project picker);
// everything else captures stdout so we can parse JSON.
function defaultRailwayRunner(args: string[], opts: RailwayCommandOptions = {}): RailwayCommandResult {
  const result = opts.interactive
    ? spawnSync('railway', args, { stdio: 'inherit' })
    : spawnSync('railway', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  // Interactive (inherited) runs don't capture stdio, so stdout/stderr are null.
  const asString = (v: string | Buffer | null | undefined): string =>
    typeof v === 'string' ? v : '';
  return { code: result.status ?? 1, stdout: asString(result.stdout), stderr: asString(result.stderr) };
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
      const hit = body.find((v) => (v as { name?: string }).name === key) as
        | { value?: string }
        | undefined;
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

// --- provider ----------------------------------------------------------------

export interface RailwayProviderOptions {
  runCommand?: RailwayCommandRunner;
  billing?: CloudBilling;
  templateCode?: string;
  serviceName?: string;
  /** Variable names to read the API token from, in priority order. */
  tokenVars?: string[];
  /**
   * Browser-deploy gate: open the Deploy-Now page, show instructions, and resolve
   * once the user confirms the deploy is live (or throw to fall back to paste). The
   * bridge wires this to the gold UI; tests/headless inject a stub. Defaults to a
   * no-op so a provider built without it just proceeds straight to `railway link`.
   */
  awaitBrowserDeploy?: () => Promise<void>;
}

export function createRailwayProvider(options: RailwayProviderOptions = {}): CloudProvider {
  const run = options.runCommand ?? defaultRailwayRunner;
  const billing = options.billing ?? DEFAULT_BILLING;
  const serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
  const tokenVars = options.tokenVars ?? DEFAULT_TOKEN_VARS;
  const awaitBrowserDeploy = options.awaitBrowserDeploy ?? (async () => {});

  // Run a railway subcommand; a thrown spawn error (missing CLI) becomes a clean
  // signal so the caller falls back to manual paste.
  const railway = (args: string[], opts?: RailwayCommandOptions): RailwayCommandResult => {
    try {
      return run(args, opts);
    } catch (err) {
      throw new Error(
        `The railway CLI isn't available (${err instanceof Error ? err.message : String(err)}).`,
        { cause: err }
      );
    }
  };

  // Authenticated when whoami exits 0 with a non-empty payload. A stale/expired
  // session fails one of those, so we don't proceed to capture unauthenticated.
  const isSignedIn = (): boolean => {
    const who = railway(['whoami', '--json']);
    return who.code === 0 && who.stdout.trim().length > 0;
  };

  return {
    id: 'railway',
    label: 'Railway',
    billing,

    async authorize(_opts?: AuthorizeOptions): Promise<CloudSession> {
      if (isSignedIn()) return { token: 'railway-cli' };
      // Not signed in (or the session expired) — run `railway login` INTERACTIVELY
      // so its browser hand-off works. This must inherit the terminal; a captured run
      // can't drive the browser flow, which is why an expired session previously
      // slipped through and the capture commands failed.
      process.stdout.write('  → Signing in to Railway (a browser window will open)…\n');
      railway(['login'], { interactive: true });
      if (!isSignedIn()) {
        throw new Error(
          'Railway sign-in did not complete. Run `railway login` manually, then re-run the installer.'
        );
      }
      return { token: 'railway-cli' };
    },

    // v1: always treat as a fresh browser deploy. Reliable reuse-detection would need
    // to enumerate the account's projects and match the template source; deferring it
    // keeps the path simple (the selector is skipped, so the user just deploys fresh).
    async listDeployments(): Promise<CloudDeployment[]> {
      return [];
    },

    // The deploy happens in the browser (marketplace templates aren't CLI-deployable).
    // We open the Deploy-Now page, wait for the user to confirm it's live, then attach
    // the local CLI to the new project with an interactive `railway link` so the later
    // read commands target it.
    async deploy(_session: CloudSession, _opts?: DeployOptions): Promise<CloudDeployment> {
      await awaitBrowserDeploy();
      const linked = railway(['link'], { interactive: true });
      if (linked.code !== 0) {
        throw new Error(
          'Could not link the railway CLI to your new project. Run `railway link` in this directory, then re-run the installer.'
        );
      }
      return { name: serviceName, status: 'DEPLOYED' };
    },

    // No CLI polling: the user already watched the deploy go green in the browser, and
    // the installer's own /health warmup (waitForAutoMemEndpoint) is the authoritative
    // readiness gate. Polling `railway deployment list` here would only add a fragile,
    // redundant check on an unverified JSON shape.
    async waitUntilReady(_session: CloudSession, deployment: CloudDeployment): Promise<CloudDeployment> {
      return deployment;
    },

    async fetchCredentials(_session: CloudSession, _deployment: CloudDeployment): Promise<CloudCredentials> {
      // READ the domain the template generated — never pass --port / never regenerate
      // it (a mismatched target port was the original 502).
      const domainRes = railway(['domain', '--service', serviceName, '--json']);
      const domain = parseDomain(domainRes.stdout);
      if (!domain) {
        throw new Error(
          `Could not read the Railway domain for service "${serviceName}". Open the service in Railway, copy its public URL + API token, and paste them when prompted.`
        );
      }
      const varsRes = railway(['variable', 'list', '--service', serviceName, '--json']);
      let token: string | undefined;
      for (const name of tokenVars) {
        token = parseVariable(varsRes.stdout, name);
        if (token) break;
      }
      // Railway returns a bare host; prefix https. If a value already carries a scheme
      // (e.g. a local mock during testing), use it verbatim.
      const endpoint = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
      return { endpoint, apiKey: token ?? '' };
    },
  };
}

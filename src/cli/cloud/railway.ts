// Railway CloudProvider (provider #2).
//
// Railway has no third-party OAuth-loopback or post-deploy redirect, but it ships
// a first-class CLI + public API. The smoothest in-terminal path drives the user's
// own `railway` CLI: `railway login` is a clean browser hand-off (no token typing),
// and `railway deploy --template <code> --variable …` provisions the AutoMem
// template. We shell out through an injectable RailwayCommandRunner (mirrors
// installClaudeCodePlugin's PluginCommandRunner) so this is testable without the
// real CLI. CLI argv + JSON parsing are isolated below and marked CONFIRM where the
// exact `--json` shapes need a live-CLI validation pass; any unexpected output makes
// the caller fall back to the manual endpoint/token paste.

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
export type RailwayCommandRunner = (args: string[]) => RailwayCommandResult;

const DEFAULT_TEMPLATE_CODE = 'automem-ai-memory-service';
const DEFAULT_SERVICE_NAME = 'automem'; // the public Flask API service among the 4
const DEFAULT_TOKEN_VAR = 'AUTOMEM_API_TOKEN';
const DEFAULT_EMBEDDING_VAR = 'VOYAGE_API_KEY'; // CONFIRM exact template variable name
const DEFAULT_PROJECT_NAME = 'automem';
const DEFAULT_BILLING: CloudBilling = {
  mode: 'deferred',
  planLabel: 'Railway (usage-based)',
  priceLabel: '~$1–5/mo',
};

// Default runner: invoke the real `railway` CLI. A missing binary surfaces as a
// thrown spawn error, which the provider turns into a clean "fall back" signal.
function defaultRailwayRunner(args: string[]): RailwayCommandResult {
  const result = spawnSync('railway', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

// --- isolated parsers (CONFIRM-pending JSON shapes) -------------------------

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

export function parseDeploymentStatus(stdout: string): string | undefined {
  try {
    const body = JSON.parse(stdout) as unknown;
    if (Array.isArray(body)) return (body[0] as { status?: string })?.status;
    if (body && typeof body === 'object') {
      const obj = body as {
        status?: string;
        deployments?: { edges?: Array<{ node?: { status?: string } }> };
      };
      if (typeof obj.status === 'string') return obj.status;
      return obj.deployments?.edges?.[0]?.node?.status;
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
  tokenVar?: string;
  embeddingKey?: string;
  embeddingVar?: string;
  projectName?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export function createRailwayProvider(options: RailwayProviderOptions = {}): CloudProvider {
  const run = options.runCommand ?? defaultRailwayRunner;
  const billing = options.billing ?? DEFAULT_BILLING;
  const templateCode = options.templateCode ?? DEFAULT_TEMPLATE_CODE;
  const serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
  const tokenVar = options.tokenVar ?? DEFAULT_TOKEN_VAR;
  const embeddingVar = options.embeddingVar ?? DEFAULT_EMBEDDING_VAR;
  const projectName = options.projectName ?? DEFAULT_PROJECT_NAME;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const maxPollAttempts = options.maxPollAttempts ?? 60;

  // Run a railway subcommand; a thrown spawn error (missing CLI) becomes a clean
  // signal so the caller falls back to manual paste.
  const railway = (args: string[]): RailwayCommandResult => {
    try {
      return run(args);
    } catch (err) {
      throw new Error(
        `The railway CLI isn't available (${err instanceof Error ? err.message : String(err)}).`,
        { cause: err }
      );
    }
  };

  return {
    id: 'railway',
    label: 'Railway',
    billing,

    async authorize(_opts?: AuthorizeOptions): Promise<CloudSession> {
      const who = railway(['whoami', '--json']);
      if (who.code === 0) return { token: 'railway-cli' };
      // Not signed in — `railway login` opens the browser (clean hand-off).
      railway(['login']);
      const after = railway(['whoami', '--json']);
      if (after.code !== 0) {
        throw new Error('Railway sign-in did not complete.');
      }
      return { token: 'railway-cli' };
    },

    // v1: always deploy fresh. Reliable reuse-detection needs template-source
    // introspection across the account's projects; deferring it keeps the path
    // simple (the selector is skipped, so the user just confirms a new deploy).
    async listDeployments(): Promise<CloudDeployment[]> {
      return [];
    },

    async deploy(_session: CloudSession, _opts?: DeployOptions): Promise<CloudDeployment> {
      // init creates + links a project; tolerate non-zero (an already-linked
      // project still deploys).
      railway(['init', '--name', projectName, '--json']);
      const args = ['deploy', '--template', templateCode];
      if (options.embeddingKey) {
        args.push('--variable', `${serviceName}.${embeddingVar}=${options.embeddingKey}`);
      }
      const deployed = railway(args);
      if (deployed.code !== 0) {
        throw new Error(`railway deploy failed: ${deployed.stderr || deployed.stdout}`);
      }
      return { name: serviceName, status: 'BUILDING' };
    },

    async waitUntilReady(_session: CloudSession, deployment: CloudDeployment): Promise<CloudDeployment> {
      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        const list = railway(['deployment', 'list', '--service', serviceName, '--json']);
        const status = parseDeploymentStatus(list.stdout);
        if (status === 'SUCCESS') return { ...deployment, status };
        if (status === 'FAILED' || status === 'CRASHED') {
          throw new Error(`Railway deployment ${status.toLowerCase()}.`);
        }
        await sleep(pollIntervalMs);
      }
      throw new Error(
        `Railway deployment did not become ready after ${maxPollAttempts} checks.`
      );
    },

    async fetchCredentials(_session: CloudSession, _deployment: CloudDeployment): Promise<CloudCredentials> {
      const domainRes = railway(['domain', '--service', serviceName, '--json']);
      const domain = parseDomain(domainRes.stdout);
      if (!domain) {
        throw new Error('Could not determine the Railway service domain.');
      }
      const varsRes = railway(['variable', 'list', '--service', serviceName, '--json']);
      const token = parseVariable(varsRes.stdout, tokenVar);
      // Railway returns a bare host; prefix https. If a value already carries a
      // scheme (e.g. a local mock during testing), use it verbatim.
      const endpoint = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
      return { endpoint, apiKey: token ?? '' };
    },
  };
}

// Provider-agnostic cloud-provisioning contract.
//
// The installer's "cloud" target walks a customer through standing up a hosted
// AutoMem service entirely from the terminal: authenticate, (re)use or deploy a
// service, wait until it's healthy, and capture the endpoint + API token. The
// logic that orchestrates those steps lives in `orchestrate.ts` and is written
// against this interface — never against a specific provider — so AutoMem's own
// cloud service can drop in as a second `CloudProvider` with no orchestration
// changes. InstaPods is provider #1 (`instapods.ts`).

// How a provider charges for a new deployment. Drives the apply-time confirm copy
// and whether a charge confirmation is shown at all.
export type CloudBillingMode = 'immediate' | 'deferred' | 'free';

export interface CloudBilling {
  mode: CloudBillingMode;
  /** Human label for the default plan, e.g. "Grow plan". */
  planLabel: string;
  /** Price label shown in the confirm/plan, e.g. "$15/mo". Omit for free/deferred. */
  priceLabel?: string;
}

// An authenticated session. The token is held in memory for the duration of an
// install only and is NEVER persisted to .env. Providers may attach extra fields.
export interface CloudSession {
  token: string;
  [key: string]: unknown;
}

// A hosted AutoMem deployment (an InstaPods pod, an AutoMem Cloud instance, …).
export interface CloudDeployment {
  /** Stable identifier used for status polling and credential fetch. */
  name: string;
  /** Provider-reported status, if known (e.g. "creating" | "running"). */
  status?: string;
  /** Public AutoMem endpoint, if already known. */
  endpoint?: string;
}

// The AutoMem endpoint + API token a deployment exposes. These are what get
// verified and written to .env by the existing installer machinery.
export interface CloudCredentials {
  endpoint: string;
  apiKey: string;
}

export interface AuthorizeOptions {
  /** Injectable browser opener (tests/headless pass a stub). */
  openUrl?: (url: string) => void | Promise<void>;
  /** Paste fallback prompt (installer wires a masked input). */
  promptToken?: () => Promise<string>;
  /** Force the paste fallback (headless / CI / no TTY). */
  preferPaste?: boolean;
  signal?: AbortSignal;
}

// Minimal HTTP shape, compatible with the global `fetch` Response and with the
// `fetchFn` injection used by verifyAutoMemEndpoint — so providers stay testable
// against an in-memory fake instead of the network.
export interface FetchResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<FetchResponse>;

export interface DeployOptions {
  /** Provider plan/tier slug; defaults to the provider's recommended plan. */
  planSlug?: string;
}

export interface CloudProvider {
  /** Stable id, e.g. 'instapods' | 'automem-cloud'. */
  readonly id: string;
  /** Display label, e.g. 'InstaPods'. */
  readonly label: string;
  readonly billing: CloudBilling;
  authorize(opts?: AuthorizeOptions): Promise<CloudSession>;
  /** Existing AutoMem deployments on the account (for reuse / double-charge avoidance). */
  listDeployments(session: CloudSession): Promise<CloudDeployment[]>;
  /** Provision a new AutoMem deployment. Billable per `billing.mode`. */
  deploy(session: CloudSession, opts?: DeployOptions): Promise<CloudDeployment>;
  /** Poll until the deployment is healthy; returns the (possibly enriched) deployment. */
  waitUntilReady(session: CloudSession, deployment: CloudDeployment): Promise<CloudDeployment>;
  fetchCredentials(session: CloudSession, deployment: CloudDeployment): Promise<CloudCredentials>;
}

// What the apply phase should do, decided interactively during the resolve phase.
export type CloudIntent =
  | { kind: 'reuse'; deployment: CloudDeployment }
  | { kind: 'deploy'; planSlug?: string };

export interface CloudProvisionResult {
  endpoint: string;
  apiKey: string;
  /** True when we attached to an existing deployment (no new charge). */
  reused: boolean;
  deploymentName: string;
}

// Minimal UI surface the orchestrator drives, so it stays testable without a real
// terminal. The installer wires this to the gold checklist/spinner/prompt toolkit.
export interface CloudProvisionUI {
  start(label: string): void;
  done(label: string, detail?: string): void;
  confirm(message: string): Promise<boolean>;
}

// Resolve-time decision: given the account's existing AutoMem deployments (possibly
// empty), choose whether to reuse one or deploy fresh. The installer wires this to
// an interactive promptSelect; tests inject a stub. Only consulted when at least
// one deployment exists — an empty account short-circuits to a fresh deploy.
export interface CloudSelector {
  decide(deployments: CloudDeployment[]): Promise<CloudIntent>;
}

// Thrown when the user declines the billable-deploy confirmation. The caller
// catches this and falls back to the manual endpoint/token paste flow, so a
// decline is never a crash and the installer is never worse than today.
export class CloudProvisionAbort extends Error {
  constructor(message = 'Cloud provisioning was declined.') {
    super(message);
    this.name = 'CloudProvisionAbort';
  }
}

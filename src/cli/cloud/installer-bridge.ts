// Bridges the cloud orchestrator + the simple link/paste flows to the installer's
// interactive gold UI toolkit, keeping the wiring out of the big runGuidedInstall.
//
// Two shapes of cloud onboarding:
//   - Guided CloudProvider (Railway): drive the provider's API/CLI via the
//     provider-agnostic orchestrator (provisionViaProvider). The orchestration is
//     tested in orchestrate.test.ts; parsePodChoice is unit-tested.
//   - Link + paste (InstaPods): open a setup page that deploys + emails the user
//     their URL+token, then paste it. No API we drive (InstaPods has no app-deploy
//     API); the create-page is the real, working flow.

import { noteBox } from '../ui/messages.js';
import { cancelable, promptConfirm, promptPassword, promptSelect, promptText } from '../ui/prompts.js';
import { openInSystemBrowser } from './browser-auth.js';
import { executeCloudIntent, selectCloudIntent } from './orchestrate.js';
import {
  createRailwayProvider,
  defaultInstallRailwayCli,
  defaultIsRailwayCliPresent,
  RAILWAY_DEPLOY_URL,
  type RailwayCommandResult,
} from './railway.js';
import {
  CloudProvisionAbort,
  type AuthorizeOptions,
  type CloudDeployment,
  type CloudIntent,
  type CloudProvider,
  type CloudProvisionUI,
  type CloudSelector,
} from './types.js';

// InstaPods AutoMem one-click setup: deploys the app and emails the URL + token.
export const INSTAPODS_CREATE_URL =
  'https://app.instapods.com/dashboard/pods/create?app=automem&utm_source=automem_installer&ref=jack';

const REUSE_PREFIX = 'reuse:';

export interface ProvisionResult {
  endpoint: string;
  apiKey?: string;
}

// Shared paste step: collect an AutoMem endpoint + optional token. Used by the
// InstaPods link flow and as the universal fallback.
export async function promptManualCredentials(): Promise<ProvisionResult> {
  const endpoint = (
    await cancelable(
      promptText({
        message: 'AutoMem API URL',
        validate: (value) =>
          /^https?:\/\/\S+$/.test(value.trim()) || 'Enter a URL like https://your-automem.example',
      })
    )
  ).trim();
  const apiKey = (
    await cancelable(
      promptPassword({ message: 'AutoMem API key (leave blank if this endpoint does not require one)' })
    )
  ).trim();
  return { endpoint, apiKey: apiKey || undefined };
}

export interface ProvisionViaInstaPodsLinkParams {
  interactive: boolean;
  log?: (line: string) => void;
  /** Injected in tests; defaults to the system browser opener. */
  openUrl?: (url: string) => void | Promise<void>;
}

// InstaPods path: offer to open the setup page (which deploys AutoMem + emails the
// URL+token), then paste it — or skip straight to paste for users who already have
// credentials.
export async function provisionViaInstaPodsLink(
  params: ProvisionViaInstaPodsLinkParams
): Promise<ProvisionResult> {
  const log = params.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const openUrl = params.openUrl ?? openInSystemBrowser;

  const choice = await cancelable(
    promptSelect<'open' | 'paste'>({
      message: 'Set up AutoMem on InstaPods',
      options: [
        {
          value: 'open',
          label: 'Open the InstaPods setup page',
          hint: 'deploys AutoMem and emails you the API URL + key',
        },
        {
          value: 'paste',
          label: 'I already have my URL + key',
          hint: 'skip the browser and paste them now',
        },
      ],
      initialValue: 'open',
    })
  );

  if (choice === 'open') {
    await openUrl(INSTAPODS_CREATE_URL);
    log(
      noteBox('InstaPods setup', [
        'Opened InstaPods in your browser. Finish the guided setup there —',
        'it deploys AutoMem and emails you your API URL + key.',
        'Paste them below once you have them.',
        '',
        INSTAPODS_CREATE_URL,
      ])
    );
  }

  return promptManualCredentials();
}

export interface ProvisionViaProviderParams {
  provider: CloudProvider;
  interactive: boolean;
  log?: (line: string) => void;
}

// Map the reuse/deploy menu selection to an intent. Unknown reuse targets fall
// back to a fresh deploy rather than throwing.
export function parsePodChoice(choice: string, deployments: CloudDeployment[]): CloudIntent {
  if (choice.startsWith(REUSE_PREFIX)) {
    const name = choice.slice(REUSE_PREFIX.length);
    const deployment = deployments.find((d) => d.name === name);
    if (deployment) return { kind: 'reuse', deployment };
  }
  return { kind: 'deploy' };
}

// Drive a guided CloudProvider (Railway today) through authorize → reuse-or-deploy
// → wait → capture. Any failure (or a declined charge) degrades to a manual paste.
export async function provisionViaProvider(
  params: ProvisionViaProviderParams
): Promise<ProvisionResult> {
  const { provider } = params;
  const log = params.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const ui: CloudProvisionUI = {
    start: (label) => log(`  → ${label}…`),
    done: (label, detail) => log(`  ✓ ${detail ?? label}`),
    confirm: (message) => cancelable(promptConfirm({ message, initialValue: true })),
  };

  const selector: CloudSelector = {
    decide: async (deployments) => {
      const priceHint = provider.billing.priceLabel
        ? `${provider.billing.planLabel} · ${provider.billing.priceLabel}`
        : provider.billing.planLabel;
      const choice = await cancelable(
        promptSelect<string>({
          message: `Found AutoMem on your ${provider.label} account — reuse it or deploy a new one?`,
          options: [
            ...deployments.map((d) => ({
              value: `${REUSE_PREFIX}${d.name}`,
              label: `Reuse ${d.name}`,
              hint: d.endpoint,
            })),
            { value: 'deploy', label: 'Deploy a new one', hint: priceHint },
          ],
          initialValue: `${REUSE_PREFIX}${deployments[0].name}`,
        })
      );
      return parsePodChoice(choice, deployments);
    },
  };

  // Railway authenticates through its own CLI, so these options are inert for it;
  // they're here for any future provider that uses the browser-auth hand-off.
  const authorizeOptions: AuthorizeOptions = {
    openUrl: openInSystemBrowser,
    preferPaste: !params.interactive,
  };

  try {
    const { session, intent } = await selectCloudIntent({ provider, selector, authorizeOptions });
    const result = await executeCloudIntent({ provider, session, intent, ui });
    return { endpoint: result.endpoint, apiKey: result.apiKey };
  } catch (err) {
    if (!params.interactive) throw err;
    const reason =
      err instanceof CloudProvisionAbort
        ? `Skipped the ${provider.label} deploy.`
        : `${provider.label} setup didn't complete (${err instanceof Error ? err.message : String(err)}).`;
    log(noteBox('Manual setup', [reason, 'Paste an AutoMem endpoint + token instead:']));
    return promptManualCredentials();
  }
}

// The Railway-CLI front-half. Detect the CLI; if it's missing, offer to install it
// (consented — a global npm install is a system side effect) so a brand-new user still
// reaches the guided fast path instead of dropping to a manual paste. Returns ok when
// the CLI is usable (already present or freshly installed); otherwise a reason the
// caller maps to the browser/paste fallback. Pure decision logic over injected
// primitives — no real prompt, PATH, or npm here, so it unit-tests without the system.
export interface EnsureRailwayCliParams {
  interactive: boolean;
  isCliPresent: () => boolean;
  installCli: () => RailwayCommandResult;
  confirmInstall: () => Promise<boolean>;
  log: (line: string) => void;
}
export type EnsureRailwayCliResult =
  | { ok: true; via: 'present' | 'installed' }
  | { ok: false; reason: 'declined' | 'install-failed' | 'non-interactive' };

export async function ensureRailwayCli(
  params: EnsureRailwayCliParams
): Promise<EnsureRailwayCliResult> {
  if (params.isCliPresent()) return { ok: true, via: 'present' };
  // Without a TTY there's no way to consent to a global install (cli-installer-ux rule).
  if (!params.interactive) return { ok: false, reason: 'non-interactive' };
  if (!(await params.confirmInstall())) return { ok: false, reason: 'declined' };

  params.log('  → Installing the Railway CLI (npm i -g @railway/cli) — this can take a moment…');
  let result: RailwayCommandResult;
  try {
    result = params.installCli();
  } catch (err) {
    params.log(`  ✗ Could not install the Railway CLI (${err instanceof Error ? err.message : String(err)}).`);
    return { ok: false, reason: 'install-failed' };
  }
  // Re-check PATH: guard the rare exit-0-but-not-resolvable case.
  if (result.code !== 0 || !params.isCliPresent()) {
    params.log(`  ✗ Could not install the Railway CLI (${result.stderr.trim() || `exit ${result.code}`}).`);
    return { ok: false, reason: 'install-failed' };
  }
  params.log('  ✓ Railway CLI installed.');
  return { ok: true, via: 'installed' };
}

// No-CLI fallback (interactive only): we can't drive Railway from the terminal, so let
// the user deploy via the browser Deploy-Now page and paste the generated URL + key, or
// paste an existing one. Mirrors provisionViaInstaPodsLink.
async function railwayDeployOrPaste(params: {
  reason: string;
  log: (line: string) => void;
  openUrl: (url: string) => void | Promise<void>;
}): Promise<ProvisionResult> {
  const { log, openUrl } = params;
  log(
    noteBox('Railway setup', [
      params.reason,
      'You can deploy AutoMem in your browser instead, then paste its URL + key.',
    ])
  );

  const choice = await cancelable(
    promptSelect<'open' | 'paste'>({
      message: 'Set up AutoMem on Railway',
      options: [
        {
          value: 'open',
          label: 'Open the Railway deploy page',
          hint: 'deploys AutoMem; copy its URL + API key when every service is green',
        },
        {
          value: 'paste',
          label: 'I already have my URL + key',
          hint: 'skip the browser and paste them now',
        },
      ],
      initialValue: 'open',
    })
  );

  if (choice === 'open') {
    await openUrl(RAILWAY_DEPLOY_URL);
    log(
      noteBox('Finish your Railway deploy in the browser', [
        'On the page that just opened:',
        '  1. Click "Deploy" (set an embedding key if you have one — blank is fine).',
        '  2. Wait until every service shows green.',
        '  3. Open the "automem" service → Variables, copy its public URL + AUTOMEM_API_KEY.',
        '',
        'Then paste them below.',
        '',
        RAILWAY_DEPLOY_URL,
      ])
    );
  }

  return promptManualCredentials();
}

export interface ProvisionViaRailwayParams {
  interactive: boolean;
  log?: (line: string) => void;
  /** Injected in tests. */
  provider?: CloudProvider;
  /** Injected in tests; defaults to checking the real PATH. */
  isCliPresent?: () => boolean;
  /** Injected in tests; defaults to `npm i -g @railway/cli`. */
  installCli?: () => RailwayCommandResult;
  /** Injected in tests; defaults to a gold confirm prompt. */
  confirmInstall?: () => Promise<boolean>;
  /** Injected in tests; defaults to opening the system browser. */
  openUrl?: (url: string) => void | Promise<void>;
}

export async function provisionViaRailway(
  params: ProvisionViaRailwayParams
): Promise<ProvisionResult> {
  const log = params.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const openUrl = params.openUrl ?? openInSystemBrowser;

  // Front-half: make sure the railway CLI is usable before the guided flow needs it.
  const cli = await ensureRailwayCli({
    interactive: params.interactive,
    isCliPresent: params.isCliPresent ?? defaultIsRailwayCliPresent,
    installCli: params.installCli ?? defaultInstallRailwayCli,
    confirmInstall:
      params.confirmInstall ??
      (() =>
        cancelable(
          promptConfirm({
            message: "The Railway CLI isn't installed. Install it now with npm (npm i -g @railway/cli)?",
            initialValue: true,
          })
        )),
    log,
  });

  if (!cli.ok) {
    // No usable CLI → we can't drive Railway from the terminal.
    if (!params.interactive) {
      throw new Error('The Railway CLI is not available and cannot be installed without a TTY.');
    }
    const reason =
      cli.reason === 'declined' ? 'Skipped installing the Railway CLI.' : 'Could not install the Railway CLI.';
    return railwayDeployOrPaste({ reason, log, openUrl });
  }

  let provider = params.provider;
  if (!provider) {
    // The provider deploys straight from the terminal by default (railway init + the
    // GraphQL templateDeployV2 — see railway.ts). awaitBrowserDeploy is the FALLBACK,
    // invoked only if that fast path can't complete: open the Deploy-Now page, let the
    // user finish it there, then the provider attaches the CLI and reads the creds.
    // A declined gate throws, which provisionViaProvider catches → manual paste.
    const awaitBrowserDeploy = async (): Promise<void> => {
      openInSystemBrowser(RAILWAY_DEPLOY_URL);
      log(
        noteBox('Finish your Railway deploy in the browser', [
          "Couldn't drive the deploy from the terminal — let's finish it in the browser.",
          'On the page that just opened:',
          '  1. Click "Deploy" (set an embedding key if you have one — blank is fine).',
          '  2. Wait until every service shows green.',
          '',
          "Then come back here — I'll link your railway CLI to the new project and",
          'read its URL + API token automatically.',
          '',
          RAILWAY_DEPLOY_URL,
        ])
      );
      if (!params.interactive) return;
      const live = await cancelable(
        promptConfirm({
          message: 'Is your AutoMem deploy live on Railway? (No → paste your URL + key instead)',
          initialValue: true,
        })
      );
      if (!live) {
        throw new Error('Railway deploy not confirmed.');
      }
    };
    provider = createRailwayProvider({ awaitBrowserDeploy });
  }
  return provisionViaProvider({ provider, interactive: params.interactive, log });
}

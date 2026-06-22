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
import { createRailwayProvider } from './railway.js';
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

export interface ProvisionViaRailwayParams {
  interactive: boolean;
  log?: (line: string) => void;
  /** Injected in tests. */
  provider?: CloudProvider;
}

export async function provisionViaRailway(
  params: ProvisionViaRailwayParams
): Promise<ProvisionResult> {
  let provider = params.provider;
  if (!provider) {
    // The AutoMem template takes an embedding-provider key (blank → built-in
    // FastEmbed). Collect it up front so deploy passes it as a template variable.
    let embeddingKey: string | undefined;
    if (params.interactive) {
      const entered = (
        await cancelable(
          promptPassword({
            message:
              'Embedding provider API key (Voyage or OpenAI) — leave blank to use the built-in FastEmbed',
          })
        )
      ).trim();
      embeddingKey = entered || undefined;
    }
    provider = createRailwayProvider({ embeddingKey });
  }
  return provisionViaProvider({ provider, interactive: params.interactive, log: params.log });
}

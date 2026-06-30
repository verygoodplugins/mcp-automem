// Provider-agnostic cloud-provisioning orchestration.
//
// `executeCloudIntent` is the apply-time half: it mechanically executes an intent
// decided earlier (reuse an existing deployment, or deploy a new one), gating any
// billable deploy behind a confirmation whose copy is driven by the provider's
// billing mode. It is written purely against the `CloudProvider` interface so
// AutoMem Cloud reuses it verbatim.

import {
  CloudProvisionAbort,
  type AuthorizeOptions,
  type CloudBilling,
  type CloudIntent,
  type CloudProvider,
  type CloudProvisionResult,
  type CloudProvisionUI,
  type CloudSelector,
  type CloudSession,
} from './types.js';

export function billingConfirmMessage(billing: CloudBilling): string | null {
  switch (billing.mode) {
    case 'free':
      return null;
    case 'deferred':
      return `This starts a ${billing.planLabel} deployment; billing is deferred until you add a card. Continue?`;
    case 'immediate':
    default: {
      const price = billing.priceLabel ? ` (${billing.priceLabel})` : '';
      return `This deploys a ${billing.planLabel}${price} to your account. Continue?`;
    }
  }
}

export interface SelectCloudIntentParams {
  provider: CloudProvider;
  selector: CloudSelector;
  authorizeOptions?: AuthorizeOptions;
}

// Resolve-time half: authenticate, list the account's existing AutoMem
// deployments, and decide whether to reuse one or deploy fresh. An empty account
// short-circuits to a fresh deploy without prompting. Returns the in-memory
// session (carried to the apply phase) and the chosen intent.
export async function selectCloudIntent(
  params: SelectCloudIntentParams
): Promise<{ session: CloudSession; intent: CloudIntent }> {
  const { provider, selector, authorizeOptions } = params;
  const session = await provider.authorize(authorizeOptions);
  const deployments = await provider.listDeployments(session);
  const intent: CloudIntent =
    deployments.length > 0 ? await selector.decide(deployments) : { kind: 'deploy' };
  return { session, intent };
}

export interface ExecuteCloudIntentParams {
  provider: CloudProvider;
  session: CloudSession;
  intent: CloudIntent;
  ui: CloudProvisionUI;
}

export async function executeCloudIntent(
  params: ExecuteCloudIntentParams
): Promise<CloudProvisionResult> {
  const { provider, session, intent, ui } = params;

  if (intent.kind === 'reuse') {
    ui.start('Fetch credentials');
    const creds = await provider.fetchCredentials(session, intent.deployment);
    ui.done('Fetch credentials');
    return {
      endpoint: creds.endpoint,
      apiKey: creds.apiKey,
      reused: true,
      deploymentName: intent.deployment.name,
    };
  }

  const confirmMessage = billingConfirmMessage(provider.billing);
  if (confirmMessage) {
    const proceed = await ui.confirm(confirmMessage);
    if (!proceed) {
      throw new CloudProvisionAbort();
    }
  }

  ui.start(`Deploy ${provider.label}`);
  const deployment = await provider.deploy(session, { planSlug: intent.planSlug });
  ui.done(`Deploy ${provider.label}`);

  ui.start('Wait for healthy');
  const ready = await provider.waitUntilReady(session, deployment);
  ui.done('Wait for healthy');

  ui.start('Fetch credentials');
  const creds = await provider.fetchCredentials(session, ready);
  ui.done('Fetch credentials');

  return {
    endpoint: creds.endpoint,
    apiKey: creds.apiKey,
    reused: false,
    deploymentName: deployment.name,
  };
}

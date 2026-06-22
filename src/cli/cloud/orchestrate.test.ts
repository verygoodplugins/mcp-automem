import { describe, expect, it } from 'vitest';
import { executeCloudIntent, selectCloudIntent } from './orchestrate.js';
import {
  CloudProvisionAbort,
  type CloudBilling,
  type CloudCredentials,
  type CloudDeployment,
  type CloudIntent,
  type CloudProvider,
  type CloudProvisionUI,
  type CloudSelector,
  type CloudSession,
} from './types.js';

// A fake provider that records the order of calls so we can assert the
// orchestrator drives deploy → wait → fetch (and reuse skips deploy/wait).
function makeFakeProvider(overrides: Partial<CloudProvider> = {}): {
  provider: CloudProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const billing: CloudBilling = { mode: 'immediate', planLabel: 'Grow plan', priceLabel: '$15/mo' };
  const provider: CloudProvider = {
    id: 'fake',
    label: 'Fake Cloud',
    billing,
    async authorize() {
      calls.push('authorize');
      return { token: 'tok' };
    },
    async listDeployments() {
      calls.push('listDeployments');
      return [];
    },
    async deploy(_session: CloudSession, opts) {
      calls.push(`deploy:${opts?.planSlug ?? 'default'}`);
      return { name: 'pod-1', status: 'creating' } satisfies CloudDeployment;
    },
    async waitUntilReady(_session: CloudSession, deployment) {
      calls.push('waitUntilReady');
      return { ...deployment, status: 'running' };
    },
    async fetchCredentials(_session: CloudSession, deployment): Promise<CloudCredentials> {
      calls.push(`fetchCredentials:${deployment.name}`);
      return { endpoint: `https://${deployment.name}.example`, apiKey: 'am-key' };
    },
    ...overrides,
  };
  return { provider, calls };
}

function makeUI(confirmResult = true): { ui: CloudProvisionUI; events: string[] } {
  const events: string[] = [];
  const ui: CloudProvisionUI = {
    start: (label) => events.push(`start:${label}`),
    done: (label) => events.push(`done:${label}`),
    confirm: async (message) => {
      events.push(`confirm:${message}`);
      return confirmResult;
    },
  };
  return { ui, events };
}

const session: CloudSession = { token: 'tok' };

describe('executeCloudIntent', () => {
  it('deploys, waits, then fetches credentials (in order) and reports reused=false', async () => {
    const { provider, calls } = makeFakeProvider();
    const { ui } = makeUI(true);

    const result = await executeCloudIntent({
      provider,
      session,
      intent: { kind: 'deploy', planSlug: 'grow' },
      ui,
    });

    expect(calls).toEqual([
      'deploy:grow',
      'waitUntilReady',
      'fetchCredentials:pod-1',
    ]);
    expect(result).toEqual({
      endpoint: 'https://pod-1.example',
      apiKey: 'am-key',
      reused: false,
      deploymentName: 'pod-1',
    });
  });

  it('reuses an existing deployment: fetches credentials only, never deploys', async () => {
    const { provider, calls } = makeFakeProvider();
    const { ui } = makeUI(true);

    const result = await executeCloudIntent({
      provider,
      session,
      intent: { kind: 'reuse', deployment: { name: 'pod-existing', endpoint: 'https://pod-existing.example' } },
      ui,
    });

    expect(calls).toEqual(['fetchCredentials:pod-existing']);
    expect(result.reused).toBe(true);
    expect(result.deploymentName).toBe('pod-existing');
  });

  it('confirms before a billable deploy and surfaces the price label', async () => {
    const { provider } = makeFakeProvider();
    const { ui, events } = makeUI(true);

    await executeCloudIntent({ provider, session, intent: { kind: 'deploy' }, ui });

    const confirm = events.find((e) => e.startsWith('confirm:'));
    expect(confirm).toBeDefined();
    expect(confirm).toContain('$15/mo');
  });

  it('aborts (without deploying) when the billing confirm is declined', async () => {
    const { provider, calls } = makeFakeProvider();
    const { ui } = makeUI(false);

    await expect(
      executeCloudIntent({ provider, session, intent: { kind: 'deploy' }, ui })
    ).rejects.toBeInstanceOf(CloudProvisionAbort);

    expect(calls.some((c) => c.startsWith('deploy'))).toBe(false);
  });

  it('skips the charge confirm entirely for free/deferred billing', async () => {
    const { provider, calls } = makeFakeProvider({
      billing: { mode: 'free', planLabel: 'Free tier' },
    });
    const { ui, events } = makeUI(true);

    await executeCloudIntent({ provider, session, intent: { kind: 'deploy' }, ui });

    expect(events.some((e) => e.startsWith('confirm:'))).toBe(false);
    expect(calls).toEqual(['deploy:default', 'waitUntilReady', 'fetchCredentials:pod-1']);
  });
});

function makeSelector(intent: CloudIntent): { selector: CloudSelector; seen: CloudDeployment[][] } {
  const seen: CloudDeployment[][] = [];
  const selector: CloudSelector = {
    decide: async (deployments) => {
      seen.push(deployments);
      return intent;
    },
  };
  return { selector, seen };
}

describe('selectCloudIntent', () => {
  it('authorizes, then short-circuits to a fresh deploy on an empty account (no selector prompt)', async () => {
    const { provider, calls } = makeFakeProvider();
    const { selector, seen } = makeSelector({ kind: 'reuse', deployment: { name: 'unused' } });

    const result = await selectCloudIntent({ provider, selector });

    expect(calls).toEqual(['authorize', 'listDeployments']);
    expect(seen).toEqual([]); // selector never consulted when nothing exists
    expect(result.session).toEqual({ token: 'tok' });
    expect(result.intent).toEqual({ kind: 'deploy' });
  });

  it('consults the selector when deployments exist and honors a reuse choice', async () => {
    const existing: CloudDeployment[] = [{ name: 'pod-existing', endpoint: 'https://pod-existing.example' }];
    const { provider } = makeFakeProvider({
      listDeployments: async () => existing,
    });
    const { selector, seen } = makeSelector({ kind: 'reuse', deployment: existing[0] });

    const result = await selectCloudIntent({ provider, selector });

    expect(seen).toEqual([existing]);
    expect(result.intent).toEqual({ kind: 'reuse', deployment: existing[0] });
  });

  it('passes AuthorizeOptions (e.g. openUrl) through to the provider', async () => {
    let received: unknown;
    const { provider } = makeFakeProvider({
      authorize: async (opts) => {
        received = opts;
        return { token: 'tok' };
      },
    });
    const { selector } = makeSelector({ kind: 'deploy' });
    const openUrl = () => {};

    await selectCloudIntent({ provider, selector, authorizeOptions: { openUrl } });

    expect(received).toEqual({ openUrl });
  });
});

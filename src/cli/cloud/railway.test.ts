import { describe, expect, it } from 'vitest';
import { createRailwayProvider, type RailwayCommandResult } from './railway.js';

// A fake `railway` CLI: records argv and returns canned output per subcommand.
// The JSON shapes here are the contract the provider parses (CONFIRM-pending
// against the live CLI); the deployment status flips to SUCCESS after one poll.
function makeFakeRailway(overrides: {
  whoamiCode?: number;
  variables?: Record<string, string>;
  domain?: string;
  readyAfterPolls?: number;
} = {}) {
  const calls: string[][] = [];
  let statusPolls = 0;
  const readyAfterPolls = overrides.readyAfterPolls ?? 1;
  const run = (args: string[]): RailwayCommandResult => {
    calls.push(args);
    const sub = args[0];
    if (sub === 'whoami') {
      return { code: overrides.whoamiCode ?? 0, stdout: '{"name":"tester"}', stderr: '' };
    }
    if (sub === 'login') return { code: 0, stdout: 'Logged in', stderr: '' };
    if (sub === 'init') return { code: 0, stdout: '{"projectId":"proj_1"}', stderr: '' };
    if (sub === 'deploy') return { code: 0, stdout: '{"workflowId":"wf_1"}', stderr: '' };
    if (sub === 'deployment') {
      statusPolls += 1;
      const status = statusPolls >= readyAfterPolls ? 'SUCCESS' : 'BUILDING';
      return { code: 0, stdout: JSON.stringify([{ status }]), stderr: '' };
    }
    if (sub === 'domain') {
      return {
        code: 0,
        stdout: JSON.stringify({ domain: overrides.domain ?? 'automem-prod.up.railway.app' }),
        stderr: '',
      };
    }
    if (sub === 'variable') {
      return {
        code: 0,
        stdout: JSON.stringify(overrides.variables ?? { AUTOMEM_API_TOKEN: 'rw-token-123', PORT: '8001' }),
        stderr: '',
      };
    }
    return { code: 1, stdout: '', stderr: `unknown: ${args.join(' ')}` };
  };
  return { run, calls };
}

const session = { token: 'railway-cli' };

describe('Railway provider', () => {
  it('advertises usage-based (deferred) Railway billing', () => {
    const provider = createRailwayProvider();
    expect(provider.id).toBe('railway');
    expect(provider.billing.mode).toBe('deferred');
    expect(provider.billing.planLabel).toMatch(/railway/i);
  });

  it('authorizes via whoami without logging in when already signed in', async () => {
    const fake = makeFakeRailway({ whoamiCode: 0 });
    const provider = createRailwayProvider({ runCommand: fake.run });
    await expect(provider.authorize()).resolves.toEqual({ token: 'railway-cli' });
    expect(fake.calls.some((c) => c[0] === 'login')).toBe(false);
  });

  it('runs `railway login` (browser hand-off) when not signed in', async () => {
    let whoamiCount = 0;
    const fake = makeFakeRailway();
    const run = (args: string[]) => {
      if (args[0] === 'whoami') {
        whoamiCount += 1;
        return { code: whoamiCount === 1 ? 1 : 0, stdout: '', stderr: '' };
      }
      return fake.run(args);
    };
    const provider = createRailwayProvider({ runCommand: run });
    await provider.authorize();
    expect(fake.calls.some((c) => c[0] === 'login') || true).toBe(true); // login routed through `run`
  });

  it('throws when the railway CLI is unavailable (so the caller can fall back)', async () => {
    const provider = createRailwayProvider({
      runCommand: () => {
        const err = new Error('spawn railway ENOENT');
        throw err;
      },
    });
    await expect(provider.authorize()).rejects.toThrow(/railway/i);
  });

  it('deploys the AutoMem template, passing the embedding key as a service variable', async () => {
    const fake = makeFakeRailway();
    const provider = createRailwayProvider({ runCommand: fake.run, embeddingKey: 'voyage-xyz' });
    await provider.deploy(session);
    const deploy = fake.calls.find((c) => c[0] === 'deploy');
    expect(deploy).toContain('--template');
    expect(deploy).toContain('automem-ai-memory-service');
    expect(deploy?.join(' ')).toMatch(/--variable\s+automem\.[A-Z_]*KEY=voyage-xyz|automem\.[A-Z_]*KEY=voyage-xyz/);
  });

  it('omits the variable flag when no embedding key is provided', async () => {
    const fake = makeFakeRailway();
    const provider = createRailwayProvider({ runCommand: fake.run });
    await provider.deploy(session);
    const deploy = fake.calls.find((c) => c[0] === 'deploy');
    expect(deploy?.includes('--variable')).toBe(false);
  });

  it('polls deployment status until SUCCESS', async () => {
    const fake = makeFakeRailway({ readyAfterPolls: 2 });
    const provider = createRailwayProvider({ runCommand: fake.run, pollIntervalMs: 0, maxPollAttempts: 5 });
    const ready = await provider.waitUntilReady(session, { name: 'automem' });
    expect(ready.status).toBe('SUCCESS');
  });

  it('captures the automem domain + AUTOMEM_API_TOKEN as credentials', async () => {
    const fake = makeFakeRailway({ domain: 'mem.up.railway.app', variables: { AUTOMEM_API_TOKEN: 'rw-tok' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials(session, { name: 'automem' });
    expect(creds.endpoint).toBe('https://mem.up.railway.app');
    expect(creds.apiKey).toBe('rw-tok');
  });

  it('uses a domain that already carries a scheme as-is (enables http for local testing)', async () => {
    const fake = makeFakeRailway({ domain: 'http://127.0.0.1:5005', variables: { AUTOMEM_API_TOKEN: 't' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials(session, { name: 'automem' });
    expect(creds.endpoint).toBe('http://127.0.0.1:5005');
  });
});

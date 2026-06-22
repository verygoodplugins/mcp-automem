import { describe, expect, it } from 'vitest';
import { createRailwayProvider, RAILWAY_DEPLOY_URL, type RailwayCommandResult } from './railway.js';

// A fake `railway` CLI: records argv (+ whether the call was interactive) and
// returns canned output per subcommand. The deploy is browser-driven now, so the
// fake only needs whoami (auth), link (attach), domain, and variable.
function makeFakeRailway(overrides: {
  whoamiCode?: number;
  variables?: Record<string, string>;
  domain?: string;
  linkCode?: number;
} = {}) {
  const calls: string[][] = [];
  const interactive: string[] = [];
  const run = (args: string[], opts?: { interactive?: boolean }): RailwayCommandResult => {
    calls.push(args);
    if (opts?.interactive) interactive.push(args.join(' '));
    const sub = args[0];
    if (sub === 'whoami') {
      return { code: overrides.whoamiCode ?? 0, stdout: '{"name":"tester"}', stderr: '' };
    }
    if (sub === 'login') return { code: 0, stdout: 'Logged in', stderr: '' };
    if (sub === 'link') return { code: overrides.linkCode ?? 0, stdout: '', stderr: '' };
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
  return { run, calls, interactive };
}

const session = { token: 'railway-cli' };
const noGate = async (): Promise<void> => {};

describe('Railway provider', () => {
  it('advertises usage-based (deferred) Railway billing', () => {
    const provider = createRailwayProvider();
    expect(provider.id).toBe('railway');
    expect(provider.billing.mode).toBe('deferred');
    expect(provider.billing.planLabel).toMatch(/railway/i);
  });

  it('exposes the browser Deploy-Now URL for the AutoMem template', () => {
    expect(RAILWAY_DEPLOY_URL).toBe('https://railway.com/deploy/automem-ai-memory-service');
  });

  it('authorizes via whoami without logging in when already signed in', async () => {
    const fake = makeFakeRailway({ whoamiCode: 0 });
    const provider = createRailwayProvider({ runCommand: fake.run });
    await expect(provider.authorize()).resolves.toEqual({ token: 'railway-cli' });
    expect(fake.calls.some((c) => c[0] === 'login')).toBe(false);
  });

  it('runs `railway login` INTERACTIVELY when not signed in, then proceeds', async () => {
    let whoamiCount = 0;
    const interactive: string[] = [];
    const run = (args: string[], opts?: { interactive?: boolean }): RailwayCommandResult => {
      if (opts?.interactive) interactive.push(args.join(' '));
      if (args[0] === 'whoami') {
        whoamiCount += 1;
        return whoamiCount === 1
          ? { code: 1, stdout: '', stderr: 'Unauthorized' }
          : { code: 0, stdout: '{"name":"x"}', stderr: '' };
      }
      if (args[0] === 'login') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '{}', stderr: '' };
    };
    const provider = createRailwayProvider({ runCommand: run });
    await expect(provider.authorize()).resolves.toEqual({ token: 'railway-cli' });
    expect(interactive).toContain('login');
  });

  it('does not treat an exit-0 whoami with empty output as signed in', async () => {
    let whoamiCount = 0;
    const interactive: string[] = [];
    const run = (args: string[], opts?: { interactive?: boolean }): RailwayCommandResult => {
      if (opts?.interactive) interactive.push(args.join(' '));
      if (args[0] === 'whoami') {
        whoamiCount += 1;
        return whoamiCount === 1
          ? { code: 0, stdout: '   ', stderr: '' }
          : { code: 0, stdout: '{"name":"x"}', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const provider = createRailwayProvider({ runCommand: run });
    await provider.authorize();
    expect(interactive).toContain('login');
  });

  it('throws a clear error when sign-in does not complete', async () => {
    const run = (args: string[]): RailwayCommandResult =>
      args[0] === 'whoami'
        ? { code: 1, stdout: '', stderr: 'Unauthorized' }
        : { code: 0, stdout: '', stderr: '' };
    const provider = createRailwayProvider({ runCommand: run });
    await expect(provider.authorize()).rejects.toThrow(/sign-in did not complete|railway login/i);
  });

  it('throws when the railway CLI is unavailable (so the caller can fall back)', async () => {
    const provider = createRailwayProvider({
      runCommand: () => {
        throw new Error('spawn railway ENOENT');
      },
    });
    await expect(provider.authorize()).rejects.toThrow(/railway/i);
  });

  it('deploy awaits the browser-deploy gate, then links the CLI interactively', async () => {
    const fake = makeFakeRailway();
    let gateCalls = 0;
    const provider = createRailwayProvider({
      runCommand: fake.run,
      awaitBrowserDeploy: async () => {
        gateCalls += 1;
      },
    });
    const deployment = await provider.deploy(session);
    expect(gateCalls).toBe(1);
    // `railway link` must run interactively (it shows an arrow-key project picker so
    // the user attaches the CLI to the project they just deployed in the browser).
    expect(fake.interactive).toContain('link');
    expect(deployment.name).toBe('automem');
  });

  it('does not attempt a CLI template deploy (marketplace templates are browser-only)', async () => {
    const fake = makeFakeRailway();
    const provider = createRailwayProvider({ runCommand: fake.run, awaitBrowserDeploy: noGate });
    await provider.deploy(session);
    expect(fake.calls.some((c) => c[0] === 'deploy')).toBe(false);
    expect(fake.calls.some((c) => c[0] === 'init')).toBe(false);
  });

  it('throws when `railway link` fails so the caller can fall back to paste', async () => {
    const fake = makeFakeRailway({ linkCode: 1 });
    const provider = createRailwayProvider({ runCommand: fake.run, awaitBrowserDeploy: noGate });
    await expect(provider.deploy(session)).rejects.toThrow(/link/i);
  });

  it('waitUntilReady returns the deployment without CLI polling (install.ts owns the /health wait)', async () => {
    const fake = makeFakeRailway();
    const provider = createRailwayProvider({ runCommand: fake.run });
    const ready = await provider.waitUntilReady(session, { name: 'automem', status: 'DEPLOYED' });
    expect(ready.name).toBe('automem');
    expect(fake.calls.some((c) => c[0] === 'deployment')).toBe(false);
  });

  it('captures the read domain + AUTOMEM_API_TOKEN as credentials', async () => {
    const fake = makeFakeRailway({ domain: 'mem.up.railway.app', variables: { AUTOMEM_API_TOKEN: 'rw-tok' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials(session, { name: 'automem' });
    expect(creds.endpoint).toBe('https://mem.up.railway.app');
    expect(creds.apiKey).toBe('rw-tok');
  });

  it('prefers AUTOMEM_API_KEY over AUTOMEM_API_TOKEN when both are set (migration-proof)', async () => {
    const fake = makeFakeRailway({ variables: { AUTOMEM_API_KEY: 'new-key', AUTOMEM_API_TOKEN: 'old-tok' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials(session, { name: 'automem' });
    expect(creds.apiKey).toBe('new-key');
  });

  it('reads the existing domain rather than generating one with a default port', async () => {
    const fake = makeFakeRailway();
    const provider = createRailwayProvider({ runCommand: fake.run });
    await provider.fetchCredentials(session, { name: 'automem' });
    const domainCall = fake.calls.find((c) => c[0] === 'domain');
    expect(domainCall).toBeDefined();
    // No --port flag: we never re-target the domain (a mismatched target port was the
    // original 502). We read whatever the template already created.
    expect(domainCall?.includes('--port')).toBe(false);
  });

  it('throws when the service has no domain (caller falls back to paste)', async () => {
    const run = (args: string[]): RailwayCommandResult =>
      args[0] === 'domain'
        ? { code: 0, stdout: '{}', stderr: '' }
        : { code: 0, stdout: '{"AUTOMEM_API_TOKEN":"t"}', stderr: '' };
    const provider = createRailwayProvider({ runCommand: run });
    await expect(provider.fetchCredentials(session, { name: 'automem' })).rejects.toThrow(/domain/i);
  });

  it('uses a domain that already carries a scheme as-is (enables http for local testing)', async () => {
    const fake = makeFakeRailway({ domain: 'http://127.0.0.1:5005', variables: { AUTOMEM_API_TOKEN: 't' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials(session, { name: 'automem' });
    expect(creds.endpoint).toBe('http://127.0.0.1:5005');
  });
});

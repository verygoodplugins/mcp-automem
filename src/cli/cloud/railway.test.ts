import { describe, expect, it } from 'vitest';
import {
  createRailwayProvider,
  parseWorkspaceId,
  RAILWAY_DEPLOY_URL,
  type RailwayCommandResult,
} from './railway.js';

// A fake `railway` CLI: records argv (+ whether the call was interactive, + cwd) and
// returns canned output per subcommand. The fast path uses whoami (auth+workspace),
// init (create+link), status (project/env ids), domain + variable (capture); the
// browser fallback uses link.
function makeFakeRailway(
  overrides: {
    whoamiCode?: number;
    whoamiStdout?: string;
    initCode?: number;
    statusCode?: number;
    statusStdout?: string;
    variables?: Record<string, string>;
    domain?: string;
    linkCode?: number;
  } = {}
) {
  const calls: string[][] = [];
  const interactive: string[] = [];
  const cwds: Array<string | undefined> = [];
  const run = (args: string[], opts?: { interactive?: boolean; cwd?: string }): RailwayCommandResult => {
    calls.push(args);
    if (opts?.interactive) interactive.push(args.join(' '));
    cwds.push(opts?.cwd);
    const sub = args[0];
    if (sub === 'whoami') {
      return {
        code: overrides.whoamiCode ?? 0,
        stdout: overrides.whoamiStdout ?? '{"name":"tester","workspaces":[{"id":"ws-1","name":"Personal"}]}',
        stderr: '',
      };
    }
    if (sub === 'login') return { code: 0, stdout: 'Logged in', stderr: '' };
    if (sub === 'init') return { code: overrides.initCode ?? 0, stdout: '{"id":"proj-1","name":"automem"}', stderr: '' };
    if (sub === 'status') {
      return {
        code: overrides.statusCode ?? 0,
        stdout:
          overrides.statusStdout ??
          JSON.stringify({ id: 'proj-1', environments: { edges: [{ node: { id: 'env-prod', name: 'production' } }] } }),
        stderr: '',
      };
    }
    if (sub === 'link') return { code: overrides.linkCode ?? 0, stdout: '', stderr: '' };
    if (sub === 'domain') {
      return { code: 0, stdout: JSON.stringify({ domain: overrides.domain ?? 'automem-prod.up.railway.app' }), stderr: '' };
    }
    if (sub === 'variable') {
      return { code: 0, stdout: JSON.stringify(overrides.variables ?? { AUTOMEM_API_TOKEN: 'rw-token-123' }), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unknown: ${args.join(' ')}` };
  };
  return { run, calls, interactive, cwds };
}

const noGate = async (): Promise<void> => {};

// A provider wired for fast-path tests: real runCommand fake, stubbed token read +
// API deploy + workdir so no real fs/network is touched.
function fastProvider(
  fake: ReturnType<typeof makeFakeRailway>,
  over: {
    readAccessToken?: () => string | undefined;
    deployViaApi?: (args: {
      token: string;
      projectId: string;
      environmentId: string;
      templateCode: string;
    }) => Promise<{ workflowId: string }>;
    makeWorkdir?: () => string;
    awaitBrowserDeploy?: () => Promise<void>;
  } = {}
) {
  return createRailwayProvider({
    runCommand: fake.run,
    readAccessToken: over.readAccessToken ?? (() => 'access-tok'),
    deployViaApi: over.deployViaApi ?? (async () => ({ workflowId: 'wf-1' })),
    makeWorkdir: over.makeWorkdir ?? (() => '/tmp/automem-wd'),
    awaitBrowserDeploy: over.awaitBrowserDeploy ?? noGate,
  });
}

describe('Railway provider', () => {
  it('advertises usage-based (deferred) Railway billing', () => {
    const provider = createRailwayProvider();
    expect(provider.id).toBe('railway');
    expect(provider.billing.mode).toBe('deferred');
    expect(provider.billing.planLabel).toMatch(/railway/i);
  });

  it('exposes the browser Deploy-Now URL for the AutoMem template (fallback path)', () => {
    expect(RAILWAY_DEPLOY_URL).toBe('https://railway.com/deploy/automem-ai-memory-service');
  });

  // --- authorize ---

  it('authorizes via whoami without logging in, capturing the workspace id', async () => {
    const fake = makeFakeRailway({ whoamiCode: 0 });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const session = await provider.authorize();
    expect(session.token).toBe('railway-cli');
    expect(session.workspaceId).toBe('ws-1');
    expect(fake.calls.some((c) => c[0] === 'login')).toBe(false);
  });

  it('does not silently pick the first workspace when whoami returns several', () => {
    const stdout = JSON.stringify({
      workspaces: [
        { id: 'ws-personal', name: 'Personal' },
        { id: 'ws-team', name: 'Team' },
      ],
    });
    expect(parseWorkspaceId(stdout)).toBeUndefined();
  });

  it('prompts for a Railway workspace when whoami returns several', async () => {
    const fake = makeFakeRailway({
      whoamiStdout: JSON.stringify({
        name: 'tester',
        workspaces: [
          { id: 'ws-personal', name: 'Personal' },
          { id: 'ws-team', name: 'Team' },
        ],
      }),
    });
    const provider = createRailwayProvider({
      runCommand: fake.run,
      selectWorkspace: async (workspaces) => workspaces.find((w) => w.id === 'ws-team'),
    });
    const session = await provider.authorize();
    expect(session.workspaceId).toBe('ws-team');
  });

  it('throws instead of choosing a workspace in non-interactive mode', async () => {
    const fake = makeFakeRailway({
      whoamiStdout: JSON.stringify({
        name: 'tester',
        workspaces: [
          { id: 'ws-personal', name: 'Personal' },
          { id: 'ws-team', name: 'Team' },
        ],
      }),
    });
    const provider = createRailwayProvider({
      runCommand: fake.run,
      selectWorkspace: async (workspaces) => workspaces[0],
    });
    await expect(provider.authorize({ preferPaste: true })).rejects.toThrow(/multiple railway workspaces/i);
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
    await expect(provider.authorize()).resolves.toMatchObject({ token: 'railway-cli' });
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

  it('does not launch interactive railway login when authorization is non-interactive', async () => {
    let loginCalls = 0;
    const run = (args: string[], opts?: { interactive?: boolean }): RailwayCommandResult => {
      if (args[0] === 'whoami') return { code: 1, stdout: '', stderr: 'Unauthorized' };
      if (args[0] === 'login') {
        loginCalls += 1;
        expect(opts?.interactive).not.toBe(true);
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '{}', stderr: '' };
    };
    const provider = createRailwayProvider({ runCommand: run });

    await expect(provider.authorize({ preferPaste: true })).rejects.toThrow(/railway login/i);
    expect(loginCalls).toBe(0);
  });

  it('throws when the railway CLI is unavailable (so the caller can fall back)', async () => {
    const provider = createRailwayProvider({
      runCommand: () => {
        throw new Error('spawn railway ENOENT');
      },
    });
    await expect(provider.authorize()).rejects.toThrow(/railway/i);
  });

  // --- deploy: fast path (CLI init + GraphQL templateDeployV2, no browser) ---

  it('deploys via the fast path: init + status + GraphQL deploy, no browser', async () => {
    const fake = makeFakeRailway();
    let gate = 0;
    const provider = fastProvider(fake, { awaitBrowserDeploy: async () => void (gate += 1) });
    const deployment = await provider.deploy({ token: 'railway-cli', workspaceId: 'ws-1' });
    expect(fake.calls.some((c) => c[0] === 'init')).toBe(true);
    expect(fake.calls.some((c) => c[0] === 'status')).toBe(true);
    expect(fake.calls.some((c) => c[0] === 'link')).toBe(false); // no browser link on the fast path
    expect(gate).toBe(0); // browser gate never opened
    expect(deployment.name).toBe('automem');
  });

  it('passes the parsed project/environment ids + token + template code to the API deploy', async () => {
    const fake = makeFakeRailway();
    const seen: Array<Record<string, string>> = [];
    const provider = fastProvider(fake, {
      readAccessToken: () => 'tok-xyz',
      deployViaApi: async (args) => {
        seen.push(args);
        return { workflowId: 'wf' };
      },
    });
    await provider.deploy({ token: 'railway-cli', workspaceId: 'ws-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      token: 'tok-xyz',
      projectId: 'proj-1',
      environmentId: 'env-prod',
      templateCode: 'automem-ai-memory-service',
    });
  });

  it('creates the project non-interactively with the session workspace id', async () => {
    const fake = makeFakeRailway();
    const provider = fastProvider(fake);
    await provider.deploy({ token: 'railway-cli', workspaceId: 'ws-42' });
    const initCall = fake.calls.find((c) => c[0] === 'init');
    expect(initCall).toBeDefined();
    expect(initCall).toContain('--workspace');
    expect(initCall).toContain('ws-42');
    expect(initCall).toContain('--json'); // non-interactive
  });

  it('runs the CLI in an isolated workdir so it never links the user’s cwd', async () => {
    const fake = makeFakeRailway();
    const provider = fastProvider(fake, { makeWorkdir: () => '/tmp/iso-wd' });
    await provider.deploy({ token: 'railway-cli', workspaceId: 'ws-1' });
    const initIdx = fake.calls.findIndex((c) => c[0] === 'init');
    expect(fake.cwds[initIdx]).toBe('/tmp/iso-wd');
  });

  // --- deploy: browser fallback ---

  it('falls back to the browser Deploy-Now flow when the API deploy fails', async () => {
    const fake = makeFakeRailway();
    let gate = 0;
    const provider = fastProvider(fake, {
      deployViaApi: async () => {
        throw new Error('boom');
      },
      awaitBrowserDeploy: async () => void (gate += 1),
    });
    const deployment = await provider.deploy({ token: 'railway-cli', workspaceId: 'ws-1' });
    expect(gate).toBe(1);
    expect(fake.interactive).toContain('link'); // attaches to the browser-created project
    expect(deployment.name).toBe('automem');
  });

  it('falls back to the browser when the CLI session token cannot be read', async () => {
    const fake = makeFakeRailway();
    let gate = 0;
    let apiCalls = 0;
    const provider = fastProvider(fake, {
      readAccessToken: () => undefined,
      deployViaApi: async () => {
        apiCalls += 1;
        return { workflowId: 'wf' };
      },
      awaitBrowserDeploy: async () => void (gate += 1),
    });
    await provider.deploy({ token: 'railway-cli', workspaceId: 'ws-1' });
    expect(apiCalls).toBe(0); // never attempted the API deploy without a token
    expect(gate).toBe(1);
  });

  it('throws when the fast path fails AND the browser fallback link fails', async () => {
    const fake = makeFakeRailway({ linkCode: 1 });
    const provider = fastProvider(fake, {
      deployViaApi: async () => {
        throw new Error('api boom');
      },
    });
    await expect(provider.deploy({ token: 'railway-cli', workspaceId: 'ws-1' })).rejects.toThrow(/railway|link|provision/i);
  });

  // --- waitUntilReady + fetchCredentials ---

  it('waitUntilReady polls railway domain until it appears (the deploy provisions it asynchronously)', async () => {
    let domainCalls = 0;
    const run = (args: string[]): RailwayCommandResult => {
      if (args[0] === 'domain') {
        domainCalls += 1;
        return domainCalls < 3
          ? { code: 0, stdout: '{}', stderr: '' } // not provisioned yet
          : { code: 0, stdout: JSON.stringify({ domain: 'mem.up.railway.app' }), stderr: '' };
      }
      return { code: 0, stdout: '{}', stderr: '' };
    };
    const provider = createRailwayProvider({ runCommand: run, sleep: async () => {} });
    const ready = await provider.waitUntilReady({ token: 'railway-cli', workdir: '/tmp/wd' }, { name: 'automem', status: 'DEPLOYED' });
    expect(ready.name).toBe('automem');
    expect(domainCalls).toBeGreaterThanOrEqual(3); // kept polling until the domain showed up
  });

  it('waitUntilReady never polls Railway’s deploy workflow (the call that false-negatives)', async () => {
    const fake = makeFakeRailway();
    const provider = createRailwayProvider({ runCommand: fake.run, sleep: async () => {} });
    await provider.waitUntilReady({ token: 'railway-cli', workdir: '/tmp/wd' }, { name: 'automem' });
    expect(fake.calls.some((c) => c[0] === 'domain')).toBe(true);
    expect(fake.calls.some((c) => c[0] === 'deployment')).toBe(false);
  });

  it('waitUntilReady gives up after its poll budget without throwing (fetchCredentials then surfaces the error)', async () => {
    const run = (args: string[]): RailwayCommandResult =>
      args[0] === 'domain' ? { code: 0, stdout: '{}', stderr: '' } : { code: 0, stdout: '{}', stderr: '' };
    const provider = createRailwayProvider({ runCommand: run, sleep: async () => {}, domainPollAttempts: 3 });
    const ready = await provider.waitUntilReady({ token: 'railway-cli', workdir: '/tmp/wd' }, { name: 'automem' });
    expect(ready.name).toBe('automem'); // resolves, does not throw
  });

  it('captures the read domain + AUTOMEM_API_TOKEN as credentials, in the deploy workdir', async () => {
    const fake = makeFakeRailway({ domain: 'mem.up.railway.app', variables: { AUTOMEM_API_TOKEN: 'rw-tok' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials({ token: 'railway-cli', workdir: '/tmp/iso-wd' }, { name: 'automem' });
    expect(creds.endpoint).toBe('https://mem.up.railway.app');
    expect(creds.apiKey).toBe('rw-tok');
    const domainIdx = fake.calls.findIndex((c) => c[0] === 'domain');
    expect(fake.cwds[domainIdx]).toBe('/tmp/iso-wd');
  });

  it('prefers AUTOMEM_API_KEY over AUTOMEM_API_TOKEN when both are set (migration-proof)', async () => {
    const fake = makeFakeRailway({ variables: { AUTOMEM_API_KEY: 'new-key', AUTOMEM_API_TOKEN: 'old-tok' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials({ token: 'railway-cli' }, { name: 'automem' });
    expect(creds.apiKey).toBe('new-key');
  });

  it('throws when the template API token cannot be captured', async () => {
    const fake = makeFakeRailway({ variables: {} });
    const provider = createRailwayProvider({ runCommand: fake.run });
    await expect(provider.fetchCredentials({ token: 'railway-cli' }, { name: 'automem' })).rejects.toThrow(
      /api token/i
    );
  });

  it('reads the existing domain rather than generating one with a default port', async () => {
    const fake = makeFakeRailway();
    const provider = createRailwayProvider({ runCommand: fake.run });
    await provider.fetchCredentials({ token: 'railway-cli' }, { name: 'automem' });
    const domainCall = fake.calls.find((c) => c[0] === 'domain');
    expect(domainCall).toBeDefined();
    expect(domainCall?.includes('--port')).toBe(false);
  });

  it('throws when the service has no domain (caller falls back to paste)', async () => {
    const run = (args: string[]): RailwayCommandResult =>
      args[0] === 'domain'
        ? { code: 0, stdout: '{}', stderr: '' }
        : { code: 0, stdout: '{"AUTOMEM_API_TOKEN":"t"}', stderr: '' };
    const provider = createRailwayProvider({ runCommand: run });
    await expect(provider.fetchCredentials({ token: 'railway-cli' }, { name: 'automem' })).rejects.toThrow(/domain/i);
  });

  it('uses a domain that already carries a scheme as-is (enables http for local testing)', async () => {
    const fake = makeFakeRailway({ domain: 'http://127.0.0.1:5005', variables: { AUTOMEM_API_TOKEN: 't' } });
    const provider = createRailwayProvider({ runCommand: fake.run });
    const creds = await provider.fetchCredentials({ token: 'railway-cli' }, { name: 'automem' });
    expect(creds.endpoint).toBe('http://127.0.0.1:5005');
  });
});

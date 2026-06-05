import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  AGENT_CLIENTS,
  DEFAULT_AGENT_CLIENTS,
  buildInstallPlan,
  detectInstallEnvironment,
  parseInstallArgs,
  renderInstallPlan,
  shouldUseNonInteractivePreview,
  validateInstallPrerequisites,
  verifyAutoMemEndpoint,
  waitForAutoMemEndpoint,
} from './install.js';

describe('guided install helpers', () => {
  it('parses env defaults and CLI overrides', () => {
    const parsed = parseInstallArgs(
      [
        '--target',
        'existing',
        '--clients',
        'codex,cursor',
        '--endpoint',
        'https://memory.example',
        '--api-key',
        'sk-test',
        '--local-dir',
        '/tmp/automem-server',
        '--dry-run',
        '--yes',
        '--no-agent-install',
      ],
      {
        AUTOMEM_INSTALL_TARGET: 'cloud',
        AUTOMEM_CLIENTS: 'hermes',
        AUTOMEM_API_URL: 'https://env.example',
        AUTOMEM_API_KEY: 'env-key',
        AUTOMEM_LOCAL_DIR: '/env/local',
      }
    );

    expect(parsed).toEqual({
      target: 'existing',
      clients: ['codex', 'cursor'],
      endpoint: 'https://memory.example',
      apiKey: 'sk-test',
      localDir: '/tmp/automem-server',
      dryRun: true,
      yes: true,
      noAgentInstall: true,
    });
  });

  it('rejects unknown install targets and clients', () => {
    expect(() => parseInstallArgs(['--target', 'serverless'])).toThrow(/invalid install target/i);
    expect(() => parseInstallArgs(['--clients', 'codex,nope'])).toThrow(/invalid AutoMem client/i);
  });

  it('detects supported agents and local prerequisites', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const existing = new Set([
      path.join(homeDir, '.codex'),
      path.join(homeDir, '.claude'),
      path.join(homeDir, '.cursor'),
      path.join(homeDir, '.hermes'),
    ]);

    const environment = detectInstallEnvironment({
      homeDir,
      cwd,
      platform: 'darwin',
      commandExists: (command) => ['node', 'npm', 'docker'].includes(command),
      pathExists: (filePath) => existing.has(filePath),
    });

    expect(environment.platform).toBe('darwin');
    expect(environment.prerequisites).toMatchObject({
      node: true,
      npm: true,
      docker: true,
    });
    expect(environment.detectedClients.map((client) => client.client)).toEqual([
      'codex',
      'claude-code',
      'cursor',
      'hermes',
    ]);
  });

  it('builds an exact dry-run review plan for an existing endpoint', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: ['codex', 'claude-code'],
        endpoint: 'https://memory.example',
        apiKey: 'sk-test',
        dryRun: true,
        yes: false,
        noAgentInstall: false,
      },
      environment: detectInstallEnvironment({
        homeDir,
        cwd,
        commandExists: () => true,
        pathExists: () => true,
      }),
    });

    expect(plan.target).toBe('existing');
    expect(plan.endpoint).toBe('https://memory.example');
    expect(plan.requiresReview).toBe(true);
    expect(plan.actions.map((action) => action.kind)).toEqual([
      'verify-endpoint',
      'write-env',
      'install-agent',
      'install-agent',
    ]);
    // F2: the codex action must promise ONLY AGENTS.md. The MCP server registration
    // in ~/.codex/config.toml is advice-only (codex.ts logs a pointer at
    // templates/codex/config.toml, it never writes the file), so listing config.toml
    // here would make the plan over-promise a write the executor never performs.
    // Assert exact equality — a plain `.toContain(AGENTS.md)` would not catch a
    // reintroduced config.toml path.
    const codexPaths = plan.actions.find((action) => action.client === 'codex')?.paths;
    expect(codexPaths).toEqual([path.join(cwd, 'AGENTS.md')]);
    expect(codexPaths).not.toContain(path.join(homeDir, '.codex', 'config.toml'));
    expect(plan.actions.find((action) => action.client === 'claude-code')?.paths).toContain(
      path.join(homeDir, '.claude', 'settings.json')
    );
  });

  it('renders a compact branded review without exposing secrets', () => {
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: [],
        endpoint: 'https://memory.example',
        apiKey: 'sk-test-secret',
        dryRun: false,
        yes: true,
        noAgentInstall: true,
      },
      environment: detectInstallEnvironment({
        homeDir: '/Users/tester',
        cwd: '/repo/project',
        commandExists: () => true,
        pathExists: () => false,
      }),
    });

    const rendered = renderInstallPlan(plan);

    expect(rendered).toContain('AutoMem lab console');
    expect(rendered).toContain('memory graph target');
    expect(rendered).toContain('[verify]');
    expect(rendered).toContain('[write]');
    expect(rendered).toContain('backup');
    expect(rendered).toContain('<redacted>');
    expect(rendered).not.toContain('curl -H');
    expect(rendered).not.toContain('sk-test-secret');
  });

  it('defaults to all known clients when AUTOMEM_CLIENTS is omitted', () => {
    expect(parseInstallArgs([], {}).clients).toEqual([...DEFAULT_AGENT_CLIENTS]);
    expect(parseInstallArgs([], {}).clients).not.toContain('hermes');
  });

  it('keeps Hermes available only when explicitly requested', () => {
    expect(AGENT_CLIENTS).toContain('hermes');
    expect(parseInstallArgs(['--clients', 'hermes'], {}).clients).toEqual(['hermes']);
    expect(parseInstallArgs([], { AUTOMEM_CLIENTS: 'hermes' }).clients).toEqual(['hermes']);
  });

  it('renders Hermes plan paths from HERMES_HOME when explicitly selected', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const hermesHome = '/tmp/hermes-home';
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: ['hermes'],
        endpoint: 'https://memory.example',
        dryRun: true,
        yes: false,
        noAgentInstall: false,
      },
      environment: detectInstallEnvironment({
        homeDir,
        cwd,
        env: { HERMES_HOME: hermesHome },
        commandExists: () => true,
        pathExists: () => false,
      }),
    });

    const hermesAction = plan.actions.find((action) => action.client === 'hermes');
    expect(hermesAction?.paths).toEqual([
      path.join(hermesHome, 'config.yaml'),
      path.join(hermesHome, 'AGENTS.md'),
    ]);
  });

  it('uses preview-only fallback when there is no TTY and no explicit approval', () => {
    expect(
      shouldUseNonInteractivePreview({
        interactive: false,
        yes: false,
        dryRun: false,
      })
    ).toBe(true);
    expect(shouldUseNonInteractivePreview({ interactive: true, yes: false, dryRun: false })).toBe(false);
    expect(shouldUseNonInteractivePreview({ interactive: false, yes: true, dryRun: false })).toBe(false);
    expect(shouldUseNonInteractivePreview({ interactive: false, yes: false, dryRun: true })).toBe(false);
  });

  it('flags missing local prerequisites before applying the plan', () => {
    const environment = detectInstallEnvironment({
      homeDir: '/Users/tester',
      cwd: '/repo/project',
      commandExists: (command) => command === 'node',
      pathExists: () => false,
    });

    expect(
      validateInstallPrerequisites(
        {
          target: 'local',
          clients: ['codex'],
          dryRun: false,
          yes: true,
          noAgentInstall: false,
        },
        environment
      )
    ).toEqual(['npm', 'docker', 'git']);

    expect(
      validateInstallPrerequisites(
        {
          target: 'existing',
          clients: [],
          dryRun: false,
          yes: true,
          noAgentInstall: true,
        },
        environment
      )
    ).toEqual([]);
  });

  it('verifies health and authenticated recall with bearer auth', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
      requests.push({ url, authorization: init?.headers?.Authorization });
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      };
    };

    await expect(
      verifyAutoMemEndpoint({
        endpoint: 'https://memory.example/',
        apiKey: 'sk-test',
        fetchFn,
      })
    ).resolves.toEqual({ ok: true });

    expect(requests).toEqual([
      { url: 'https://memory.example/health', authorization: undefined },
      {
        url: 'https://memory.example/recall?limit=1',
        authorization: 'Bearer sk-test',
      },
    ]);
  });

  it('waits for a local endpoint to become healthy before continuing', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts += 1;
      return {
        ok: attempts === 3,
        status: attempts === 3 ? 200 : 503,
        json: async () => ({ status: 'healthy' }),
      };
    };

    await expect(
      waitForAutoMemEndpoint({
        endpoint: 'http://127.0.0.1:8001',
        fetchFn,
        attempts: 3,
        intervalMs: 1,
      })
    ).resolves.toEqual({ ok: true });
    expect(attempts).toBe(3);
  });
});

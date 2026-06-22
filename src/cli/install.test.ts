import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AGENT_CLIENTS,
  DEFAULT_AGENT_CLIENTS,
  InstallError,
  buildInstallPlan,
  claudePluginInstallArgs,
  claudePluginMarketplaceAddArgs,
  detectInstallEnvironment,
  formatEnvValue,
  formatInstallError,
  installClaudeCodePlugin,
  manualFixHint,
  parseInstallArgs,
  prepareLocalServer,
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
        '--hermes-mode',
        'both',
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
        AUTOMEM_HERMES_MODE: 'provider',
      }
    );

    expect(parsed).toEqual({
      target: 'existing',
      clients: ['codex', 'cursor'],
      endpoint: 'https://memory.example',
      apiKey: 'sk-test',
      localDir: '/tmp/automem-server',
      hermesMode: 'both',
      claudeCodeMode: 'plugin',
      dryRun: true,
      yes: true,
      noAgentInstall: true,
    });
  });

  it('rejects unknown install targets and clients', () => {
    expect(() => parseInstallArgs(['--target', 'serverless'])).toThrow(/invalid install target/i);
    expect(() => parseInstallArgs(['--clients', 'codex,nope'])).toThrow(/invalid AutoMem client/i);
    expect(() => parseInstallArgs(['--hermes-mode', 'legacy'])).toThrow(/invalid Hermes install mode/i);
  });

  it('parses the cloud provider from the flag and the environment', () => {
    expect(parseInstallArgs(['--cloud-provider', 'instapods']).cloudProvider).toBe('instapods');
    expect(parseInstallArgs([], { AUTOMEM_CLOUD_PROVIDER: 'railway' }).cloudProvider).toBe('railway');
    expect(parseInstallArgs(['--cloud-provider', 'other']).cloudProvider).toBe('other');
    expect(() => parseInstallArgs(['--cloud-provider', 'aws'])).toThrow(/invalid cloud provider/i);
  });

  it('plans the InstaPods cloud target as a cost-disclosing provision step', () => {
    const plan = buildInstallPlan({
      options: {
        target: 'cloud',
        cloudProvider: 'instapods',
        clients: [],
        hermesMode: 'mcp',
        claudeCodeMode: 'plugin',
        dryRun: false,
        yes: true,
        noAgentInstall: true,
      },
      environment: detectInstallEnvironment({
        homeDir: '/Users/tester',
        cwd: '/repo/project',
        commandExists: () => true,
        pathExists: () => true,
      }),
    });

    const provision = plan.actions.find((action) => action.kind === 'provision-cloud');
    expect(provision).toBeDefined();
    expect(provision?.detail).toMatch(/instapods/i);
    expect(provision?.detail).toMatch(/\$15\/mo/);
    expect(provision?.detail).toMatch(/paste|setup page/i);
    // Endpoint is unknown until apply provisions it, so there's no verify step yet.
    expect(plan.actions.some((action) => action.kind === 'verify-endpoint')).toBe(false);
  });

  it('plans the Railway cloud target as a guided provision step (no manual paste)', () => {
    const plan = buildInstallPlan({
      options: {
        target: 'cloud',
        cloudProvider: 'railway',
        clients: [],
        hermesMode: 'mcp',
        claudeCodeMode: 'plugin',
        dryRun: false,
        yes: true,
        noAgentInstall: true,
      },
      environment: detectInstallEnvironment({
        homeDir: '/Users/tester',
        cwd: '/repo/project',
        commandExists: () => true,
        pathExists: () => true,
      }),
    });

    const provision = plan.actions.find((action) => action.kind === 'provision-cloud');
    expect(provision).toBeDefined();
    expect(provision?.detail).toMatch(/railway/i);
    // Endpoint is provisioned during apply, so no manual paste and no verify yet.
    expect(plan.actions.some((action) => action.kind === 'manual-step')).toBe(false);
    expect(plan.actions.some((action) => action.kind === 'verify-endpoint')).toBe(false);
  });

  it('treats the cloud "other" provider like an existing endpoint (paste up front, no provision step)', () => {
    const plan = buildInstallPlan({
      options: {
        target: 'cloud',
        cloudProvider: 'other',
        clients: [],
        endpoint: 'https://already-deployed.example',
        apiKey: 'sk-existing',
        hermesMode: 'mcp',
        claudeCodeMode: 'plugin',
        dryRun: false,
        yes: true,
        noAgentInstall: true,
      },
      environment: detectInstallEnvironment({
        homeDir: '/Users/tester',
        cwd: '/repo/project',
        commandExists: () => true,
        pathExists: () => true,
      }),
    });

    // Credentials were pasted up front, so there's no provision step — it verifies
    // and writes .env just like the existing-endpoint flow.
    expect(plan.actions.some((action) => action.kind === 'provision-cloud')).toBe(false);
    expect(plan.actions.some((action) => action.kind === 'verify-endpoint')).toBe(true);
    expect(plan.actions.some((action) => action.kind === 'write-env')).toBe(true);
  });

  it('treats an explicit cloud endpoint as already provisioned, regardless of provider flag', () => {
    const plan = buildInstallPlan({
      options: {
        target: 'cloud',
        cloudProvider: 'railway',
        clients: [],
        endpoint: 'https://already-deployed.example',
        apiKey: 'sk-existing',
        hermesMode: 'mcp',
        claudeCodeMode: 'plugin',
        dryRun: false,
        yes: true,
        noAgentInstall: true,
      },
      environment: detectInstallEnvironment({
        homeDir: '/Users/tester',
        cwd: '/repo/project',
        commandExists: () => true,
        pathExists: () => true,
      }),
    });

    expect(plan.actions.some((action) => action.kind === 'provision-cloud')).toBe(false);
    expect(plan.actions.some((action) => action.kind === 'verify-endpoint')).toBe(true);
    expect(plan.endpoint).toBe('https://already-deployed.example');
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

  it('pre-checks every detected client (Hermes included), not just the defaults', () => {
    const homeDir = '/Users/tester';
    const environment = detectInstallEnvironment({
      homeDir,
      cwd: '/repo/project',
      platform: 'darwin',
      commandExists: () => true,
      pathExists: (filePath) => filePath === path.join(homeDir, '.hermes'),
    });
    const detected = new Set(environment.detectedClients.map((client) => client.client));

    // The multiselect pre-checks AGENT_CLIENTS ∩ detected — Hermes must survive it.
    const preChecked = AGENT_CLIENTS.filter((client) => detected.has(client));
    expect(preChecked).toContain('hermes');
    // The old defaults-only filter would have dropped it (the bug being fixed).
    expect(DEFAULT_AGENT_CLIENTS.filter((client) => detected.has(client))).not.toContain('hermes');
  });

  it('quotes .env values only when they would break dotenv parsing', () => {
    // Plain url-safe values pass through unquoted.
    expect(formatEnvValue('https://automem.example')).toBe('https://automem.example');
    expect(formatEnvValue('sk_live_abc123')).toBe('sk_live_abc123');
    // Whitespace, #, and quotes force quoting (with embedded quotes/backslashes escaped).
    expect(formatEnvValue('has space')).toBe('"has space"');
    expect(formatEnvValue('a#b')).toBe('"a#b"');
    expect(formatEnvValue('with"quote')).toBe('"with\\"quote"');
    expect(formatEnvValue('')).toBe('""');
  });

  it('gives a manual-fix command for every agent client', () => {
    for (const client of AGENT_CLIENTS) {
      const hint = manualFixHint(client);
      expect(hint.length).toBeGreaterThan(0);
      // Each hint names a runnable recovery command.
      expect(/openclaw plugins install|npx @verygoodplugins\/mcp-automem install/.test(hint)).toBe(true);
    }
    expect(manualFixHint('openclaw')).toContain('openclaw plugins install');
  });

  it('builds an exact dry-run review plan for an existing endpoint', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: ['codex', 'claude-code'],
        endpoint: 'https://memory.example',
        hermesMode: 'mcp',
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
        hermesMode: 'mcp',
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

    expect(rendered).toContain('Install review');
    expect(rendered).toContain('Stages');
    expect(rendered).toContain('https://memory.example');
    expect(rendered).toContain('[verify]');
    expect(rendered).toContain('[write]');
    expect(rendered).toContain('backup');
    // Security: the key is only ever shown redacted, and the bearer curl command
    // (which embeds even the REDACTED token shape) is never rendered in the plan.
    expect(rendered).toContain('<redacted>');
    expect(rendered).not.toContain('curl -H');
    expect(rendered).not.toContain('sk-test-secret');
  });

  it('defaults to all known clients when AUTOMEM_CLIENTS is omitted', () => {
    expect(parseInstallArgs([], {}).clients).toEqual([...DEFAULT_AGENT_CLIENTS]);
    expect(parseInstallArgs([], {}).clients).not.toContain('hermes');
    expect(parseInstallArgs([], {}).hermesMode).toBe('mcp');
  });

  it('keeps Hermes available only when explicitly requested', () => {
    expect(AGENT_CLIENTS).toContain('hermes');
    expect(parseInstallArgs(['--clients', 'hermes'], {}).clients).toEqual(['hermes']);
    expect(parseInstallArgs([], { AUTOMEM_CLIENTS: 'hermes' }).clients).toEqual(['hermes']);
  });

  it('defaults Claude Code to the plugin and parses the mode override', () => {
    expect(parseInstallArgs([], {}).claudeCodeMode).toBe('plugin');
    expect(parseInstallArgs(['--claude-code-mode', 'settings'], {}).claudeCodeMode).toBe('settings');
    expect(parseInstallArgs([], { AUTOMEM_CLAUDE_CODE_MODE: 'settings' }).claudeCodeMode).toBe(
      'settings'
    );
    expect(() => parseInstallArgs(['--claude-code-mode', 'nope'])).toThrow(/invalid Claude Code mode/i);
  });

  it('plans Claude Code as a plugin manual step when claude is not on PATH (no settings write)', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: ['claude-code'],
        endpoint: 'https://memory.example',
        hermesMode: 'mcp',
        claudeCodeMode: 'plugin',
        dryRun: true,
        yes: false,
        noAgentInstall: false,
      },
      environment: detectInstallEnvironment({
        homeDir,
        cwd,
        // claude absent → the fallback path (printed /plugin commands). The
        // auto-install path (claude present) is covered separately.
        commandExists: (cmd) => cmd !== 'claude',
        pathExists: () => true,
      }),
    });

    const claudeAction = plan.actions.find((action) => action.client === 'claude-code');
    expect(claudeAction?.kind).toBe('manual-step');
    // Plugin mode must NOT promise any ~/.claude file writes.
    expect(claudeAction?.paths).toEqual([]);
    expect(claudeAction?.commands).toEqual([
      '/plugin marketplace add verygoodplugins/mcp-automem',
      '/plugin install automem@verygoodplugins-mcp-automem',
    ]);
    const rendered = renderInstallPlan(plan);
    expect(rendered).toContain('/plugin install automem@verygoodplugins-mcp-automem');
  });

  it('plans Claude Code as a settings-level write when mode is settings', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: ['claude-code'],
        endpoint: 'https://memory.example',
        hermesMode: 'mcp',
        claudeCodeMode: 'settings',
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

    const claudeAction = plan.actions.find((action) => action.client === 'claude-code');
    expect(claudeAction?.kind).toBe('install-agent');
    expect(claudeAction?.paths).toContain(path.join(homeDir, '.claude', 'settings.json'));
    expect(claudeAction?.commands).toBeUndefined();
  });

  it('plans Cursor as a rule-file-only write (mcp.json is advice-only, never written)', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: ['cursor'],
        endpoint: 'https://memory.example',
        hermesMode: 'mcp',
        claudeCodeMode: 'plugin',
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

    const cursorPaths = plan.actions.find((action) => action.client === 'cursor')?.paths;
    // applyCursorSetup only writes the project rule file; ~/.cursor/mcp.json is
    // advice-only, so the plan must not promise to write it.
    expect(cursorPaths).toEqual([path.join(cwd, '.cursor', 'rules', 'automem.mdc')]);
    expect(cursorPaths).not.toContain(path.join(homeDir, '.cursor', 'mcp.json'));
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
        hermesMode: 'mcp',
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

  it('renders Hermes provider-mode plan paths when requested', () => {
    const homeDir = '/Users/tester';
    const cwd = '/repo/project';
    const hermesHome = '/tmp/hermes-home';
    const plan = buildInstallPlan({
      options: {
        target: 'existing',
        clients: ['hermes'],
        endpoint: 'https://memory.example',
        hermesMode: 'provider',
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
    expect(hermesAction?.detail).toContain('provider');
    expect(hermesAction?.paths).toEqual([
      path.join(hermesHome, 'config.yaml'),
      path.join(hermesHome, 'AGENTS.md'),
      path.join(hermesHome, 'plugins', 'automem', '__init__.py'),
      path.join(hermesHome, 'plugins', 'automem', 'plugin.yaml'),
      path.join(hermesHome, '.env'),
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
          hermesMode: 'mcp',
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
          hermesMode: 'mcp',
          dryRun: false,
          yes: true,
          noAgentInstall: true,
        },
        environment
      )
    ).toEqual([]);

    // Endpoint-only run: noAgentInstall is false but no agents were selected, so
    // there is no npx command to honor — npm must not be required.
    expect(
      validateInstallPrerequisites(
        {
          target: 'existing',
          clients: [],
          hermesMode: 'mcp',
          dryRun: false,
          yes: true,
          noAgentInstall: false,
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

  it('rejects a 200 whose body is not JSON (captive portal / login wall)', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    const result = await verifyAutoMemEndpoint({ endpoint: 'https://wall.example', fetchFn });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('not JSON');
  });

  it('rejects a 200 JSON body without an AutoMem status field', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    });
    const result = await verifyAutoMemEndpoint({ endpoint: 'https://other.example', fetchFn });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('AutoMem status field');
  });

  it('rejects a non-ok /health response', async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const result = await verifyAutoMemEndpoint({ endpoint: 'https://down.example', fetchFn });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('HTTP 500');
  });

  it('fails fast with a clean message when the endpoint hangs (abort timeout)', async () => {
    // A fetch that never resolves on its own, but rejects when the abort fires.
    const hangingFetch = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const result = await verifyAutoMemEndpoint({
      endpoint: 'https://stalled.example',
      fetchFn: hangingFetch,
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('timed out');
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

  it('passes a custom timeout through every wait probe', async () => {
    vi.useFakeTimers();
    try {
      const hangingFetch = (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });

      const resultPromise = waitForAutoMemEndpoint({
        endpoint: 'https://stalled.example',
        fetchFn: hangingFetch,
        attempts: 1,
        timeoutMs: 20,
      });

      await vi.advanceTimersByTimeAsync(20);
      // If waitForAutoMemEndpoint drops timeoutMs, the default 10s timer resolves
      // the promise only after this extra advance and the assertion below fails.
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('timed out after 0.02s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waitForAutoMemEndpoint with stableChecks requires consecutive successes (a flicker resets the streak)', async () => {
    let recallCalls = 0;
    const fetchFn = async (url: string) => {
      if (url.includes('/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
      }
      // recall flickers: ok, FAIL(404), ok, ok — mirrors an early-boot blueprint flap.
      recallCalls += 1;
      const ok = recallCalls !== 2;
      return { ok, status: ok ? 200 : 404, json: async () => ({}) };
    };

    await expect(
      waitForAutoMemEndpoint({
        endpoint: 'http://127.0.0.1:8001',
        apiKey: 'tok',
        fetchFn,
        attempts: 10,
        intervalMs: 1,
        stableChecks: 2,
      })
    ).resolves.toEqual({ ok: true });
    // 1:ok(streak=1) 2:404(reset) 3:ok(streak=1) 4:ok(streak=2 → ready) = 4 recall probes.
    expect(recallCalls).toBe(4);
  });

  it('turns a docker compose failure into a clean InstallError with a port hint', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-local-prep-'));
    try {
      const runCommand = (command: string) => {
        if (command === 'docker') {
          // Mirror the real execFileSync failure shape (incl. the port clash).
          throw new Error(
            'Command failed: docker compose --env-file .env up -d --build\n' +
              'Bind for 0.0.0.0:3000 failed: port is already allocated'
          );
        }
        // git clone succeeds
      };
      const promise = prepareLocalServer({
        localDir: path.join(dir, 'server'),
        dryRun: false,
        runCommand,
      });
      await expect(promise).rejects.toBeInstanceOf(InstallError);
      const err = await promise.catch((e) => e as InstallError);
      // Clean, user-facing message — never the raw "Command failed: …" noise.
      expect(err.message).not.toContain('Command failed');
      expect(err.message).toMatch(/local AutoMem server/i);
      expect(err.hint).toMatch(/port|:3000/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('turns a git clone failure into a clean InstallError', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-local-git-'));
    try {
      const runCommand = (command: string) => {
        if (command === 'git') throw new Error('Command failed: git clone …');
      };
      const err = await prepareLocalServer({
        localDir: path.join(dir, 'server'),
        dryRun: false,
        runCommand,
      }).catch((e) => e as InstallError);
      expect(err).toBeInstanceOf(InstallError);
      expect(err.message).not.toContain('Command failed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formatInstallError renders a clean themed line with the hint and no stack trace', () => {
    const out = formatInstallError(
      new InstallError("Local AutoMem server didn't start (docker compose).", 'A port is in use — :3000.'),
      process.stderr
    );
    expect(out).toContain("Local AutoMem server didn't start");
    expect(out).toContain(':3000');
    expect(out).not.toMatch(/\n\s+at\s/); // no "    at file:///…" stack frames
    expect(out).not.toContain('node:internal');
  });

  it('formatInstallError strips raw "Command failed:" noise from a plain Error', () => {
    const out = formatInstallError(new Error('Command failed: docker compose up'), process.stderr);
    expect(out).not.toContain('Command failed');
    expect(out).toContain('AutoMem install failed');
  });

  it('rejects a custom --endpoint with target local so the plan matches what is written', () => {
    const environment = detectInstallEnvironment();
    expect(() =>
      buildInstallPlan({
        options: { ...parseInstallArgs([], {}), target: 'local', endpoint: 'http://custom:9000' },
        environment,
      })
    ).toThrow(/not supported with --target local/);
  });

  it('pins the local endpoint to the default in the plan', () => {
    const environment = detectInstallEnvironment();
    const plan = buildInstallPlan({
      options: { ...parseInstallArgs([], {}), target: 'local' },
      environment,
    });
    expect(plan.endpoint).toBe('http://127.0.0.1:8001');
  });

  it('reuses the existing local .env token on re-run instead of rotating it', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-local-'));
    try {
      fs.writeFileSync(
        path.join(localDir, '.env'),
        'AUTOMEM_API_TOKEN=preexisting-token\nADMIN_API_TOKEN=preexisting-admin\n'
      );
      const result = await prepareLocalServer({ localDir, dryRun: true });
      expect(result.apiKey).toBe('preexisting-token');
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it('honors an explicit apiKey over the stored local token', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-local-'));
    try {
      fs.writeFileSync(path.join(localDir, '.env'), 'AUTOMEM_API_TOKEN=preexisting-token\n');
      const result = await prepareLocalServer({ localDir, apiKey: 'explicit-key', dryRun: true });
      expect(result.apiKey).toBe('explicit-key');
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
});

describe('claude plugin auto-install', () => {
  it('builds marketplace-add args for the AutoMem GitHub source', () => {
    expect(claudePluginMarketplaceAddArgs()).toEqual([
      'plugin',
      'marketplace',
      'add',
      'verygoodplugins/mcp-automem',
    ]);
  });

  it('builds install args with api_url but never puts api_key in argv', () => {
    expect(claudePluginInstallArgs({ endpoint: 'http://127.0.0.1:8001' })).toEqual([
      'plugin',
      'install',
      'automem@verygoodplugins-mcp-automem',
      '--scope',
      'user',
      '--config',
      'api_url=http://127.0.0.1:8001',
    ]);
    expect(claudePluginInstallArgs({ endpoint: 'https://x.example', apiKey: 'sk-1' })).toEqual([
      'plugin',
      'install',
      'automem@verygoodplugins-mcp-automem',
      '--scope',
      'user',
      '--config',
      'api_url=https://x.example',
    ]);
  });

  function recordingRunner(responder: (args: string[]) => { code: number; stdout?: string; stderr?: string }) {
    const calls: string[][] = [];
    const run = (_cmd: string, args: string[]) => {
      calls.push(args);
      const r = responder(args);
      return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    return { run, calls };
  }

  it('adds the marketplace then installs without leaking api_key in argv', async () => {
    const { run, calls } = recordingRunner((args) => {
      if (args[1] === 'marketplace' && args[2] === 'list') return { code: 0, stdout: '' };
      return { code: 0 };
    });
    await installClaudeCodePlugin({
      endpoint: 'http://127.0.0.1:8001',
      apiKey: 'sk-1',
      dryRun: false,
      runCommand: run,
    });
    expect(calls).toEqual([
      ['plugin', 'marketplace', 'list'],
      ['plugin', 'marketplace', 'add', 'verygoodplugins/mcp-automem'],
      [
        'plugin',
        'install',
        'automem@verygoodplugins-mcp-automem',
        '--scope',
        'user',
        '--config',
        'api_url=http://127.0.0.1:8001',
      ],
    ]);
  });

  it('skips marketplace add when the marketplace is already registered', async () => {
    const { run, calls } = recordingRunner((args) => {
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return { code: 0, stdout: 'verygoodplugins-mcp-automem  github  ...' };
      }
      return { code: 0 };
    });
    await installClaudeCodePlugin({ endpoint: 'http://x', dryRun: false, runCommand: run });
    expect(calls.some((a) => a[2] === 'add')).toBe(false);
    expect(calls.some((a) => a[1] === 'install')).toBe(true);
  });

  it('throws (to trigger the manual fallback) when the install hard-fails', async () => {
    const { run } = recordingRunner((args) => {
      if (args[1] === 'marketplace' && args[2] === 'list') return { code: 0, stdout: '' };
      if (args[1] === 'install') return { code: 1, stderr: 'network unreachable' };
      return { code: 0 };
    });
    await expect(
      installClaudeCodePlugin({ endpoint: 'http://x', dryRun: false, runCommand: run })
    ).rejects.toThrow();
  });

  it('treats an already-installed non-zero exit as success', async () => {
    const { run } = recordingRunner((args) => {
      if (args[1] === 'marketplace' && args[2] === 'list') return { code: 0, stdout: '' };
      if (args[1] === 'install') return { code: 1, stderr: 'Plugin automem is already installed' };
      return { code: 0 };
    });
    await expect(
      installClaudeCodePlugin({ endpoint: 'http://x', dryRun: false, runCommand: run })
    ).resolves.toBeUndefined();
  });

  it('runs nothing on dry-run', async () => {
    const { run, calls } = recordingRunner(() => ({ code: 0 }));
    await installClaudeCodePlugin({ endpoint: 'http://x', dryRun: true, runCommand: run });
    expect(calls).toEqual([]);
  });

  it('detects the claude binary as a prerequisite', () => {
    const env = detectInstallEnvironment({ commandExists: (c) => c === 'claude' });
    expect(env.prerequisites.claude).toBe(true);
  });

  it('plans a real plugin install (install-agent) when claude is on PATH', () => {
    const env = detectInstallEnvironment({ commandExists: (c) => c === 'claude' });
    const plan = buildInstallPlan({
      options: { ...parseInstallArgs([], {}), target: 'existing', endpoint: 'http://x' },
      environment: env,
    });
    const action = plan.actions.find((a) => a.client === 'claude-code');
    expect(action?.kind).toBe('install-agent');
  });

  it('falls back to a manual step for the plugin when claude is absent', () => {
    const env = detectInstallEnvironment({ commandExists: () => false });
    const plan = buildInstallPlan({
      options: { ...parseInstallArgs([], {}), target: 'existing', endpoint: 'http://x' },
      environment: env,
    });
    const action = plan.actions.find((a) => a.client === 'claude-code');
    expect(action?.kind).toBe('manual-step');
  });
});

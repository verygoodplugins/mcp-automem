import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AGENT_CLIENTS,
  DEFAULT_AGENT_CLIENTS,
  InstallError,
  buildInstallPlan,
  detectInstallEnvironment,
  formatEnvValue,
  formatInstallError,
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

  it('plans Claude Code as a plugin manual step by default (no settings write)', () => {
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
        commandExists: () => true,
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
});

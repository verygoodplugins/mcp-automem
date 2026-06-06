import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { applyHermesSetup } from './hermes.js';

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(() => {
      throw new Error('mocked: hermes binary not available');
    }),
  };
});

describe('hermes setup handler', () => {
  let tmpDir: string;
  let originalHermesHome: string | undefined;
  let originalApiUrl: string | undefined;
  let originalApiKey: string | undefined;
  let originalEndpoint: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-handler-'));
    originalHermesHome = process.env.HERMES_HOME;
    originalApiUrl = process.env.AUTOMEM_API_URL;
    originalApiKey = process.env.AUTOMEM_API_KEY;
    originalEndpoint = process.env.AUTOMEM_ENDPOINT;
    delete process.env.HERMES_HOME;
    delete process.env.AUTOMEM_API_URL;
    delete process.env.AUTOMEM_API_KEY;
    // Clear the legacy alias too — a developer shell exporting it would
    // otherwise win over recovered credentials and make these tests flaky.
    delete process.env.AUTOMEM_ENDPOINT;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('HERMES_HOME', originalHermesHome);
    restore('AUTOMEM_API_URL', originalApiUrl);
    restore('AUTOMEM_API_KEY', originalApiKey);
    restore('AUTOMEM_ENDPOINT', originalEndpoint);
    vi.clearAllMocks();
  });

  it('fresh install writes config.yaml and AGENTS.md', async () => {
    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      apiKey: 'sk-test',
      quiet: true,
    });

    const configPath = path.join(tmpDir, 'config.yaml');
    const agentsPath = path.join(tmpDir, 'AGENTS.md');

    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(agentsPath)).toBe(true);

    const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
      mcp_servers: Record<
        string,
        {
          command: string;
          env: Record<string, string>;
          tools: { include: string[]; resources: boolean; prompts: boolean };
          sampling: { enabled: boolean };
        }
      >;
    };
    expect(parsed.mcp_servers.automem.command).toBe('npx');
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_URL).toBe('http://127.0.0.1:8001');
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_KEY).toBe('sk-test');
    expect(parsed.mcp_servers.automem.tools.include).toEqual([
      'recall_memory',
      'store_memory',
      'associate_memories',
      'update_memory',
      'check_database_health',
    ]);
    expect(parsed.mcp_servers.automem.tools.resources).toBe(false);
    expect(parsed.mcp_servers.automem.tools.prompts).toBe(false);
    expect(parsed.mcp_servers.automem.sampling.enabled).toBe(false);
    expect(parsed.mcp_servers.memory).toBeUndefined();

    const agents = fs.readFileSync(agentsPath, 'utf8');
    expect(agents).toContain('<!-- BEGIN AUTOMEM HERMES RULES -->');
    expect(agents).toContain('<!-- END AUTOMEM HERMES RULES -->');
    expect(agents).toContain('MCP-only mode');
    expect(agents).toContain('mcp_automem_recall_memory');
    expect(agents).not.toMatch(/`automem_recall_memory`/);
    expect(agents).not.toContain('mcp__memory__recall_memory');
    expect(agents).toContain('test-project');
  });

  it('re-running is idempotent (no second-run diff)', async () => {
    const opts = {
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      apiKey: 'sk-test',
      quiet: true,
    };

    await applyHermesSetup(opts);
    const configPath = path.join(tmpDir, 'config.yaml');
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    const configAfterFirst = fs.readFileSync(configPath, 'utf8');
    const agentsAfterFirst = fs.readFileSync(agentsPath, 'utf8');

    await applyHermesSetup(opts);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(configAfterFirst);
    expect(fs.readFileSync(agentsPath, 'utf8')).toBe(agentsAfterFirst);
  });

  it('--dry-run writes nothing', async () => {
    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      apiKey: 'sk-test',
      dryRun: true,
      quiet: true,
    });

    expect(fs.existsSync(path.join(tmpDir, 'config.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(false);
  });

  it('HERMES_HOME env var resolves the install location', async () => {
    process.env.HERMES_HOME = tmpDir;
    await applyHermesSetup({
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      quiet: true,
    });

    expect(fs.existsSync(path.join(tmpDir, 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
  });

  it('direct YAML path is exercised when Hermes CLI is unavailable', async () => {
    // The child_process mock at the top of this file makes every execSync throw,
    // which simulates a missing Hermes binary. A successful write to config.yaml
    // here means the YAML fallback was exercised.
    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.mcp_servers.automem).toBeDefined();
    expect(parsed.mcp_servers.memory).toBeUndefined();
  });

  it('honors $AUTOMEM_API_URL and $AUTOMEM_API_KEY when no flags are passed', async () => {
    process.env.AUTOMEM_API_URL = 'https://example.automem.test';
    process.env.AUTOMEM_API_KEY = 'sk-from-env';

    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      mcp_servers: Record<string, { env: Record<string, string> }>;
    };
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_URL).toBe('https://example.automem.test');
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_KEY).toBe('sk-from-env');
  });

  it('preserves installed credentials on a re-run with no flags or env', async () => {
    // First install with an explicit remote endpoint + key.
    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://remote.automem.test',
      apiKey: 'sk-remote',
      quiet: true,
    });

    // Re-run with zero flags. beforeEach already cleared AUTOMEM_API_URL/KEY,
    // so without preservation the endpoint would collapse to the local default
    // and the key would be dropped.
    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      mcp_servers: Record<string, { env: Record<string, string> }>;
    };
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_URL).toBe('https://remote.automem.test');
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_KEY).toBe('sk-remote');
  });

  it('explicit flags override previously installed credentials', async () => {
    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://old.automem.test',
      apiKey: 'sk-old',
      quiet: true,
    });

    await applyHermesSetup({
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://new.automem.test',
      apiKey: 'sk-new',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      mcp_servers: Record<string, { env: Record<string, string> }>;
    };
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_URL).toBe('https://new.automem.test');
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_KEY).toBe('sk-new');
  });

  it('mcp re-run after a provider install recovers credentials from .env', async () => {
    // Provider mode writes credentials only to ~/.hermes/.env (no mcp_servers
    // entry), so the recovery path here exercises the .env reader.
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://remote.automem.test',
      apiKey: 'sk-remote',
      quiet: true,
    });

    await applyHermesSetup({
      mode: 'mcp',
      targetDir: tmpDir,
      projectName: 'test-project',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      mcp_servers: Record<string, { env: Record<string, string> }>;
    };
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_URL).toBe('https://remote.automem.test');
    expect(parsed.mcp_servers.automem.env.AUTOMEM_API_KEY).toBe('sk-remote');
  });

  it('provider mode installs the Hermes memory provider without MCP tools', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://example.automem.test',
      apiKey: 'sk-provider',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      memory: { provider: string };
      mcp_servers?: Record<string, unknown>;
    };
    expect(parsed.memory.provider).toBe('automem');
    expect(parsed.mcp_servers?.automem).toBeUndefined();

    const pluginRoot = path.join(tmpDir, 'plugins', 'automem');
    expect(fs.readFileSync(path.join(pluginRoot, '__init__.py'), 'utf8')).toContain(
      'class AutoMemMemoryProvider'
    );
    expect(fs.readFileSync(path.join(pluginRoot, 'plugin.yaml'), 'utf8')).toContain(
      'name: automem'
    );
    expect(fs.readFileSync(path.join(pluginRoot, 'plugin.yaml'), 'utf8')).toContain(
      'kind: exclusive'
    );
    expect(fs.readFileSync(path.join(pluginRoot, 'cli.py'), 'utf8')).toContain(
      'def register_cli'
    );
    expect(fs.readFileSync(path.join(pluginRoot, 'cli.py'), 'utf8')).toContain(
      'doctor'
    );
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')).toContain(
      'AUTOMEM_API_URL=https://example.automem.test'
    );
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')).toContain(
      'AUTOMEM_API_KEY=sk-provider'
    );
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')).not.toContain(
      'AUTOMEM_HERMES_PROVIDER_TOOLS=false'
    );

    const agents = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Provider-only mode');
    expect(agents).toContain('automem_recall_memory');
    expect(agents).not.toContain('mcp_automem_recall_memory');
  });

  it('mcp mode removes AutoMem provider state from a prior provider install', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://example.automem.test',
      apiKey: 'sk-provider',
      quiet: true,
    });

    await applyHermesSetup({
      mode: 'mcp',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://example.automem.test',
      apiKey: 'sk-mcp',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      memory?: { provider?: string };
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.memory?.provider).not.toBe('automem');
    expect(parsed.mcp_servers.automem).toBeDefined();
    expect(parsed.mcp_servers.memory).toBeUndefined();
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')).not.toContain(
      'AUTOMEM_HERMES_PROVIDER_TOOLS=true'
    );
  });

  it('provider mode removes AutoMem MCP state from a prior MCP install', async () => {
    await applyHermesSetup({
      mode: 'mcp',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://example.automem.test',
      apiKey: 'sk-mcp',
      quiet: true,
    });

    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://example.automem.test',
      apiKey: 'sk-provider',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      memory: { provider: string };
      mcp_servers?: Record<string, unknown>;
    };
    expect(parsed.memory.provider).toBe('automem');
    expect(parsed.mcp_servers?.automem).toBeUndefined();
    expect(parsed.mcp_servers?.memory).toBeUndefined();
  });

  it('both mode installs the provider and MCP entry', async () => {
    await applyHermesSetup({
      mode: 'both',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      memory: { provider: string };
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.memory.provider).toBe('automem');
    expect(parsed.mcp_servers.automem).toBeDefined();
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')).toContain(
      'AUTOMEM_HERMES_PROVIDER_TOOLS=false'
    );
    expect(fs.readFileSync(path.join(tmpDir, 'plugins', 'automem', '__init__.py'), 'utf8')).toContain(
      'AUTOMEM_HERMES_PROVIDER_TOOLS'
    );

    const agents = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Both mode');
    expect(agents).toContain('mcp_automem_recall_memory');
    expect(agents).toContain('provider explicit tools are disabled');
    expect(agents).not.toMatch(/`automem_recall_memory`/);
  });

  it('removes stale AutoMem Codex rules from Hermes AGENTS.md', async () => {
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      [
        '# Existing Hermes Rules',
        '',
        '<!-- BEGIN AUTOMEM CODEX RULES -->',
        'Stale Codex guidance says use mcp__memory__recall_memory.',
        '<!-- END AUTOMEM CODEX RULES -->',
        '',
        'Keep this unrelated Hermes rule.',
      ].join('\n'),
    );

    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      projectName: 'test-project',
      endpoint: 'https://example.automem.test',
      quiet: true,
    });

    const agents = fs.readFileSync(agentsPath, 'utf8');
    expect(agents).toContain('# Existing Hermes Rules');
    expect(agents).toContain('Keep this unrelated Hermes rule.');
    expect(agents).toContain('<!-- BEGIN AUTOMEM HERMES RULES -->');
    expect(agents).toContain('Provider-only mode');
    expect(agents).not.toContain('<!-- BEGIN AUTOMEM CODEX RULES -->');
    expect(agents).not.toContain('mcp__memory__recall_memory');
  });
});

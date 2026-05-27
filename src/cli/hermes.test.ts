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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-handler-'));
    originalHermesHome = process.env.HERMES_HOME;
    originalApiUrl = process.env.AUTOMEM_API_URL;
    originalApiKey = process.env.AUTOMEM_API_KEY;
    delete process.env.HERMES_HOME;
    delete process.env.AUTOMEM_API_URL;
    delete process.env.AUTOMEM_API_KEY;
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
      mcp_servers: Record<string, { command: string; env: Record<string, string> }>;
    };
    expect(parsed.mcp_servers.memory.command).toBe('npx');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('http://127.0.0.1:8001');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-test');

    const agents = fs.readFileSync(agentsPath, 'utf8');
    expect(agents).toContain('<!-- BEGIN AUTOMEM CODEX RULES -->');
    expect(agents).toContain('<!-- END AUTOMEM CODEX RULES -->');
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

  it('YAML fallback path is exercised when Hermes CLI is unavailable', async () => {
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
    expect(parsed.mcp_servers.memory).toBeDefined();
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
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://example.automem.test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-from-env');
  });
});

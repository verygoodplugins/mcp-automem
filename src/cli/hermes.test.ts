import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { applyHermesSetup } from './hermes.js';
import {
  createTempHome,
  expectFilesUnchanged,
  expectNoFiles,
  expectOutsideRealHermesHome,
  listBackups,
  readFiles,
  readMcpServerSummary,
} from '../../tests/cli/integration-helpers.js';

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
    tmpDir = createTempHome('hermes-handler-').home;
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
    expectOutsideRealHermesHome([configPath, agentsPath]);

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
    const afterFirst = readFiles([configPath, agentsPath]);

    await applyHermesSetup(opts);
    expectFilesUnchanged(afterFirst);
    expect(listBackups(configPath)).toEqual([]);
    expect(listBackups(agentsPath)).toEqual([]);
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

    const paths = [path.join(tmpDir, 'config.yaml'), path.join(tmpDir, 'AGENTS.md')];
    expectOutsideRealHermesHome(paths);
    expectNoFiles(paths);
  });

  it('HERMES_HOME env var resolves the install location', async () => {
    process.env.HERMES_HOME = tmpDir;
    await applyHermesSetup({
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      quiet: true,
    });

    const paths = [path.join(tmpDir, 'config.yaml'), path.join(tmpDir, 'AGENTS.md')];
    expectOutsideRealHermesHome(paths);
    expect(fs.existsSync(paths[0])).toBe(true);
    expect(fs.existsSync(paths[1])).toBe(true);
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

    expect(readMcpServerSummary(path.join(tmpDir, 'config.yaml'))).toMatchObject({
      memory: {
        command: 'npx',
        args: ['-y', '@verygoodplugins/mcp-automem'],
        envKeys: ['AUTOMEM_API_URL'],
      },
    });
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

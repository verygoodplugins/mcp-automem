import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml } from 'smol-toml';
import { applyGrokSetup, GROK_RULES_END, GROK_RULES_START } from './grok.js';

describe('grok setup', () => {
  let tmpDir: string;
  let originalGrokHome: string | undefined;
  let originalApiUrl: string | undefined;
  let originalApiKey: string | undefined;
  let originalEndpoint: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-setup-'));
    originalGrokHome = process.env.GROK_HOME;
    originalApiUrl = process.env.AUTOMEM_API_URL;
    originalApiKey = process.env.AUTOMEM_API_KEY;
    originalEndpoint = process.env.AUTOMEM_ENDPOINT;
    process.env.GROK_HOME = tmpDir;
    delete process.env.AUTOMEM_API_URL;
    delete process.env.AUTOMEM_API_KEY;
    delete process.env.AUTOMEM_ENDPOINT;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = originalGrokHome;
    if (originalApiUrl === undefined) delete process.env.AUTOMEM_API_URL;
    else process.env.AUTOMEM_API_URL = originalApiUrl;
    if (originalApiKey === undefined) delete process.env.AUTOMEM_API_KEY;
    else process.env.AUTOMEM_API_KEY = originalApiKey;
    if (originalEndpoint === undefined) delete process.env.AUTOMEM_ENDPOINT;
    else process.env.AUTOMEM_ENDPOINT = originalEndpoint;
  });

  it('writes mcp_servers.memory and AGENTS.md rules', async () => {
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      apiKey: 'sk-test',
      quiet: true,
      projectName: 'demo-project',
    });

    const configPath = path.join(tmpDir, 'config.toml');
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(agentsPath)).toBe(true);

    const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
      mcp_servers: {
        memory: { command: string; env: Record<string, string> };
      };
    };
    expect(parsed.mcp_servers.memory.command).toBe('npx');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://automem.example.test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_PROCESS_TAG).toBe('grok:memory');

    const agents = fs.readFileSync(agentsPath, 'utf8');
    expect(agents).toContain(GROK_RULES_START);
    expect(agents).toContain(GROK_RULES_END);
    expect(agents).toContain('demo-project');
    expect(agents).toContain('memory__recall_memory');
  });

  it('preserves existing credentials on re-run without flags', async () => {
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      apiKey: 'sk-persist',
      quiet: true,
      projectName: 'demo',
    });

    await applyGrokSetup({ quiet: true, projectName: 'demo' });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://automem.example.test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-persist');
  });

  it('dry-run does not write files', async () => {
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      dryRun: true,
      quiet: true,
      projectName: 'demo',
    });
    expect(fs.existsSync(path.join(tmpDir, 'config.toml'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(false);
  });

  it('dry-run does not claim files were written', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      await applyGrokSetup({
        endpoint: 'https://automem.example.test',
        dryRun: true,
        projectName: 'demo',
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('[DRY RUN]');
    expect(output).toContain('Dry run — no files were changed.');
    // The success report belongs to real runs only.
    expect(output).not.toContain('written to');
    expect(output).not.toContain('rules installed in');
    expect(output).not.toContain('setup complete');
  });

  it('warns when disabled_mcp_servers would keep Grok from loading AutoMem', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.toml'),
      ['disabled_mcp_servers = ["memory", "wordpress"]', ''].join('\n')
    );

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      await applyGrokSetup({ endpoint: 'https://automem.example.test', projectName: 'demo' });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('listed in disabled_mcp_servers');
    expect(output).toContain('Grok will not load it');
  });

  it('stays quiet about disabled_mcp_servers when memory is not in the list', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.toml'),
      ['disabled_mcp_servers = ["wordpress"]', ''].join('\n')
    );

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      await applyGrokSetup({ endpoint: 'https://automem.example.test', projectName: 'demo' });
    } finally {
      console.log = originalLog;
    }

    expect(lines.join('\n')).not.toContain('disabled_mcp_servers');
  });
});

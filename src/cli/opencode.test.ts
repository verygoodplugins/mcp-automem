import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyOpenCodeSetup, mergeOpenCodeConfig } from './opencode.js';

const MEMORY_SERVER = {
  type: 'local',
  command: ['npx', '-y', '@verygoodplugins/mcp-automem'],
  enabled: true,
  environment: { AUTOMEM_API_URL: 'http://127.0.0.1:8001' },
};

describe('mergeOpenCodeConfig', () => {
  it('creates a fresh config with schema when none exists', () => {
    const merged = JSON.parse(mergeOpenCodeConfig(null, MEMORY_SERVER));
    expect(merged.$schema).toBe('https://opencode.ai/config.json');
    expect(merged.mcp.memory).toEqual(MEMORY_SERVER);
  });

  it('preserves unrelated keys and other MCP servers', () => {
    const existing = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      plugin: ['./plugins/my-plugin.js'],
      mcp: { other: { type: 'remote', url: 'https://example.com' } },
    });
    const merged = JSON.parse(mergeOpenCodeConfig(existing, MEMORY_SERVER));
    expect(merged.plugin).toEqual(['./plugins/my-plugin.js']);
    expect(merged.mcp.other).toEqual({ type: 'remote', url: 'https://example.com' });
    expect(merged.mcp.memory).toEqual(MEMORY_SERVER);
  });

  it('replaces an existing mcp.memory entry', () => {
    const existing = JSON.stringify({
      mcp: { memory: { type: 'local', command: ['stale'], enabled: false } },
    });
    const merged = JSON.parse(mergeOpenCodeConfig(existing, MEMORY_SERVER));
    expect(merged.mcp.memory).toEqual(MEMORY_SERVER);
  });

  it('throws on unparseable or non-object existing config', () => {
    expect(() => mergeOpenCodeConfig('{not json', MEMORY_SERVER)).toThrow();
    expect(() => mergeOpenCodeConfig('[1,2]', MEMORY_SERVER)).toThrow();
  });

  it('treats an empty file as a fresh config', () => {
    const merged = JSON.parse(mergeOpenCodeConfig('', MEMORY_SERVER));
    expect(merged.mcp.memory).toEqual(MEMORY_SERVER);
  });
});

describe('applyOpenCodeSetup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-opencode-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function paths() {
    return {
      configPath: path.join(tmpDir, 'opencode.json'),
      rulesPath: path.join(tmpDir, 'AGENTS.md'),
    };
  }

  it('writes config and rules into empty targets', async () => {
    const { configPath, rulesPath } = paths();
    await applyOpenCodeSetup({
      configPath,
      rulesPath,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      quiet: true,
    });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcp.memory.command).toEqual(['npx', '-y', '@verygoodplugins/mcp-automem']);
    expect(config.mcp.memory.environment.AUTOMEM_API_URL).toBe('http://127.0.0.1:8001');
    expect(config.mcp.memory.environment.AUTOMEM_API_KEY).toBeUndefined();

    const rules = fs.readFileSync(rulesPath, 'utf8');
    expect(rules).toContain('<!-- BEGIN AUTOMEM OPENCODE RULES -->');
    expect(rules).toContain('<!-- END AUTOMEM OPENCODE RULES -->');
    expect(rules).toContain('test-project');
    expect(rules).not.toContain('{{PROJECT_NAME}}');
  });

  it('is idempotent: re-run replaces the marked block instead of appending', async () => {
    const { configPath, rulesPath } = paths();
    const options = {
      configPath,
      rulesPath,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      quiet: true,
    };
    await applyOpenCodeSetup(options);
    fs.writeFileSync(rulesPath, `# My rules\n\n${fs.readFileSync(rulesPath, 'utf8')}`, 'utf8');
    await applyOpenCodeSetup(options);

    const rules = fs.readFileSync(rulesPath, 'utf8');
    expect(rules.match(/BEGIN AUTOMEM OPENCODE RULES/g)?.length).toBe(1);
    expect(rules.startsWith('# My rules'));
  });

  it('includes the API key in environment only when provided', async () => {
    const { configPath, rulesPath } = paths();
    await applyOpenCodeSetup({
      configPath,
      rulesPath,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      apiKey: 'secret-key',
      quiet: true,
    });
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcp.memory.environment.AUTOMEM_API_KEY).toBe('secret-key');
  });

  it('dry-run writes nothing', async () => {
    const { configPath, rulesPath } = paths();
    await applyOpenCodeSetup({
      configPath,
      rulesPath,
      projectName: 'test-project',
      endpoint: 'http://127.0.0.1:8001',
      dryRun: true,
      quiet: true,
    });
    expect(fs.existsSync(configPath)).toBe(false);
    expect(fs.existsSync(rulesPath)).toBe(false);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCursorSetup } from './cursor.js';

describe('Cursor setup', () => {
  let root: string;
  let home: string;
  let project: string;
  let configPath: string;
  let hooksPath: string;
  let rulePath: string;

  const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const server = (endpoint = 'https://old.example.test', key = 'old-test-key') => ({
    command: 'npx',
    args: ['-y', '@verygoodplugins/mcp-automem'],
    env: { AUTOMEM_API_URL: endpoint, AUTOMEM_API_KEY: key },
  });
  const setup = (options: Parameters<typeof applyCursorSetup>[0] = {}) =>
    applyCursorSetup({ projectDir: project, quiet: true, skipPrompts: true, ...options });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-cursor-'));
    home = path.join(root, 'home');
    project = path.join(root, 'project with spaces');
    fs.mkdirSync(project, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AUTOMEM_') || key.startsWith('CLAUDE_PLUGIN_OPTION_')) {
        vi.stubEnv(key, undefined);
      }
    }
    configPath = path.join(home, '.cursor', 'mcp.json');
    hooksPath = path.join(project, '.cursor', 'hooks.json');
    rulePath = path.join(project, '.cursor', 'rules', 'automem.mdc');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('installs an authenticated MCP registration, always-on rules, and sessionStart hook', async () => {
    await setup({ endpoint: 'https://new.example.test', apiKey: 'test-key', projectName: 'demo' });
    expect(read(configPath).mcpServers.memory).toMatchObject({
      command: 'npx',
      args: ['-y', '@verygoodplugins/mcp-automem'],
      env: {
        AUTOMEM_API_URL: 'https://new.example.test',
        AUTOMEM_API_KEY: 'test-key',
        AUTOMEM_API_TOKEN: '',
      },
    });
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    const rule = fs.readFileSync(rulePath, 'utf8');
    expect(rule).toContain('alwaysApply: true');
    expect(rule).toContain('mcp_memory_recall_memory');
    expect(rule).not.toMatch(/{{[A-Z_]+}}/);
    const hooks = read(hooksPath);
    expect(hooks.version).toBe(1);
    expect(hooks.hooks.sessionStart).toHaveLength(1);
    expect(hooks.hooks.sessionStart[0].command).toContain('automem-session-start.mjs');
    expect(hooks.hooks).not.toHaveProperty('stop');
  });

  it('preserves user config and hooks, reuses a verified custom server, and is idempotent', async () => {
    const other = { command: 'other-tool', args: [] };
    write(configPath, { preference: true, mcpServers: { other, 'my-memory': server() } });
    const userHook = { command: 'node custom.js' };
    write(hooksPath, { version: 1, hooks: { sessionStart: [userHook], stop: [userHook] } });
    await setup();
    const config = read(configPath);
    expect(config.preference).toBe(true);
    expect(config.mcpServers.other).toEqual(other);
    expect(Object.keys(config.mcpServers)).toEqual(['other', 'my-memory']);
    expect(config.mcpServers['my-memory'].env.AUTOMEM_API_KEY).toBe('old-test-key');
    expect(fs.readFileSync(rulePath, 'utf8')).toContain('mcp_my_memory_recall_memory');
    expect(read(hooksPath).hooks.sessionStart).toHaveLength(2);
    expect(read(hooksPath).hooks.sessionStart[0]).toEqual(userHook);
    expect(read(hooksPath).hooks.stop).toEqual([userHook]);
    const before = fs.readdirSync(path.dirname(configPath)).sort();
    const configBefore = fs.readFileSync(configPath, 'utf8');
    const hookBefore = fs.readFileSync(hooksPath, 'utf8');
    await setup();
    expect(fs.readdirSync(path.dirname(configPath)).sort()).toEqual(before);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(configBefore);
    expect(fs.readFileSync(hooksPath, 'utf8')).toBe(hookBefore);
    for (const name of before.filter((name) => name.includes('.bak'))) {
      expect(fs.statSync(path.join(path.dirname(configPath), name)).mode & 0o777).toBe(0o600);
    }
  });

  it('never carries stored credentials to a different endpoint', async () => {
    write(configPath, { mcpServers: { memory: server() } });
    await setup({ endpoint: 'https://new.example.test' });
    expect(read(configPath).mcpServers.memory.env).toMatchObject({
      AUTOMEM_API_URL: 'https://new.example.test',
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
    });
  });

  it('uses legacy environment credentials when their endpoint is selected', async () => {
    vi.stubEnv('AUTOMEM_ENDPOINT', 'https://legacy.example.test');
    vi.stubEnv('AUTOMEM_API_TOKEN', 'legacy-test-token');
    await setup();
    expect(read(configPath).mcpServers.memory.env).toMatchObject({
      AUTOMEM_API_URL: 'https://legacy.example.test',
      AUTOMEM_API_KEY: 'legacy-test-token',
      AUTOMEM_API_TOKEN: '',
    });
  });

  it('does not inherit an environment key for an explicit different endpoint', async () => {
    vi.stubEnv('AUTOMEM_API_URL', 'https://env.example.test');
    vi.stubEnv('AUTOMEM_API_KEY', 'env-test-key');
    await setup({ endpoint: 'https://explicit.example.test' });
    expect(read(configPath).mcpServers.memory.env.AUTOMEM_API_KEY).toBe('');
  });

  it.each([
    ['name collision', { mcpServers: { memory: { command: 'unrelated' } } }],
    ['multiple registrations', { mcpServers: { first: server(), second: server() } }],
    ['invalid root', []],
    ['invalid servers', { mcpServers: [] }],
  ])('rejects %s before writing project files', async (_name, config) => {
    write(configPath, config);
    const original = fs.readFileSync(configPath, 'utf8');
    await expect(setup()).rejects.toThrow();
    expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
    expect(fs.existsSync(path.join(project, '.cursor'))).toBe(false);
  });

  it('rejects malformed global JSON without repairing or writing project files', async () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{invalid');
    await expect(setup()).rejects.toThrow();
    expect(fs.readFileSync(configPath, 'utf8')).toBe('{invalid');
    expect(fs.existsSync(path.join(project, '.cursor'))).toBe(false);
  });

  it.each([
    { mcpServers: { memory: { command: 'unrelated' } } },
    { mcpServers: { local: server() } },
  ])('rejects a conflicting project registration before global writes', async (config) => {
    write(path.join(project, '.cursor', 'mcp.json'), config);
    await expect(setup()).rejects.toThrow();
    expect(fs.existsSync(configPath)).toBe(false);
    expect(fs.existsSync(rulePath)).toBe(false);
  });

  it.each(['not JSON', '[]', '{"version":1,"hooks":[]}'])(
    'rejects malformed hook config (%s) atomically',
    async (content) => {
      fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
      fs.writeFileSync(hooksPath, content);
      await expect(setup()).rejects.toThrow();
      expect(fs.readFileSync(hooksPath, 'utf8')).toBe(content);
      expect(fs.existsSync(configPath)).toBe(false);
      expect(fs.existsSync(rulePath)).toBe(false);
    }
  );

  it('refreshes rule content even when its template version is unchanged', async () => {
    await setup();
    const expected = fs.readFileSync(rulePath, 'utf8');
    fs.writeFileSync(rulePath, `${expected}\nSTALE SAME VERSION\n`);
    await setup();
    expect(fs.readFileSync(rulePath, 'utf8')).toBe(expected);
  });

  it('supports a custom rule directory while placing hooks in the project', async () => {
    const targetDir = path.join(project, 'custom rules');
    await setup({ targetDir });
    expect(fs.existsSync(path.join(targetDir, 'automem.mdc'))).toBe(true);
    expect(fs.existsSync(hooksPath)).toBe(true);
    expect(fs.existsSync(rulePath)).toBe(false);
  });

  it('performs a completely mutation-free dry run', async () => {
    await setup({ endpoint: 'https://preview.example.test', apiKey: 'preview-key', dryRun: true });
    expect(fs.existsSync(home)).toBe(false);
    expect(fs.readdirSync(project)).toEqual([]);
  });

  it('serializes hostile project names as context without evaluating injected JavaScript', async () => {
    const projectName = 'demo"; process.stdout.write("INJECTED"); //\n` ${process.exit(99)} $&';
    await setup({ projectName });
    const script = path.join(project, '.cursor', 'hooks', 'automem-session-start.mjs');
    const run = spawnSync(process.execPath, [script], {
      input: '{}',
      encoding: 'utf8',
      cwd: project,
      timeout: 5_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const output = JSON.parse(run.stdout);
    expect(Object.keys(output)).toEqual(['additional_context']);
    expect(output.additional_context).toContain(projectName);
    expect(output.additional_context).toContain('mcp_memory_recall_memory');
  });

  it('runs the portable session-start script with JSON output and harmless malformed input', async () => {
    await setup();
    const script = path.join(project, '.cursor', 'hooks', 'automem-session-start.mjs');
    for (const input of ['{}', 'malformed JSON', '']) {
      const run = spawnSync(process.execPath, [script], {
        input,
        encoding: 'utf8',
        cwd: project,
        timeout: 5_000,
      });
      expect(run.status, run.stderr).toBe(0);
      const output = JSON.parse(run.stdout);
      if (input === '{}') {
        expect(typeof output.additional_context).toBe('string');
        expect(output.additional_context).toContain('recall');
        expect(output.additional_context).toContain('mcp_memory_recall_memory');
      } else {
        expect(output).toEqual({});
      }
    }
  });
});

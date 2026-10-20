import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCursorSetup } from '../../src/cli/cursor.js';
import { HOST_SMOKE_SPECS } from '../helpers/host-specs.js';
import { fakeMemoryId, startFakeAutoMemApi, StdioMcpClient } from '../helpers/host-smoke.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const runFile = promisify(execFile);
const hasCursorAgent =
  spawnSync('cursor-agent', ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
  }).status === 0;
const TOOL_NAMES = HOST_SMOKE_SPECS.find((spec) => spec.host === 'cursor')!.expectedToolNames;

describe('Cursor MCP host boundary', () => {
  let root: string;
  let home: string;
  let project: string;
  let configPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-cursor-host-'));
    home = path.join(root, 'home');
    project = path.join(root, 'workspace with spaces');
    fs.mkdirSync(project, { recursive: true });
    configPath = path.join(home, '.cursor', 'mcp.json');
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('AUTOMEM_') || name.startsWith('CLAUDE_PLUGIN_OPTION_')) {
        vi.stubEnv(name, undefined);
      }
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('starts the configured stdio process and forwards selected credentials to AutoMem', async () => {
    const api = await startFakeAutoMemApi();
    let client: StdioMcpClient | undefined;
    try {
      await applyCursorSetup({
        projectDir: project,
        endpoint: api.url,
        apiKey: 'cursor-smoke-key',
        quiet: true,
        skipPrompts: true,
      });
      const entry = JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.memory;
      expect(entry.command).toBe('npx');
      expect(entry.args).toEqual(['-y', '@verygoodplugins/mcp-automem']);
      expect(entry.env.AUTOMEM_API_URL).toBe(api.url);
      expect(entry.env.AUTOMEM_API_KEY).toBe('cursor-smoke-key');
      // Substitute only the published launcher with this checkout's entry point.
      const local = {
        command: process.execPath,
        args: ['--import', import.meta.resolve('tsx'), path.join(REPO_ROOT, 'src/index.ts')],
      };
      client = new StdioMcpClient(
        local.command,
        local.args,
        { ...process.env, HOME: home, ...entry.env },
        project
      );
      await client.initialize();
      const listed = (await client.request('tools/list')) as { tools: Array<{ name: string }> };
      const names = listed.tools.map((tool) => tool.name);
      expect([...names].sort()).toEqual([...TOOL_NAMES].sort());
      expect(new Set(names).size).toBe(6);
      const health = (await client.request('tools/call', {
        name: 'check_database_health',
        arguments: {},
      })) as { structuredContent: { status: string } };
      expect(health.structuredContent.status).toBe('healthy');
      const stored = (await client.request('tools/call', {
        name: 'store_memory',
        arguments: { content: 'Cursor host smoke memory', tags: ['host-smoke'] },
      })) as { structuredContent: { memory_id: string } };
      expect(stored.structuredContent.memory_id).toBe(fakeMemoryId(1));
      await client.request('tools/call', {
        name: 'recall_memory',
        arguments: { query: 'Cursor host smoke', limit: 1 },
      });
      expect(api.requests.map((request) => request.path.split('?')[0])).toEqual([
        '/health',
        '/memory',
        '/recall',
      ]);
      expect(
        api.requests.every((request) => request.authorization === 'Bearer cursor-smoke-key')
      ).toBe(true);
      expect(client.invalidStdoutLines).toEqual([]);
    } finally {
      await client?.close();
      await api.close();
    }
  }, 20_000);

  it.runIf(hasCursorAgent)(
    'discovers all six tools through the installed cursor-agent CLI in an isolated home',
    async () => {
      const api = await startFakeAutoMemApi();
      try {
        await applyCursorSetup({
          projectDir: project,
          endpoint: api.url,
          apiKey: 'cursor-cli-key',
          quiet: true,
          skipPrompts: true,
        });
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        Object.assign(config.mcpServers.memory, {
          command: process.execPath,
          args: ['--import', import.meta.resolve('tsx'), path.join(REPO_ROOT, 'src/index.ts')],
        });
        fs.writeFileSync(configPath, JSON.stringify(config));
        const env: NodeJS.ProcessEnv = {
          PATH: process.env.PATH,
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: path.join(home, '.config'),
          XDG_CACHE_HOME: path.join(home, '.cache'),
          XDG_DATA_HOME: path.join(home, '.local', 'share'),
          TMPDIR: os.tmpdir(),
          NO_COLOR: '1',
          TERM: 'dumb',
        };
        const options = { env, cwd: project, timeout: 25_000, maxBuffer: 1024 * 1024 };
        await runFile('cursor-agent', ['mcp', 'enable', 'memory'], options);
        const listed = await runFile('cursor-agent', ['mcp', 'list-tools', 'memory'], options);
        // CLI discovery exposes server-local names; IDE/provider prefixing is a separate boundary.
        const names = [...listed.stdout.matchAll(/^- ([A-Za-z_]+) \(/gm)].map((match) => match[1]);
        expect(names.sort()).toEqual([...TOOL_NAMES].sort());
        expect(new Set(names).size).toBe(6);
        expect(
          api.requests.every((request) => request.authorization === 'Bearer cursor-cli-key')
        ).toBe(true);
      } finally {
        await api.close();
      }
    },
    60_000
  );
});

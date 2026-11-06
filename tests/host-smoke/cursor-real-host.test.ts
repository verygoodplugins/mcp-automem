import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { applyCursorSetup } from '../../src/cli/cursor.js';
import { cursorPluginConnectionPath, installCursorPlugin } from '../../src/cli/cursor-plugin.js';
import { HOST_SMOKE_SPECS } from '../helpers/host-specs.js';
import { fakeMemoryId, startFakeAutoMemApi, StdioMcpClient } from '../helpers/host-smoke.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const runFile = promisify(execFile);
// Cursor's own plugin loader (the parser Grok Bot bundles). The cursor-agent CLI does not
// load ~/.cursor/plugins/local (verified on 2026.04.15: it reports no MCP servers for a
// plugin-only install), so this is the host boundary available outside the IDE.
const CURSOR_PLUGIN_LOADER =
  '/Applications/Cursor.app/Contents/Resources/app/molten/dist/engine/plugins-loader.cjs';
const hasCursorAgent =
  spawnSync('cursor-agent', ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
  }).status === 0;
const TOOL_NAMES = HOST_SMOKE_SPECS.find((spec) => spec.host === 'cursor')!.expectedToolNames;
const PLUGIN_TOOL_NAMES = HOST_SMOKE_SPECS.find(
  (spec) => spec.host === 'cursor-plugin'
)!.expectedToolNames;

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

  it('guided install forwards the selected endpoint and key into Cursor configuration', async () => {
    const api = await startFakeAutoMemApi();
    try {
      const result = await runFile(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          path.join(REPO_ROOT, 'src/index.ts'),
          'install',
          '--target',
          'existing',
          '--endpoint',
          api.url,
          '--api-key',
          'guided-cursor-test-key',
          '--clients',
          'cursor',
          '--cursor-mode',
          'files',
          '--yes',
        ],
        {
          cwd: project,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            USERPROFILE: home,
            NO_COLOR: '1',
            TERM: 'dumb',
          },
          timeout: 20_000,
        }
      );
      const entry = JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.memory;
      expect(entry.env.AUTOMEM_API_URL).toBe(api.url);
      expect(entry.env.AUTOMEM_API_KEY).toBe('guided-cursor-test-key');
      expect(
        fs.existsSync(path.join(project, '.cursor', 'hooks', 'automem-session-start.mjs'))
      ).toBe(true);
      expect(fs.existsSync(path.join(project, '.cursor', 'rules', 'automem.mdc'))).toBe(true);
      expect(result.stdout + result.stderr).not.toContain('guided-cursor-test-key');
      expect(
        api.requests.some(
          (request) =>
            request.path.startsWith('/recall') &&
            request.authorization === 'Bearer guided-cursor-test-key'
        )
      ).toBe(true);
    } finally {
      await api.close();
    }
  }, 25_000);

  it('plugin-mode guided install configures the local plugin and leaves mcp.json untouched', async () => {
    const api = await startFakeAutoMemApi();
    try {
      // A pre-existing file install (AutoMem entry) next to a foreign server.
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const seeded = `${JSON.stringify(
        {
          mcpServers: {
            memory: {
              command: 'npx',
              args: ['-y', '@verygoodplugins/mcp-automem'],
              env: { AUTOMEM_API_URL: 'http://old.example' },
            },
            other: { command: 'other-mcp' },
          },
        },
        null,
        2
      )}\n`;
      fs.writeFileSync(configPath, seeded);
      const result = await runFile(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          path.join(REPO_ROOT, 'src/index.ts'),
          'install',
          '--target',
          'existing',
          '--endpoint',
          api.url,
          '--api-key',
          'guided-plugin-key',
          '--clients',
          'cursor',
          '--cursor-mode',
          'plugin',
          '--yes',
        ],
        {
          cwd: project,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            USERPROFILE: home,
            NO_COLOR: '1',
            TERM: 'dumb',
          },
          timeout: 20_000,
        }
      );
      const output = result.stdout + result.stderr;
      const pluginDir = path.join(home, '.cursor', 'plugins', 'local', 'automem');
      expect(fs.lstatSync(pluginDir).isDirectory()).toBe(true);
      expect(fs.lstatSync(pluginDir).isSymbolicLink()).toBe(false);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(pluginDir, '.cursor-plugin', 'plugin.json'), 'utf8')
      );
      expect(manifest.name).toBe('automem');
      expect([...manifest.mcpServers.memory.enabledTools].sort()).toEqual(PLUGIN_TOOL_NAMES);
      expect(JSON.parse(fs.readFileSync(cursorPluginConnectionPath(home), 'utf8'))).toEqual({
        endpoint: api.url,
        apiKey: 'guided-plugin-key',
      });
      expect(JSON.stringify(manifest)).not.toContain('guided-plugin-key');
      expect(output).not.toContain('guided-plugin-key');
      // --yes never removes the file install; it warns with the uninstall command.
      expect(fs.readFileSync(configPath, 'utf8')).toBe(seeded);
      expect(output).toMatch(/twice/i);
      expect(output).toContain('npx @verygoodplugins/mcp-automem@latest uninstall cursor');
      expect(output).not.toContain('Customize → Automem → Configure');
      expect(output).not.toMatch(/restart cursor/i);
      // No project-level file-mode artifacts.
      expect(fs.existsSync(path.join(project, '.cursor', 'rules'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.cursor', 'hooks.json'))).toBe(false);
      await runFile(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          path.join(REPO_ROOT, 'src/index.ts'),
          'uninstall',
          'cursor',
          '--yes',
        ],
        {
          cwd: project,
          env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
          timeout: 20_000,
        }
      );
      expect(fs.existsSync(pluginDir)).toBe(false);
      expect(fs.existsSync(cursorPluginConnectionPath(home))).toBe(false);
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.other).toEqual({
        command: 'other-mcp',
      });
    } finally {
      await api.close();
    }
  }, 25_000);

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
      expect(entry.args).toEqual(['-y', '@verygoodplugins/mcp-automem@latest']);
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

  it.runIf(fs.existsSync(CURSOR_PLUGIN_LOADER))(
    'runs the configured local plugin through the real Cursor loader without exposing its key',
    async () => {
      const api = await startFakeAutoMemApi();
      let client: StdioMcpClient | undefined;
      try {
        const apiKey = 'plugin-${env:OTHER_KEY}-"quoted"';
        installCursorPlugin({
          homeDir: home,
          quiet: true,
          connection: { endpoint: api.url, apiKey },
        });
        const { loadPlugins } = createRequire(import.meta.url)(CURSOR_PLUGIN_LOADER);
        const loaded = await loadPlugins({ roots: [], home, backend: null, userLocal: true });
        expect(loaded.failures).toEqual([]);
        expect(loaded.plugins).toHaveLength(1);
        const server = loaded.plugins[0].mcpConfig.mcpServers.memory;
        expect(server.command).toBe('npx');
        expect(server.args).toEqual(['-y', '@verygoodplugins/mcp-automem@latest']);
        expect(server.env.AUTOMEM_CONNECTION_FILE).toBe(cursorPluginConnectionPath(home));
        expect(server.env.AUTOMEM_API_KEY).toBe('');
        expect(server.env.AUTOMEM_CURSOR_REVISION).toEqual(expect.any(String));
        expect(JSON.stringify(server)).not.toContain(apiKey);
        expect(JSON.stringify(server)).not.toContain(api.url);

        // Replace only npx, preserving Cursor's actual command, arguments and environment.
        const bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
        const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
        const envProbe = path.join(root, 'npx-env-probe');
        fs.writeFileSync(
          path.join(bin, 'npx'),
          `#!/bin/sh\nif [ -z "$AUTOMEM_API_KEY" ] && [ -z "$AUTOMEM_API_TOKEN" ]; then echo empty > "$FAKE_ENV_PROBE"; else echo present > "$FAKE_ENV_PROBE"; fi\nexec ${quote(process.execPath)} --import ${quote(import.meta.resolve('tsx'))} ${quote(path.join(REPO_ROOT, 'src/index.ts'))}\n`,
          { mode: 0o755 }
        );
        client = new StdioMcpClient(
          server.command,
          server.args,
          {
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            HOME: home,
            ...server.env,
            FAKE_ENV_PROBE: envProbe,
            DOTENV_CONFIG_QUIET: 'true',
          },
          project
        );
        await client.initialize();
        expect(fs.readFileSync(envProbe, 'utf8').trim()).toBe('empty');
        const listed = (await client.request('tools/list')) as { tools: Array<{ name: string }> };
        const enabled = new Set<string>(server.enabledTools);
        const visible = listed.tools.map((tool) => tool.name).filter((name) => enabled.has(name));
        expect([...visible].sort()).toEqual(PLUGIN_TOOL_NAMES);
        expect(new Set(visible).size).toBe(visible.length);
        await client.request('tools/call', { name: 'check_database_health', arguments: {} });
        expect(api.requests.every((request) => request.authorization === `Bearer ${apiKey}`)).toBe(
          true
        );
        expect(client.invalidStdoutLines).toEqual([]);

        await client.close();
        client = undefined;
        const before = api.requests.length;
        fs.writeFileSync(path.join(project, '.env'), 'AUTOMEM_API_TOKEN=stale-file-key\n');
        installCursorPlugin({ homeDir: home, quiet: true, connection: { endpoint: api.url } });
        const reloaded = await loadPlugins({ roots: [], home, backend: null, userLocal: true });
        const unauthed = reloaded.plugins[0].mcpConfig.mcpServers.memory;
        expect(unauthed.env.AUTOMEM_CURSOR_REVISION).not.toBe(server.env.AUTOMEM_CURSOR_REVISION);
        client = new StdioMcpClient(
          unauthed.command,
          unauthed.args,
          {
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            HOME: home,
            ...unauthed.env,
            FAKE_ENV_PROBE: envProbe,
            AUTOMEM_API_TOKEN: 'stale-shell-key',
            CLAUDE_PLUGIN_OPTION_API_KEY: 'stale-claude-key',
            DOTENV_CONFIG_QUIET: 'true',
          },
          project
        );
        await client.initialize();
        await client.request('tools/call', { name: 'check_database_health', arguments: {} });
        expect(api.requests.slice(before).length).toBeGreaterThan(0);
        expect(api.requests.slice(before).every((request) => !request.authorization)).toBe(true);
        await client.close();
        client = undefined;
        const requestsBeforeMissing = api.requests.length;
        fs.rmSync(cursorPluginConnectionPath(home));
        const failed = spawnSync(
          process.execPath,
          ['--import', import.meta.resolve('tsx'), path.join(REPO_ROOT, 'src/index.ts')],
          {
            cwd: project,
            encoding: 'utf8',
            timeout: 10_000,
            env: {
              PATH: process.env.PATH,
              HOME: home,
              AUTOMEM_CONNECTION_FILE: cursorPluginConnectionPath(home),
              AUTOMEM_API_URL: api.url,
              AUTOMEM_API_KEY: 'stale-key',
            },
          }
        );
        expect(failed.status).toBe(1);
        expect(failed.stdout).toBe('');
        expect(failed.stderr).toContain('connection file is missing or invalid');
        expect(failed.stderr).not.toContain('stale-key');
        expect(api.requests.length).toBe(requestsBeforeMissing);
      } finally {
        await client?.close();
        await api.close();
      }
    },
    30_000
  );

  it.runIf(fs.existsSync(CURSOR_PLUGIN_LOADER))(
    'loads the installer-copied plugin through Cursor and exposes only the enabled tools',
    async () => {
      const api = await startFakeAutoMemApi();
      let client: StdioMcpClient | undefined;
      try {
        installCursorPlugin({ homeDir: home, quiet: true });
        // What Cursor → Customize → Automem → Configure supplies to the variables form.
        vi.stubEnv('AUTOMEM_API_URL', api.url);
        vi.stubEnv('AUTOMEM_API_KEY', 'cursor-plugin-key');
        const { loadPlugins } = createRequire(import.meta.url)(CURSOR_PLUGIN_LOADER);
        const loaded = await loadPlugins({ roots: [], home, backend: null, userLocal: true });
        expect(loaded.failures).toEqual([]);
        expect(loaded.plugins).toHaveLength(1);
        const servers = loaded.plugins[0].mcpConfig.mcpServers;
        expect(Object.keys(servers)).toEqual(['memory']);
        const server = servers.memory;
        expect(server.command).toBe('npx');
        expect(server.args).toEqual(['-y', '@verygoodplugins/mcp-automem@latest']);
        expect(server.env).toEqual({
          AUTOMEM_API_URL: api.url,
          AUTOMEM_API_KEY: 'cursor-plugin-key',
        });
        // Substitute only the published launcher with this checkout's entry point.
        client = new StdioMcpClient(
          process.execPath,
          ['--import', import.meta.resolve('tsx'), path.join(REPO_ROOT, 'src/index.ts')],
          { PATH: process.env.PATH, HOME: home, ...server.env, DOTENV_CONFIG_QUIET: 'true' },
          project
        );
        await client.initialize();
        const listed = (await client.request('tools/list')) as { tools: Array<{ name: string }> };
        const enabled = new Set<string>(server.enabledTools);
        // The provider payload is the server's tools filtered by the host's enabledTools.
        const visible = listed.tools.map((tool) => tool.name).filter((name) => enabled.has(name));
        expect([...visible].sort()).toEqual(PLUGIN_TOOL_NAMES);
        expect(new Set(visible).size).toBe(visible.length);
        expect(visible).not.toContain('delete_memory');
        await client.request('tools/call', { name: 'check_database_health', arguments: {} });
        expect(
          api.requests.every((request) => request.authorization === 'Bearer cursor-plugin-key')
        ).toBe(true);
        expect(client.invalidStdoutLines).toEqual([]);
      } finally {
        await client?.close();
        await api.close();
      }
    },
    30_000
  );

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

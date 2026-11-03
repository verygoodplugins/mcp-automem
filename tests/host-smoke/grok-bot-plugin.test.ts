import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeMemoryId,
  localMcpServerCommand,
  startFakeAutoMemApi,
  StdioMcpClient,
} from '../helpers/host-smoke.js';

const ROOT = path.resolve(__dirname, '../..');
const PLUGIN = path.join(ROOT, 'plugins/automem');
const MANIFEST_PATH = 'plugins/automem/.cursor-plugin/plugin.json';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), 'utf8'));
// Grok Bot bundles this parser inside its host executable. Cursor also ships it as
// a callable module: exercise the installed host when available, without signing
// in or changing the developer's actual plugin/config directories.
const LOADER =
  '/Applications/Cursor.app/Contents/Resources/app/molten/dist/engine/plugins-loader.cjs';

describe('Grok Bot plugin contract', () => {
  it('ships a branded listing with declared configuration and an optional key', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8')
    );
    expect(manifest.name).toBe('automem');
    expect(manifest.displayName).toBe('AutoMem');
    expect(catalog.plugins[0]).toMatchObject({
      name: manifest.name,
      displayName: manifest.displayName,
      logo: manifest.logo,
    });
    expect(manifest.description).not.toMatch(/deprecated/i);
    expect(fs.readFileSync(path.join(PLUGIN, manifest.logo), 'utf8')).toBe(
      fs.readFileSync(path.join(ROOT, 'assets/icon.svg'), 'utf8')
    );
    expect(manifest.variables.required).toEqual(['AUTOMEM_API_URL']);
    expect(manifest.variables.properties.AUTOMEM_API_URL.default).toBeUndefined();
    expect(manifest.variables.properties.AUTOMEM_API_KEY.default).toBe('');
    expect(manifest.mcpServers.memory.command).toBe('npx');
    expect(manifest.mcpServers.memory.args).toEqual(['-y', '@verygoodplugins/mcp-automem@latest']);
    expect(manifest.mcpServers.memory.env).toEqual({
      AUTOMEM_API_URL: '${AUTOMEM_API_URL}',
      AUTOMEM_API_KEY: '${AUTOMEM_API_KEY:-}',
    });
    const release = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'release-please-config.json'), 'utf8')
    );
    expect(release.packages['.']['extra-files']).toContainEqual({
      type: 'json',
      path: MANIFEST_PATH,
      jsonpath: '$.version',
    });
    expect(manifest.version).toBe(
      JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
    );
    expect(fs.readFileSync(path.join(ROOT, 'INSTALLATION.md'), 'utf8')).toContain('## Grok Bot');
  });

  it('the declared fields reach the stdio server and authenticate every operation', async () => {
    const api = await startFakeAutoMemApi();
    const values: Record<string, string> = {
      AUTOMEM_API_URL: api.url,
      AUTOMEM_API_KEY: 'grok-bot-test-key',
    };
    const env = Object.fromEntries(
      Object.entries(manifest.mcpServers.memory.env as Record<string, string>).map(
        ([key, value]) => [
          key,
          value.replace(
            /\$\{([A-Z_]+)(?::-([^}]*))?\}/g,
            (_, name, fallback) => values[name] ?? fallback ?? ''
          ),
        ]
      )
    );
    const local = localMcpServerCommand(ROOT);
    const client = new StdioMcpClient(
      local.command,
      local.args,
      { PATH: process.env.PATH, ...env, DOTENV_CONFIG_QUIET: 'true' },
      ROOT
    );
    try {
      await client.initialize();
      const listed = await client.request('tools/list');
      const names = listed.tools.map((t: { name: string }) => t.name);
      expect(new Set(names).size).toBe(6);
      for (const enabled of manifest.mcpServers.memory.enabledTools)
        expect(names).toContain(enabled);
      for (const [name, args] of [
        ['check_database_health', {}],
        ['recall_memory', { query: 'grok bot smoke', limit: 1 }],
        ['store_memory', { content: 'Grok Bot plugin smoke', tags: ['smoke'] }],
        ['update_memory', { memory_id: fakeMemoryId(1), importance: 0.8 }],
        [
          'associate_memories',
          {
            memory1_id: fakeMemoryId(1),
            memory2_id: fakeMemoryId(2),
            type: 'RELATES_TO',
            strength: 0.7,
          },
        ],
      ] as const) {
        const result = await client.request('tools/call', { name, arguments: args });
        expect(result.isError).not.toBe(true);
      }
      expect(api.requests.length).toBeGreaterThanOrEqual(5);
      expect(
        api.requests.every((request) => request.authorization === 'Bearer grok-bot-test-key')
      ).toBe(true);
      expect(client.invalidStdoutLines).toEqual([]);
    } finally {
      await client.close();
      await api.close();
    }
  });
});

describe.skipIf(!fs.existsSync(LOADER))('installed Cursor/Grok Bot plugin parser', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-grok-bot-'));
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('AUTOMEM_') || name.startsWith('CLAUDE_PLUGIN_OPTION_'))
        vi.stubEnv(name, undefined);
    }
    const destination = path.join(home, '.cursor/plugins/local/automem');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(PLUGIN, destination, { recursive: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it.each([undefined, 'host-test-key'])(
    'discovers the form and expands the MCP config (key=%s)',
    async (key) => {
      vi.stubEnv('AUTOMEM_API_URL', 'https://automem.example');
      vi.stubEnv('AUTOMEM_API_KEY', key);
      const { loadPlugins } = createRequire(import.meta.url)(LOADER);
      const loaded = await loadPlugins({ roots: [], home, backend: null, userLocal: true });
      expect(loaded.failures).toEqual([]);
      expect(loaded.plugins).toHaveLength(1);
      const plugin = loaded.plugins[0];
      expect(plugin.displayName).toBe('AutoMem');
      expect(plugin.variablesSchema).toEqual(manifest.variables);
      expect(plugin.skills).toHaveLength(1);
      expect(plugin.rules).toHaveLength(1);
      // The manifest's `hooks` key replaces folder discovery, so Claude's translated
      // SessionStart/PostToolUse pair never reaches Cursor or Grok Bot.
      expect(Object.keys(plugin.hooks.config.hooks)).toEqual(['sessionStart']);
      expect(plugin.hooks.sourcePath).toMatch(/\/cursor\/hooks\.json$/);
      expect(plugin.mcpConfig.mcpServers.memory.enabledTools).toEqual(
        manifest.mcpServers.memory.enabledTools
      );
      expect(Object.keys(plugin.mcpConfig.mcpServers)).toEqual(['memory']);
      expect(plugin.mcpConfig.mcpServers.memory.env).toEqual({
        AUTOMEM_API_URL: 'https://automem.example',
        AUTOMEM_API_KEY: key ?? '',
      });
    }
  );
});

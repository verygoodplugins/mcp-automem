/**
 * Grok host boundary: prove the config the installer writes actually produces a
 * working MCP server.
 *
 * Checking the generated TOML alone would miss the failure this integration exists to
 * prevent. Grok can load AutoMem through its Claude/Cursor compat import, which drops
 * the `AUTOMEM_*` env; the server then falls back to http://127.0.0.1:8001 and every
 * session dies with "fetch failed". So this starts a real stdio server using the
 * command and env taken *from the written config*, and drives it against the shared
 * fake AutoMem API.
 *
 * The published `npx` command is asserted rather than executed (running it would hit
 * the network); the local server stands in for the same entry point.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGrokSetup } from '../../src/cli/grok.js';
import {
  localMcpServerCommand,
  startFakeAutoMemApi,
  StdioMcpClient,
} from '../helpers/host-smoke.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

interface GrokServerEntry {
  command: string;
  args: string[];
  enabled: boolean;
  env: Record<string, string>;
}

describe('Grok real host contract', () => {
  let grokHome: string;
  let previousGrokHome: string | undefined;
  let previousApiUrl: string | undefined;
  let previousApiKey: string | undefined;
  let previousEndpoint: string | undefined;

  beforeEach(() => {
    grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-host-smoke-'));
    previousGrokHome = process.env.GROK_HOME;
    previousApiUrl = process.env.AUTOMEM_API_URL;
    previousApiKey = process.env.AUTOMEM_API_KEY;
    previousEndpoint = process.env.AUTOMEM_ENDPOINT;
    process.env.GROK_HOME = grokHome;
    // A leaked real key must never reach the temp config or the assertions below.
    delete process.env.AUTOMEM_API_URL;
    delete process.env.AUTOMEM_API_KEY;
    delete process.env.AUTOMEM_ENDPOINT;
  });

  afterEach(() => {
    fs.rmSync(grokHome, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('GROK_HOME', previousGrokHome);
    restore('AUTOMEM_API_URL', previousApiUrl);
    restore('AUTOMEM_API_KEY', previousApiKey);
    restore('AUTOMEM_ENDPOINT', previousEndpoint);
  });

  it('starts the server from the written config and reaches AutoMem with its env', async () => {
    const fakeApi = await startFakeAutoMemApi();

    try {
      await applyGrokSetup({
        endpoint: fakeApi.url,
        apiKey: 'grok-smoke-key',
        quiet: true,
      });

      const configPath = path.join(grokHome, 'config.toml');
      const config = parseToml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: { memory: GrokServerEntry };
      };
      const entry = config.mcp_servers.memory;

      // The registration Grok will actually read.
      expect(entry.command).toBe('npx');
      expect(entry.args).toEqual(['-y', '@verygoodplugins/mcp-automem']);
      expect(entry.enabled).toBe(true);
      // The env is the whole point: without it the server defaults to localhost:8001.
      expect(entry.env.AUTOMEM_API_URL).toBe(fakeApi.url);
      expect(entry.env.AUTOMEM_API_KEY).toBe('grok-smoke-key');
      expect(entry.env.AUTOMEM_PROCESS_TAG).toBe('grok:memory');

      const localServer = localMcpServerCommand(REPO_ROOT);
      const client = new StdioMcpClient(
        localServer.command,
        localServer.args,
        {
          ...process.env,
          // Exactly what Grok would hand the child process — nothing added.
          ...entry.env,
          AUTOMEM_PARENT_WATCHDOG_MS: '0',
          DOTENV_CONFIG_QUIET: 'true',
        },
        REPO_ROOT
      );

      try {
        await client.initialize();

        const listed = await client.request('tools/list');
        expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual([
          'store_memory',
          'recall_memory',
          'associate_memories',
          'update_memory',
          'delete_memory',
          'check_database_health',
        ]);

        const health = await client.request('tools/call', {
          name: 'check_database_health',
          arguments: {},
        });
        expect(health.structuredContent.status).toBe('healthy');

        const recalled = await client.request('tools/call', {
          name: 'recall_memory',
          arguments: { query: 'grok smoke', limit: 1 },
        });
        expect(recalled.structuredContent.count).toBe(1);

        // stdio must stay clean JSON-RPC or Grok cannot parse the stream at all.
        expect(client.invalidStdoutLines).toEqual([]);
        // The config's endpoint and key are what actually got used.
        expect(fakeApi.requests.length).toBeGreaterThan(0);
        expect(
          fakeApi.requests.every((request) => request.authorization === 'Bearer grok-smoke-key')
        ).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      await fakeApi.close();
    }
  }, 30_000);
});

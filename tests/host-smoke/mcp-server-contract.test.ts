import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  localMcpServerCommand,
  startFakeAutoMemApi,
  StdioMcpClient,
} from '../helpers/host-smoke.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('MCP server real stdio contract', () => {
  it('starts over stdio, lists tools, and calls AutoMem through the fake API', async () => {
    const fakeApi = await startFakeAutoMemApi();
    const localServer = localMcpServerCommand(REPO_ROOT);
    const client = new StdioMcpClient(
      localServer.command,
      localServer.args,
      {
        ...process.env,
        AUTOMEM_API_URL: fakeApi.url,
        AUTOMEM_API_KEY: 'test-key',
        AUTOMEM_PARENT_WATCHDOG_MS: '0',
        DOTENV_CONFIG_QUIET: 'true',
      },
      REPO_ROOT,
    );

    try {
      const initialized = await client.initialize();
      const instructions = initialized.instructions ?? '';
      expect(typeof initialized.instructions).toBe('string');
      expect(instructions.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(instructions, 'utf8')).toBeLessThanOrEqual(2048);

      const listed = await client.request('tools/list');
      const names = listed.tools.map((tool: { name: string }) => tool.name);
      expect(names).toEqual([
        'store_memory',
        'recall_memory',
        'associate_memories',
        'update_memory',
        'delete_memory',
        'check_database_health',
      ]);

      // Claude Code loads tools marked `anthropic/alwaysLoad` upfront instead of
      // deferring them behind ToolSearch; the session-start policy requires these
      // three on every session. CC also truncates descriptions at 2KB under tool
      // search, so every description must stay within that cap.
      const alwaysLoaded = listed.tools
        .filter((tool: { _meta?: Record<string, unknown> }) => tool._meta?.['anthropic/alwaysLoad'] === true)
        .map((tool: { name: string }) => tool.name);
      expect(alwaysLoaded).toEqual(['store_memory', 'recall_memory', 'associate_memories']);
      for (const tool of listed.tools) {
        expect(Buffer.byteLength(tool.description ?? '', 'utf8')).toBeLessThanOrEqual(2048);
      }

      const recallTool = listed.tools.find((tool: { name: string }) => tool.name === 'recall_memory');
      expect(recallTool.inputSchema.properties).toMatchObject({
        state_mode: { type: 'string', enum: ['current', 'history'] },
        recency_bias: { type: 'string', enum: ['auto', 'on', 'off'] },
        scope_fallback: { type: 'boolean' },
        expand_respect_tags: { type: 'boolean' },
        min_score: { type: 'number' },
        adaptive_floor: { type: 'boolean' },
      });

      const associateTool = listed.tools.find(
        (tool: { name: string }) => tool.name === 'associate_memories',
      );
      expect(associateTool.inputSchema.required ?? []).toEqual([]);
      expect(associateTool.inputSchema.properties.associations).toMatchObject({
        type: 'array',
        maxItems: 500,
      });
      expect(associateTool.inputSchema.properties).toMatchObject({
        context: { type: 'string' },
        reason: { type: 'string' },
        resolution: { type: 'string' },
        transformation: { type: 'string' },
      });

      const associationItem =
        associateTool.inputSchema.properties.associations.items.properties;
      expect(associationItem).toMatchObject({
        context: { type: 'string' },
        reason: { type: 'string' },
        observations: { type: 'array' },
      });

      const healthTool = listed.tools.find(
        (tool: { name: string }) => tool.name === 'check_database_health',
      );
      expect(healthTool.outputSchema.properties.status.enum).toEqual([
        'healthy',
        'degraded',
        'error',
      ]);

      const health = await client.request('tools/call', {
        name: 'check_database_health',
        arguments: {},
      });
      expect(health.structuredContent.status).toBe('healthy');

      const stored = await client.request('tools/call', {
        name: 'store_memory',
        arguments: {
          content: 'real stdio smoke memory',
          tags: ['host-smoke'],
          importance: 0.7,
        },
      });
      expect(stored.structuredContent.memory_id).toBe('mem-1');

      const recalled = await client.request('tools/call', {
        name: 'recall_memory',
        arguments: {
          query: 'stdio smoke',
          tags: ['host-smoke'],
          limit: 1,
        },
      });
      expect(recalled.structuredContent.count).toBe(1);

      expect(client.invalidStdoutLines).toEqual([]);
      expect(fakeApi.requests.map((request) => request.path)).toEqual([
        '/health',
        '/memory',
        '/recall?query=stdio+smoke&limit=1&tags=host-smoke',
      ]);
      expect(fakeApi.requests.every((request) => request.authorization === 'Bearer test-key')).toBe(true);
    } finally {
      await client.close();
      await fakeApi.close();
    }
  }, 20_000);
});

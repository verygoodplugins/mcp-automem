import { describe, it, expect } from 'vitest';
import { tools, AUTOMEM_INSTRUCTIONS, createAutoMemMcpServer } from './mcp-surface.js';
import { AutoMemClient } from './automem-client.js';

describe('mcp-surface', () => {
  it('exports the six tools in canonical order', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'store_memory',
      'recall_memory',
      'associate_memories',
      'update_memory',
      'delete_memory',
      'check_database_health',
    ]);
  });

  it('keeps the always-load set to the three primary tools', () => {
    const alwaysLoad = tools
      .filter((t) => (t as { _meta?: Record<string, unknown> })._meta?.['anthropic/alwaysLoad'])
      .map((t) => t.name);
    expect(alwaysLoad).toEqual(['store_memory', 'recall_memory', 'associate_memories']);
  });

  it('gives every tool a title, an outputSchema and annotations', () => {
    for (const tool of tools) {
      expect(tool.title, `${tool.name}.title`).toBeTruthy();
      expect(tool.outputSchema, `${tool.name}.outputSchema`).toBeTruthy();
      expect(tool.annotations, `${tool.name}.annotations`).toBeTruthy();
    }
  });

  it('builds a server without touching process state', () => {
    const client = new AutoMemClient({ endpoint: 'http://127.0.0.1:8001' });
    const server = createAutoMemMcpServer({ client, name: 'test-transport', version: '9.9.9' });
    expect(server).toBeTruthy();
    expect(AUTOMEM_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it('reports the serverInfo it was given, so each transport can differ', () => {
    const client = new AutoMemClient({ endpoint: 'http://127.0.0.1:8001' });
    const a = createAutoMemMcpServer({ client, name: 'automem-mcp-sse', version: '1.0.0' });
    const b = createAutoMemMcpServer({ client, name: 'mcp-automem', version: '0.15.0' });
    expect(a).not.toBe(b);
  });
});

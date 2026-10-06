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

  it('uses UUID-shaped memory ids in every description example', () => {
    // The API validates ids with uuid.UUID(), so a copied "abc123" always errors.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const examples = tools.flatMap((tool) =>
      [...(tool.description ?? '').matchAll(/memory[12]?_id: "([^"]*)"/g)].map((m) => m[1])
    );
    expect(examples.length).toBeGreaterThan(0);
    for (const id of examples) {
      expect(id).toMatch(uuid);
    }
  });

  it('documents the recall limit default per mode instead of one schema default', () => {
    // Ranked recall defaults to 5 server-side, enumeration to 20.
    const recall = tools.find((t) => t.name === 'recall_memory')!;
    const limit = (recall.inputSchema.properties as Record<string, Record<string, unknown>>).limit;
    expect(limit).not.toHaveProperty('default');
    expect(limit.description).toContain('5 in ranked mode and 20 in enumeration mode');
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

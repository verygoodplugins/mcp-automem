import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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

describe('tool errors', () => {
  it('returns a rejected recall as an isError result, not a JSON-RPC error', async () => {
    // `exhaustive: true` without tags rejects inside the client before any request.
    const server = createAutoMemMcpServer({
      client: new AutoMemClient({ endpoint: 'http://127.0.0.1:8001' }),
      name: 'test-transport',
      version: '9.9.9',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: 'recall_memory',
        arguments: { exhaustive: true },
      });
      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Error: recall_memory: `exhaustive: true` requires non-empty `tags`',
          },
        ],
        isError: true,
      });
    } finally {
      await client.close();
    }
  });
});

describe('tools/list size budget', () => {
  // Every byte of tools/list loads into the agent's context on every turn, on both
  // transports (the remote sidecar serves this same array). Each ceiling sits just
  // above the measured size, so growth is a deliberate edit here rather than drift.
  // Sizes are UTF-8 bytes of the compact JSON a client receives.
  const CEILINGS: Record<string, number> = {
    store_memory: 5_250,
    recall_memory: 10_100,
    associate_memories: 5_250,
    update_memory: 2_200,
    delete_memory: 2_000,
    check_database_health: 1_150,
  };
  const TOTAL_CEILING = 25_500;

  it('keeps every tool and the whole list under its byte ceiling', async () => {
    const server = createAutoMemMcpServer({
      client: new AutoMemClient({ endpoint: 'http://127.0.0.1:8001' }),
      name: 'size-budget',
      version: 'test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'size-reader', version: 'test' });
    await client.connect(clientTransport);
    try {
      const { tools: listed } = await client.listTools();
      const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
      const sizes = Object.fromEntries(listed.map((tool) => [tool.name, bytes(tool)]));
      const total = bytes(listed);
      const report = `measured ${JSON.stringify({ ...sizes, total })}`;

      expect(Object.keys(sizes).sort(), report).toEqual(Object.keys(CEILINGS).sort());
      for (const [name, size] of Object.entries(sizes)) {
        expect(size, `${name}: ${report}`).toBeLessThanOrEqual(CEILINGS[name]);
      }
      expect(total, `total: ${report}`).toBeLessThanOrEqual(TOTAL_CEILING);
    } finally {
      await client.close();
    }
  });
});

describe('published tool descriptions', () => {
  it('documents the tag and metadata contracts seen by MCP clients', async () => {
    const server = createAutoMemMcpServer({
      client: new AutoMemClient({ endpoint: 'http://127.0.0.1:8001' }),
      name: 'description-contract',
      version: 'test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'description-reader', version: 'test' });
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      const fieldDescription = (toolName: string, field: string) => {
        const tool = listed.tools.find((candidate) => candidate.name === toolName)!;
        return (tool.inputSchema.properties as Record<string, { description: string }>)[field]
          .description;
      };
      const tagMatch = fieldDescription('recall_memory', 'tag_match');
      expect(tagMatch).toContain('child tags');
      expect(tagMatch).toContain('does not match across hyphens');
      expect(tagMatch).toContain('Enumeration mode is always exact');
      const metadata = fieldDescription('update_memory', 'metadata');
      expect(metadata).toContain('Replaces the stored metadata object');
      expect(metadata).toContain('fetch the memory first and send the full object');
      expect(metadata).not.toContain('merged with existing');
      const tags = fieldDescription('store_memory', 'tags');
      expect(tags).toContain('"bugfix"');
      expect(tags).not.toContain('"bug-fix"');
    } finally {
      await client.close();
    }
  });
});

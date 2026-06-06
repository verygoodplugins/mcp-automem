import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoMemClient } from './automem-client.js';

const mockFetch = vi.fn();

describe('AutoMemClient', () => {
  let client: AutoMemClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    client = new AutoMemClient({
      endpoint: 'http://localhost:8001',
      apiKey: 'test-key',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create client with endpoint', () => {
      const c = new AutoMemClient({ endpoint: 'http://example.com' });
      expect(c).toBeInstanceOf(AutoMemClient);
    });

    it('should create client with endpoint and apiKey', () => {
      const c = new AutoMemClient({
        endpoint: 'http://example.com',
        apiKey: 'secret',
      });
      expect(c).toBeInstanceOf(AutoMemClient);
    });
  });

  describe('storeMemory', () => {
    it('should store memory successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memory_id: 'mem-123', message: 'Memory stored' }),
      } as any);

      const result = await client.storeMemory({
        content: 'Test memory content',
        tags: ['test', 'unit'],
        importance: 0.8,
      });

      expect(result.memory_id).toBe('mem-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/memory',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key',
          },
        })
      );
    });

    it('should include metadata when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memory_id: 'mem-456' }),
      } as any);

      await client.storeMemory({
        content: 'Test',
        metadata: { source: 'test', custom: 'value' },
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.metadata).toEqual({ source: 'test', custom: 'value' });
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' }),
      } as any);

      await expect(client.storeMemory({ content: 'Test' })).rejects.toThrow('Server error');
    });

    it('should supersede an existing memory by storing replacement, patching old state, and associating old to new', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            memory: {
              id: 'old-memory-id',
              content: 'Old memory',
              metadata: { source: 'test', existing: true },
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'new-memory-id', message: 'Memory stored' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'old-memory-id', message: 'Updated' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Association created' }),
        } as any);

      const result = await client.storeMemory({
        content: 'Corrected memory',
        tags: ['project-x', 'correction'],
        metadata: { source: 'replacement' },
        supersedes_memory_id: 'old-memory-id',
        supersede_reason: 'FAMA stale fact correction',
      });

      expect(result.memory_id).toBe('new-memory-id');
      expect(result.superseded_memory_id).toBe('old-memory-id');
      expect(result.association_created).toBe(true);

      const fetchOldCall = mockFetch.mock.calls[0];
      expect(fetchOldCall[0]).toBe('http://localhost:8001/memory/old-memory-id');
      expect(fetchOldCall[1]?.method).toBe('GET');

      const storeCall = mockFetch.mock.calls[1];
      expect(storeCall[0]).toBe('http://localhost:8001/memory');
      expect(JSON.parse(storeCall[1]?.body as string)).toMatchObject({
        content: 'Corrected memory',
        tags: ['project-x', 'correction'],
        metadata: { source: 'replacement' },
      });

      const patchCall = mockFetch.mock.calls[2];
      expect(patchCall[0]).toBe('http://localhost:8001/memory/old-memory-id');
      expect(patchCall[1]?.method).toBe('PATCH');
      const patchBody = JSON.parse(patchCall[1]?.body as string);
      expect(patchBody.t_invalid).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(patchBody.metadata).toEqual({
        source: 'test',
        existing: true,
        deprecated: true,
        superseded_by: 'new-memory-id',
        supersede_relation: 'INVALIDATED_BY',
        supersede_reason: 'FAMA stale fact correction',
      });

      const associateCall = mockFetch.mock.calls[3];
      expect(associateCall[0]).toBe('http://localhost:8001/associate');
      expect(JSON.parse(associateCall[1]?.body as string)).toEqual({
        memory1_id: 'old-memory-id',
        memory2_id: 'new-memory-id',
        type: 'INVALIDATED_BY',
        strength: 0.9,
      });
    });

    it('should support EVOLVED_INTO as a supersede relation', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory: { id: 'old-memory-id', metadata: {} } }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'new-memory-id' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'old-memory-id' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Association created' }),
        } as any);

      await client.storeMemory({
        content: 'Updated concept memory',
        supersedes_memory_id: 'old-memory-id',
        supersede_relation: 'EVOLVED_INTO',
      });

      const associateBody = JSON.parse(mockFetch.mock.calls[3][1]?.body as string);
      expect(associateBody.type).toBe('EVOLVED_INTO');
    });

    it('should prevalidate superseded memory before storing a replacement', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      } as any);

      await expect(
        client.storeMemory({
          content: 'Corrected memory',
          supersedes_memory_id: 'missing-memory-id',
        })
      ).rejects.toThrow('store_memory: superseded memory not found: missing-memory-id');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8001/memory/missing-memory-id');
    });

    it('should report patch failures and clean up the replacement before old memory is updated', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory: { id: 'old-memory-id', metadata: {} } }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'new-memory-id' }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ message: 'Patch failed' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'new-memory-id', message: 'Deleted' }),
        } as any);

      await expect(
        client.storeMemory({
          content: 'Corrected memory',
          supersedes_memory_id: 'old-memory-id',
        })
      ).rejects.toThrow(
        /old_memory_updated=false, association_created=false; replacement cleanup succeeded.*Patch failed/
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:8001/memory/new-memory-id');
      expect(mockFetch.mock.calls[3][1]?.method).toBe('DELETE');
    });

    it('should report association failures without deleting a replacement linked from the old memory', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory: { id: 'old-memory-id', metadata: {} } }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'new-memory-id' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ memory_id: 'old-memory-id', message: 'Updated' }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ message: 'Association failed' }),
        } as any);

      await expect(
        client.storeMemory({
          content: 'Corrected memory',
          supersedes_memory_id: 'old-memory-id',
        })
      ).rejects.toThrow(
        /old_memory_updated=true, association_created=false; replacement cleanup not attempted.*Association failed/
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls.map((call) => call[1]?.method)).not.toContain('DELETE');
    });
  });

  describe('recallMemory', () => {
    it('should recall with query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'mem-1',
              match_type: 'semantic',
              score: 0.95,
              memory: { content: 'Recalled content', tags: ['test'] },
            },
          ],
          count: 1,
        }),
      } as any);

      const result = await client.recallMemory({ query: 'test query' });

      expect(result.count).toBe(1);
      expect(result.results[0].id).toBe('mem-1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('recall?query=test+query'),
        expect.any(Object)
      );
    });

    it('should support multiple queries', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({ queries: ['query1', 'query2'] });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('queries=query1');
      expect(url).toContain('queries=query2');
    });

    it('should support tags filtering', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({ tags: ['project-x', 'bug-fix'], tag_mode: 'all' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('tags=project-x');
      expect(url).toContain('tags=bug-fix');
      expect(url).toContain('tag_mode=all');
    });

    it('should support time query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({ time_query: 'last 7 days' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('time_query=last+7+days');
    });

    it('should support graph expansion options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({
        query: 'test',
        expand_entities: true,
        expand_relations: true,
        auto_decompose: true,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('expand_entities=true');
      expect(url).toContain('expand_relations=true');
      expect(url).toContain('auto_decompose=true');
    });

    it('should forward current-state recall flags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({
        query: 'stale correction',
        current_only: false,
        state_debug: true,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('current_only=false');
      expect(url).toContain('state_debug=true');
    });

    it('should support expansion filtering', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({
        query: 'test',
        expand_relations: true,
        expand_min_importance: 0.5,
        expand_min_strength: 0.3,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('expand_relations=true');
      expect(url).toContain('expand_min_importance=0.5');
      expect(url).toContain('expand_min_strength=0.3');
    });

    it('should support context hints', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({
        query: 'patterns',
        language: 'typescript',
        context: 'coding-style',
        context_types: ['Style', 'Pattern'],
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('language=typescript');
      expect(url).toContain('context=coding-style');
      expect(url).toContain('context_types=Style');
      expect(url).toContain('context_types=Pattern');
    });
  });

  describe('recallMemory — ID fetch mode', () => {
    it('should route memory_id to GET /memory/{id}', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          memory: { id: 'mem-abc', content: 'hello', tags: ['x'], importance: 0.7 },
        }),
      } as any);

      const result = await client.recallMemory({ memory_id: 'mem-abc' });

      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8001/memory/mem-abc');
      expect(mockFetch.mock.calls[0][1]?.method).toBe('GET');
      expect(result.mode).toBe('id_fetch');
      expect(result.count).toBe(1);
      expect(result.results[0].memory.memory_id).toBe('mem-abc');
      expect(result.results[0].memory.content).toBe('hello');
    });

    it('should ignore other params when memory_id is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memory: { id: 'mem-1', content: 'x' } }),
      } as any);

      await client.recallMemory({ memory_id: 'mem-1', query: 'should be ignored', tags: ['x'] });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('http://localhost:8001/memory/mem-1');
      expect(url).not.toContain('query=');
      expect(url).not.toContain('tags=');
    });
  });

  describe('recallMemory — enumeration mode', () => {
    it('should route exhaustive+tags to GET /memory/by-tag', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          tags: ['benchmark'],
          count: 2,
          limit: 20,
          offset: 0,
          has_more: false,
          memories: [
            { id: 'mem-1', content: 'A', tags: ['benchmark'] },
            { id: 'mem-2', content: 'B', tags: ['benchmark'] },
          ],
        }),
      } as any);

      const result = await client.recallMemory({ tags: ['benchmark'], exhaustive: true });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('memory/by-tag');
      expect(url).toContain('tags=benchmark');
      expect(result.mode).toBe('enumeration');
      expect(result.count).toBe(2);
      expect(result.has_more).toBe(false);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.results).toHaveLength(2);
    });

    it('should pass through limit and offset, clamping limit at 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memories: [], count: 0, limit: 200, offset: 100, has_more: false }),
      } as any);

      await client.recallMemory({
        tags: ['x'],
        exhaustive: true,
        limit: 9999,
        offset: 100,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=200');
      expect(url).toContain('offset=100');
    });

    it('should reject exhaustive without tags', async () => {
      await expect(
        client.recallMemory({ exhaustive: true } as any)
      ).rejects.toThrow('non-empty `tags`');
    });

    it('should reject exhaustive + tag_match=prefix', async () => {
      await expect(
        client.recallMemory({
          tags: ['x'],
          exhaustive: true,
          tag_match: 'prefix',
        } as any)
      ).rejects.toThrow('exact tag matching');
    });

    it('should reject exhaustive + tag_mode=all', async () => {
      await expect(
        client.recallMemory({ tags: ['x'], exhaustive: true, tag_mode: 'all' } as any)
      ).rejects.toThrow('any-of tag matching');
    });

    it('should reject exhaustive combined with ranked-only params (e.g., time_query)', async () => {
      await expect(
        client.recallMemory({
          tags: ['x'],
          exhaustive: true,
          time_query: 'last 7 days',
        } as any)
      ).rejects.toThrow(/Remove ranked-only param\(s\): time_query/);
    });

    it('should reject exhaustive combined with multiple ranked-only params at once', async () => {
      await expect(
        client.recallMemory({
          tags: ['x'],
          exhaustive: true,
          query: 'foo',
          exclude_tags: ['y'],
          expand_relations: true,
        } as any)
      ).rejects.toThrow(/query.*exclude_tags.*expand_relations/);
    });

    it('should accept exhaustive + format (format is allowed in enumeration mode)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memories: [], count: 0, has_more: false }),
      } as any);

      await expect(
        client.recallMemory({ tags: ['x'], exhaustive: true, format: 'detailed' } as any)
      ).resolves.toBeDefined();
    });
  });

  describe('recallMemory — exclude_tags', () => {
    it('should emit exclude_tags as repeated query params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      } as any);

      await client.recallMemory({
        query: 'auth',
        exclude_tags: ['deprecated', 'archived'],
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('exclude_tags=deprecated');
      expect(url).toContain('exclude_tags=archived');
    });
  });

  describe('storeMemory — batch mode', () => {
    it('should route memories[] to POST /memory/batch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          stored: 2,
          memory_ids: ['m1', 'm2'],
        }),
      } as any);

      const result = await client.storeMemory({
        memories: [
          { content: 'one', tags: ['x'] },
          { content: 'two', tags: ['x'] },
        ],
      });

      const callArgs = mockFetch.mock.calls[0];
      const url = callArgs[0] as string;
      expect(url).toBe('http://localhost:8001/memory/batch');
      expect(callArgs[1]?.method).toBe('POST');
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.memories).toHaveLength(2);
      expect(body.memories[0].content).toBe('one');
      expect(result.stored).toBe(2);
      expect(result.memory_ids).toEqual(['m1', 'm2']);
    });

    it('should reject empty memories array', async () => {
      await expect(
        client.storeMemory({ memories: [] } as any)
      ).rejects.toThrow('at least one item');
    });

    it('should reject memories array exceeding 500 items', async () => {
      const big = Array.from({ length: 501 }, (_, i) => ({ content: `item ${i}` }));
      await expect(client.storeMemory({ memories: big } as any)).rejects.toThrow('exceeds max 500');
    });

    it('should reject items with disallowed fields (id, embedding, t_valid, t_invalid)', async () => {
      await expect(
        client.storeMemory({
          memories: [{ content: 'x', t_valid: '2026-01-01T00:00:00Z' } as any],
        } as any)
      ).rejects.toThrow('not allowed in batch mode');
      await expect(
        client.storeMemory({ memories: [{ content: 'x', id: 'custom-id' } as any] } as any)
      ).rejects.toThrow('not allowed in batch mode');
      await expect(
        client.storeMemory({ memories: [{ content: 'x', embedding: [0.1, 0.2] } as any] } as any)
      ).rejects.toThrow('not allowed in batch mode');
    });

    it('should reject items with empty content', async () => {
      await expect(
        client.storeMemory({ memories: [{ content: '   ' }] } as any)
      ).rejects.toThrow('content is required');
    });

    it('should reject XOR collision (content + memories)', async () => {
      await expect(
        client.storeMemory({ content: 'single', memories: [{ content: 'one' }] } as any)
      ).rejects.toThrow('Remove top-level single-mode field(s): content');
    });

    it('should reject shared top-level fields in batch mode instead of dropping them', async () => {
      await expect(
        client.storeMemory({
          tags: ['import'],
          importance: 0.8,
          memories: [{ content: 'one' }],
        } as any)
      ).rejects.toThrow('Remove top-level single-mode field(s): tags, importance');
    });

    it('should reject supersede fields in batch mode', async () => {
      await expect(
        client.storeMemory({
          memories: [{ content: 'one' }],
          supersedes_memory_id: 'old-memory-id',
        } as any)
      ).rejects.toThrow('Remove top-level single-mode field(s): supersedes_memory_id');
    });
  });

  describe('associateMemories', () => {
    it('should create association', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Association created' }),
      } as any);

      const result = await client.associateMemories({
        memory1_id: 'mem-1',
        memory2_id: 'mem-2',
        type: 'RELATES_TO',
        strength: 0.9,
      });

      expect(result.success).toBe(true);
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.type).toBe('RELATES_TO');
      expect(body.strength).toBe(0.9);
    });
  });

  describe('updateMemory', () => {
    it('should update memory fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memory_id: 'mem-123', message: 'Updated' }),
      } as any);

      const result = await client.updateMemory({
        memory_id: 'mem-123',
        importance: 0.95,
        tags: ['updated', 'tag'],
      });

      expect(result.memory_id).toBe('mem-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/memory/mem-123',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should URL-encode custom memory IDs when patching', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memory_id: 'custom/id?#', message: 'Updated' }),
      } as any);

      const result = await client.updateMemory({
        memory_id: 'custom/id?#',
        importance: 0.95,
      });

      expect(result.memory_id).toBe('custom/id?#');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/memory/custom%2Fid%3F%23',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should throw if memory_id missing', async () => {
      await expect(client.updateMemory({} as any)).rejects.toThrow('memory_id is required');
    });
  });

  describe('deleteMemory', () => {
    it('should delete memory', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memory_id: 'mem-123', message: 'Deleted' }),
      } as any);

      const result = await client.deleteMemory({ memory_id: 'mem-123' });

      expect(result.memory_id).toBe('mem-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/memory/mem-123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should throw if neither memory_id nor tags provided', async () => {
      await expect(client.deleteMemory({} as any)).rejects.toThrow(
        '`memory_id` or `tags` is required'
      );
    });

    it('should bulk-delete by tag and emit no limit/offset on DELETE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', tags: ['benchmark'], deleted_count: 42 }),
      } as any);

      const result = await client.deleteMemory({ tags: ['benchmark'] });

      expect(result.deleted_count).toBe(42);
      expect(result.tags).toEqual(['benchmark']);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('http://localhost:8001/memory/by-tag?tags=benchmark');
      expect(url).not.toContain('limit=');
      expect(url).not.toContain('offset=');
      expect(mockFetch.mock.calls[0][1]?.method).toBe('DELETE');
    });

    it('should reject when both memory_id and tags are passed', async () => {
      await expect(
        client.deleteMemory({ memory_id: 'mem-1', tags: ['x'] } as any)
      ).rejects.toThrow('not both');
    });

    it('should reject when tags contains only whitespace entries (treated as no input)', async () => {
      await expect(
        client.deleteMemory({ tags: ['', '  '] } as any)
      ).rejects.toThrow('`memory_id` or `tags` is required');
    });
  });

  describe('checkHealth', () => {
    it('should return healthy status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'healthy',
          falkordb: { status: 'connected' },
          qdrant: { status: 'connected' },
        }),
      } as any);

      const result = await client.checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.backend).toBe('automem');
    });

    it('should return error status on failure', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await client.checkHealth();

      expect(result.status).toBe('error');
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('URL handling', () => {
    it('should handle endpoint with trailing slash', async () => {
      const clientWithSlash = new AutoMemClient({ endpoint: 'http://localhost:8001/' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      } as any);

      await clientWithSlash.checkHealth();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/health',
        expect.any(Object)
      );
    });
  });

  describe('Authentication', () => {
    it('should not include auth header when no apiKey', async () => {
      const clientNoKey = new AutoMemClient({ endpoint: 'http://localhost:8001' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      } as any);

      await clientNoKey.checkHealth();

      const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });
  });
});

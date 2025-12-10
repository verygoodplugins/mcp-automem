import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoMemClient } from './automem-client.js';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetch from 'node-fetch';
const mockFetch = vi.mocked(fetch);

describe('AutoMemClient', () => {
  let client: AutoMemClient;

  beforeEach(() => {
    client = new AutoMemClient({
      endpoint: 'http://localhost:8001',
      apiKey: 'test-key',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
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
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' }),
      } as any);

      await expect(client.storeMemory({ content: 'Test' })).rejects.toThrow('Server error');
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

    it('should throw if memory_id missing', async () => {
      await expect(client.deleteMemory({} as any)).rejects.toThrow('memory_id is required');
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
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.checkHealth();

      expect(result.status).toBe('error');
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('searchByTag', () => {
    it('should search by tags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          memories: [{ id: 'mem-1', content: 'Tagged content', tags: ['test'] }],
          count: 1,
        }),
      } as any);

      const result = await client.searchByTag({ tags: ['test'], limit: 10 });

      expect(result.count).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('memory/by-tag?tags=test&limit=10'),
        expect.any(Object)
      );
    });

    it('should throw if no tags provided', async () => {
      await expect(client.searchByTag({ tags: [] })).rejects.toThrow('At least one tag is required');
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



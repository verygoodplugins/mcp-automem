import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  AutoMemConfig,
  MemoryRecord,
  RecallResult,
  HealthStatus,
  StoreMemoryArgs,
  RecallMemoryArgs,
  AssociateMemoryArgs,
  UpdateMemoryArgs,
  DeleteMemoryArgs,
  TagSearchArgs,
} from './types.js';

/**
 * Type safety tests using vitest's expectTypeOf.
 * These tests verify that our types are correctly defined and constrained.
 */

describe('Type Definitions', () => {
  describe('AutoMemConfig', () => {
    it('should require endpoint', () => {
      const config: AutoMemConfig = { endpoint: 'http://localhost:8001' };
      expect(config.endpoint).toBeDefined();
    });

    it('should allow optional apiKey', () => {
      const config: AutoMemConfig = {
        endpoint: 'http://localhost:8001',
        apiKey: 'secret',
      };
      expect(config.apiKey).toBe('secret');
    });

    it('should have correct type structure', () => {
      expectTypeOf<AutoMemConfig>().toMatchTypeOf<{
        endpoint: string;
        apiKey?: string;
      }>();
    });
  });

  describe('StoreMemoryArgs', () => {
    it('should require content', () => {
      const args: StoreMemoryArgs = { content: 'test' };
      expect(args.content).toBe('test');
    });

    it('should allow optional fields', () => {
      const args: StoreMemoryArgs = {
        content: 'test',
        tags: ['tag1', 'tag2'],
        importance: 0.8,
        metadata: { key: 'value' },
        embedding: [0.1, 0.2, 0.3],
        timestamp: '2025-01-01T00:00:00Z',
      };
      expect(args.tags).toHaveLength(2);
      expect(args.importance).toBe(0.8);
    });
  });

  describe('RecallMemoryArgs', () => {
    it('should allow query or queries', () => {
      const withQuery: RecallMemoryArgs = { query: 'test' };
      const withQueries: RecallMemoryArgs = { queries: ['q1', 'q2'] };
      
      expect(withQuery.query).toBe('test');
      expect(withQueries.queries).toHaveLength(2);
    });

    it('should support time filters', () => {
      const args: RecallMemoryArgs = {
        time_query: 'last 7 days',
        start: '2025-01-01',
        end: '2025-01-31',
      };
      expect(args.time_query).toBeDefined();
    });

    it('should support tag filtering', () => {
      const args: RecallMemoryArgs = {
        tags: ['project-x'],
        tag_mode: 'all',
        tag_match: 'prefix',
      };
      expect(args.tag_mode).toBe('all');
      expect(args.tag_match).toBe('prefix');
    });

    it('should support graph expansion', () => {
      const args: RecallMemoryArgs = {
        expand_entities: true,
        expand_relations: true,
        auto_decompose: true,
        expansion_limit: 25,
        relation_limit: 5,
      };
      expect(args.expand_entities).toBe(true);
    });

    it('should support context hints', () => {
      const args: RecallMemoryArgs = {
        context: 'coding-style',
        language: 'typescript',
        active_path: 'src/index.ts',
        context_tags: ['style'],
        context_types: ['Pattern', 'Style'],
        priority_ids: ['mem-1', 'mem-2'],
      };
      expect(args.language).toBe('typescript');
    });
  });

  describe('AssociateMemoryArgs', () => {
    it('should require all fields', () => {
      const args: AssociateMemoryArgs = {
        memory1_id: 'mem-1',
        memory2_id: 'mem-2',
        type: 'RELATES_TO',
        strength: 0.9,
      };
      expect(args.type).toBe('RELATES_TO');
      expect(args.strength).toBe(0.9);
    });

    it('should accept all 11 relationship types', () => {
      const types: AssociateMemoryArgs['type'][] = [
        'RELATES_TO',
        'LEADS_TO',
        'OCCURRED_BEFORE',
        'PREFERS_OVER',
        'EXEMPLIFIES',
        'CONTRADICTS',
        'REINFORCES',
        'INVALIDATED_BY',
        'EVOLVED_INTO',
        'DERIVED_FROM',
        'PART_OF',
      ];
      
      for (const type of types) {
        const args: AssociateMemoryArgs = {
          memory1_id: 'a',
          memory2_id: 'b',
          type,
          strength: 0.5,
        };
        expect(args.type).toBe(type);
      }
    });
  });

  describe('UpdateMemoryArgs', () => {
    it('should require memory_id', () => {
      const args: UpdateMemoryArgs = { memory_id: 'mem-123' };
      expect(args.memory_id).toBe('mem-123');
    });

    it('should allow partial updates', () => {
      const args: UpdateMemoryArgs = {
        memory_id: 'mem-123',
        importance: 0.95,
        // content, tags, metadata are optional
      };
      expect(args.importance).toBe(0.95);
    });
  });

  describe('DeleteMemoryArgs', () => {
    it('should require memory_id', () => {
      const args: DeleteMemoryArgs = { memory_id: 'mem-to-delete' };
      expect(args.memory_id).toBe('mem-to-delete');
    });
  });

  describe('RecallResult', () => {
    it('should have results array and count', () => {
      const result: RecallResult = {
        results: [],
        count: 0,
      };
      expect(result.results).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should include expansion metadata when enabled', () => {
      const result: RecallResult = {
        results: [],
        count: 0,
        expansion: {
          enabled: true,
          seed_count: 5,
          expanded_count: 10,
          relation_limit: 5,
          expansion_limit: 25,
        },
        entity_expansion: {
          enabled: true,
          expanded_count: 3,
          entities_found: ['Amanda', 'Rachel'],
        },
      };
      expect(result.expansion?.enabled).toBe(true);
      expect(result.entity_expansion?.entities_found).toContain('Amanda');
    });
  });

  describe('HealthStatus', () => {
    it('should have status field', () => {
      const healthy: HealthStatus = {
        status: 'healthy',
        backend: 'automem',
        statistics: {},
      };
      expect(healthy.status).toBe('healthy');
    });

    it('should include error when status is error', () => {
      const unhealthy: HealthStatus = {
        status: 'error',
        backend: 'automem',
        statistics: {},
        error: 'Connection refused',
      };
      expect(unhealthy.error).toBe('Connection refused');
    });
  });
});

describe('Type Constraints', () => {
  describe('tag_mode', () => {
    it('should only allow "any" or "all"', () => {
      const anyMode: RecallMemoryArgs = { tag_mode: 'any' };
      const allMode: RecallMemoryArgs = { tag_mode: 'all' };
      
      expect(anyMode.tag_mode).toBe('any');
      expect(allMode.tag_mode).toBe('all');
      
      // This should be a type error if uncommented:
      // const invalidMode: RecallMemoryArgs = { tag_mode: 'invalid' };
    });
  });

  describe('tag_match', () => {
    it('should only allow "exact" or "prefix"', () => {
      const exact: RecallMemoryArgs = { tag_match: 'exact' };
      const prefix: RecallMemoryArgs = { tag_match: 'prefix' };
      
      expect(exact.tag_match).toBe('exact');
      expect(prefix.tag_match).toBe('prefix');
    });
  });
});


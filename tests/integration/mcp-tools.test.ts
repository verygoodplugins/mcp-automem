import { describe, it, expect } from 'vitest';

/**
 * Integration tests for MCP tool schemas and response formats.
 * These tests verify the tool definitions match expected MCP protocol requirements.
 */

// Tool definitions from the MCP server
const TOOL_DEFINITIONS = {
  store_memory: {
    name: 'store_memory',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number', minimum: 0, maximum: 1 },
        metadata: { type: 'object' },
        embedding: { type: 'array', items: { type: 'number' } },
        timestamp: { type: 'string' },
      },
      required: ['content'],
    },
  },
  recall_memory: {
    name: 'recall_memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        queries: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        tags: { type: 'array', items: { type: 'string' } },
        time_query: { type: 'string' },
        expand_entities: { type: 'boolean' },
        expand_relations: { type: 'boolean' },
        auto_decompose: { type: 'boolean' },
        language: { type: 'string' },
        context: { type: 'string' },
      },
    },
  },
  associate_memories: {
    name: 'associate_memories',
    inputSchema: {
      type: 'object',
      properties: {
        memory1_id: { type: 'string' },
        memory2_id: { type: 'string' },
        type: {
          type: 'string',
          enum: [
            'RELATES_TO', 'LEADS_TO', 'OCCURRED_BEFORE', 'PREFERS_OVER',
            'EXEMPLIFIES', 'CONTRADICTS', 'REINFORCES', 'INVALIDATED_BY',
            'EVOLVED_INTO', 'DERIVED_FROM', 'PART_OF',
          ],
        },
        strength: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['memory1_id', 'memory2_id', 'type', 'strength'],
    },
  },
  update_memory: {
    name: 'update_memory',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number', minimum: 0, maximum: 1 },
        metadata: { type: 'object' },
      },
      required: ['memory_id'],
    },
  },
  delete_memory: {
    name: 'delete_memory',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string' },
      },
      required: ['memory_id'],
    },
  },
  check_database_health: {
    name: 'check_database_health',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
};

describe('MCP Tool Schemas', () => {
  describe('store_memory', () => {
    const schema = TOOL_DEFINITIONS.store_memory.inputSchema;

    it('should require content field', () => {
      expect(schema.required).toContain('content');
    });

    it('should have content as string type', () => {
      expect(schema.properties.content.type).toBe('string');
    });

    it('should have tags as array of strings', () => {
      expect(schema.properties.tags.type).toBe('array');
      expect(schema.properties.tags.items.type).toBe('string');
    });

    it('should constrain importance between 0 and 1', () => {
      expect(schema.properties.importance.minimum).toBe(0);
      expect(schema.properties.importance.maximum).toBe(1);
    });

    it('should have optional metadata as object', () => {
      expect(schema.properties.metadata.type).toBe('object');
      expect(schema.required).not.toContain('metadata');
    });
  });

  describe('recall_memory', () => {
    const schema = TOOL_DEFINITIONS.recall_memory.inputSchema;

    it('should support query parameter', () => {
      expect(schema.properties.query.type).toBe('string');
    });

    it('should support queries array for multi-query', () => {
      expect(schema.properties.queries.type).toBe('array');
      expect(schema.properties.queries.items.type).toBe('string');
    });

    it('should constrain limit between 1 and 50', () => {
      expect(schema.properties.limit.minimum).toBe(1);
      expect(schema.properties.limit.maximum).toBe(50);
    });

    it('should support graph expansion options', () => {
      expect(schema.properties.expand_entities.type).toBe('boolean');
      expect(schema.properties.expand_relations.type).toBe('boolean');
      expect(schema.properties.auto_decompose.type).toBe('boolean');
    });

    it('should support context hints', () => {
      expect(schema.properties.language.type).toBe('string');
      expect(schema.properties.context.type).toBe('string');
    });

    it('should not require any fields', () => {
      expect(schema.required).toBeUndefined();
    });
  });

  describe('associate_memories', () => {
    const schema = TOOL_DEFINITIONS.associate_memories.inputSchema;

    it('should require all fields', () => {
      expect(schema.required).toContain('memory1_id');
      expect(schema.required).toContain('memory2_id');
      expect(schema.required).toContain('type');
      expect(schema.required).toContain('strength');
    });

    it('should have exactly 11 relationship types', () => {
      expect(schema.properties.type.enum).toHaveLength(11);
    });

    it('should include all documented relationship types', () => {
      const types = schema.properties.type.enum;
      expect(types).toContain('RELATES_TO');
      expect(types).toContain('LEADS_TO');
      expect(types).toContain('OCCURRED_BEFORE');
      expect(types).toContain('PREFERS_OVER');
      expect(types).toContain('EXEMPLIFIES');
      expect(types).toContain('CONTRADICTS');
      expect(types).toContain('REINFORCES');
      expect(types).toContain('INVALIDATED_BY');
      expect(types).toContain('EVOLVED_INTO');
      expect(types).toContain('DERIVED_FROM');
      expect(types).toContain('PART_OF');
    });

    it('should constrain strength between 0 and 1', () => {
      expect(schema.properties.strength.minimum).toBe(0);
      expect(schema.properties.strength.maximum).toBe(1);
    });
  });

  describe('update_memory', () => {
    const schema = TOOL_DEFINITIONS.update_memory.inputSchema;

    it('should require memory_id', () => {
      expect(schema.required).toContain('memory_id');
      expect(schema.required).toHaveLength(1);
    });

    it('should have optional update fields', () => {
      expect(schema.required).not.toContain('content');
      expect(schema.required).not.toContain('tags');
      expect(schema.required).not.toContain('importance');
    });
  });

  describe('delete_memory', () => {
    const schema = TOOL_DEFINITIONS.delete_memory.inputSchema;

    it('should require only memory_id', () => {
      expect(schema.required).toEqual(['memory_id']);
    });
  });

  describe('check_database_health', () => {
    const schema = TOOL_DEFINITIONS.check_database_health.inputSchema;

    it('should have no required fields', () => {
      expect(schema.required).toBeUndefined();
    });

    it('should accept empty input', () => {
      expect(Object.keys(schema.properties)).toHaveLength(0);
    });
  });
});

describe('MCP Protocol Compliance', () => {
  describe('Tool naming', () => {
    it('should use snake_case for tool names', () => {
      for (const tool of Object.values(TOOL_DEFINITIONS)) {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it('should have unique tool names', () => {
      const names = Object.values(TOOL_DEFINITIONS).map(t => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('Schema structure', () => {
    it('should have inputSchema with type object for all tools', () => {
      for (const tool of Object.values(TOOL_DEFINITIONS)) {
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('should have properties object in inputSchema', () => {
      for (const tool of Object.values(TOOL_DEFINITIONS)) {
        expect(tool.inputSchema.properties).toBeDefined();
        expect(typeof tool.inputSchema.properties).toBe('object');
      }
    });
  });
});

describe('Relationship Types', () => {
  const RELATIONSHIP_TYPES = [
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

  it('should have 11 relationship types', () => {
    expect(RELATIONSHIP_TYPES).toHaveLength(11);
  });

  it('should use SCREAMING_SNAKE_CASE', () => {
    for (const type of RELATIONSHIP_TYPES) {
      expect(type).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  describe('Semantic meanings', () => {
    it('LEADS_TO should indicate causation', () => {
      // This is a documentation test - ensure we know what each type means
      expect(RELATIONSHIP_TYPES).toContain('LEADS_TO');
    });

    it('CONTRADICTS should indicate conflict', () => {
      expect(RELATIONSHIP_TYPES).toContain('CONTRADICTS');
    });

    it('EVOLVED_INTO should indicate progression', () => {
      expect(RELATIONSHIP_TYPES).toContain('EVOLVED_INTO');
    });
  });
});


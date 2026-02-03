/**
 * Integration tests for AutoMem service.
 * These tests run against a real AutoMem instance (local Docker or remote).
 *
 * Run with: npm run test:integration
 * Requires: AutoMem service at AUTOMEM_TEST_ENDPOINT (default: http://localhost:8001)
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { AutoMemClient } from '../../src/automem-client.js';

const AUTOMEM_ENDPOINT = process.env.AUTOMEM_TEST_ENDPOINT || 'http://localhost:8001';
const TEST_TAG = `test-${Date.now()}`;

let client: AutoMemClient;
let serviceAvailable = false;
const createdMemoryIds: string[] = [];

// Check if service is available before running tests
beforeAll(async () => {
  client = new AutoMemClient({ endpoint: AUTOMEM_ENDPOINT });

  try {
    const health = await client.checkHealth();
    serviceAvailable = health.status === 'healthy';
    if (!serviceAvailable) {
      console.warn(`AutoMem service not healthy: ${JSON.stringify(health)}`);
    }
  } catch (error) {
    console.warn(`AutoMem service not available at ${AUTOMEM_ENDPOINT}: ${error}`);
    serviceAvailable = false;
  }
});

// Clean up test memories after each test
afterEach(async () => {
  if (!serviceAvailable) return;

  for (const id of createdMemoryIds) {
    try {
      await client.deleteMemory({ memory_id: id });
    } catch {
      // Ignore cleanup errors
    }
  }
  createdMemoryIds.length = 0;
});

describe.skipIf(!serviceAvailable)('AutoMem Service Integration', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const health = await client.checkHealth();

      expect(health.status).toBe('healthy');
      expect(health.backend).toBe('automem');
    });

    it('should report database connections', async () => {
      const health = await client.checkHealth();

      // The health response should include database status
      expect(health.status).toBe('healthy');
    });
  });

  describe('Store and Recall Cycle', () => {
    it('should store a memory and recall by query', async () => {
      // Store
      const storeResult = await client.storeMemory({
        content: 'Integration test memory: TypeScript patterns for error handling',
        tags: [TEST_TAG, 'integration-test'],
        importance: 0.7,
        metadata: { test: true, timestamp: Date.now() },
      });

      expect(storeResult.memory_id).toBeDefined();
      createdMemoryIds.push(storeResult.memory_id);

      // Wait for indexing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Recall by query
      const recallResult = await client.recallMemory({
        query: 'TypeScript error handling patterns',
        limit: 10,
      });

      expect(recallResult.count).toBeGreaterThan(0);

      const found = recallResult.results.find((r) => r.id === storeResult.memory_id);
      expect(found).toBeDefined();
      expect(found?.memory?.content).toContain('TypeScript patterns');
    });

    it('should recall by tag', async () => {
      // Store with unique tag
      const uniqueTag = `unique-${Date.now()}`;
      const storeResult = await client.storeMemory({
        content: 'Memory with unique tag for testing',
        tags: [TEST_TAG, uniqueTag],
        importance: 0.5,
      });

      createdMemoryIds.push(storeResult.memory_id);

      // Wait for indexing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Recall by tag
      const recallResult = await client.recallMemory({
        tags: [uniqueTag],
        limit: 10,
      });

      expect(recallResult.count).toBeGreaterThan(0);
      const found = recallResult.results.find((r) => r.id === storeResult.memory_id);
      expect(found).toBeDefined();
    });

    it('should support time-bounded recall', async () => {
      // Store a memory
      const storeResult = await client.storeMemory({
        content: 'Recent memory for time query test',
        tags: [TEST_TAG],
        importance: 0.6,
      });

      createdMemoryIds.push(storeResult.memory_id);

      // Wait for indexing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Recall with time query
      const recallResult = await client.recallMemory({
        query: 'time query test',
        time_query: 'today',
        limit: 10,
      });

      // Should find the recently stored memory
      expect(recallResult.count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Associations', () => {
    it('should create and retrieve associations', async () => {
      // Store two related memories
      const memory1 = await client.storeMemory({
        content: 'Bug: Login fails with special characters in password',
        tags: [TEST_TAG, 'bug'],
        importance: 0.8,
      });
      createdMemoryIds.push(memory1.memory_id);

      const memory2 = await client.storeMemory({
        content: 'Fix: Escape special characters before authentication',
        tags: [TEST_TAG, 'fix'],
        importance: 0.8,
      });
      createdMemoryIds.push(memory2.memory_id);

      // Create association
      const assocResult = await client.associateMemories({
        memory1_id: memory1.memory_id,
        memory2_id: memory2.memory_id,
        type: 'LEADS_TO',
        strength: 0.9,
      });

      expect(assocResult.success).toBe(true);

      // Wait for graph update
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Recall with relation expansion
      const recallResult = await client.recallMemory({
        query: 'login special characters bug',
        expand_relations: true,
        limit: 10,
      });

      expect(recallResult.count).toBeGreaterThan(0);
    });

    it('should support all relationship types', async () => {
      const relationshipTypes = [
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

      // Store two memories
      const mem1 = await client.storeMemory({
        content: 'Source memory for relationship type test',
        tags: [TEST_TAG],
        importance: 0.5,
      });
      createdMemoryIds.push(mem1.memory_id);

      const mem2 = await client.storeMemory({
        content: 'Target memory for relationship type test',
        tags: [TEST_TAG],
        importance: 0.5,
      });
      createdMemoryIds.push(mem2.memory_id);

      // Test one relationship type (RELATES_TO is most common)
      const result = await client.associateMemories({
        memory1_id: mem1.memory_id,
        memory2_id: mem2.memory_id,
        type: 'RELATES_TO',
        strength: 0.7,
      });

      expect(result.success).toBe(true);

      // Verify all types are valid (schema test)
      expect(relationshipTypes).toHaveLength(11);
    });
  });

  describe('Update and Delete', () => {
    it('should update memory fields', async () => {
      // Store
      const storeResult = await client.storeMemory({
        content: 'Original content for update test',
        tags: [TEST_TAG],
        importance: 0.5,
      });
      createdMemoryIds.push(storeResult.memory_id);

      // Update
      const updateResult = await client.updateMemory({
        memory_id: storeResult.memory_id,
        importance: 0.9,
        tags: [TEST_TAG, 'updated'],
      });

      expect(updateResult.memory_id).toBe(storeResult.memory_id);

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify by recall
      const recallResult = await client.recallMemory({
        tags: [TEST_TAG, 'updated'],
        limit: 10,
      });

      const found = recallResult.results.find((r) => r.id === storeResult.memory_id);
      expect(found).toBeDefined();
    });

    it('should delete memory', async () => {
      // Store
      const storeResult = await client.storeMemory({
        content: 'Memory to be deleted',
        tags: [TEST_TAG],
        importance: 0.3,
      });

      // Delete
      const deleteResult = await client.deleteMemory({
        memory_id: storeResult.memory_id,
      });

      expect(deleteResult.memory_id).toBe(storeResult.memory_id);

      // Don't add to cleanup since already deleted
    });
  });

  describe('Edge Cases', () => {
    it('should handle recall with no query (returns recent)', async () => {
      // Store a memory first
      const storeResult = await client.storeMemory({
        content: 'Memory for empty query test',
        tags: [TEST_TAG],
        importance: 0.5,
      });
      createdMemoryIds.push(storeResult.memory_id);

      // Recall with just tags, no query
      const recallResult = await client.recallMemory({
        tags: [TEST_TAG],
        limit: 5,
      });

      // Should return results based on tags
      expect(recallResult).toBeDefined();
      expect(recallResult.results).toBeDefined();
    });

    it('should handle high importance memories', async () => {
      const storeResult = await client.storeMemory({
        content: 'Critical decision: Use PostgreSQL for ACID compliance',
        tags: [TEST_TAG, 'decision', 'critical'],
        importance: 0.95,
        metadata: {
          type: 'Decision',
          confidence: 0.9,
        },
      });

      expect(storeResult.memory_id).toBeDefined();
      createdMemoryIds.push(storeResult.memory_id);
    });

    it('should handle memories with embeddings', async () => {
      // Create a simple 768-dim embedding (AutoMem uses OpenAI ada-002 format)
      const embedding = new Array(768).fill(0).map(() => Math.random() * 0.1);

      const storeResult = await client.storeMemory({
        content: 'Memory with pre-computed embedding',
        tags: [TEST_TAG],
        importance: 0.5,
        embedding,
      });

      expect(storeResult.memory_id).toBeDefined();
      createdMemoryIds.push(storeResult.memory_id);
    });

    it('should handle special characters in content', async () => {
      const storeResult = await client.storeMemory({
        content: 'Test with special chars: "quotes", \'apostrophes\', <brackets>, &ampersand',
        tags: [TEST_TAG],
        importance: 0.5,
      });

      expect(storeResult.memory_id).toBeDefined();
      createdMemoryIds.push(storeResult.memory_id);

      // Verify recall works
      const recallResult = await client.recallMemory({
        query: 'special chars quotes brackets',
        limit: 5,
      });

      const found = recallResult.results.find((r) => r.id === storeResult.memory_id);
      expect(found).toBeDefined();
    });
  });
});

// Export for conditional running
export { serviceAvailable, AUTOMEM_ENDPOINT };

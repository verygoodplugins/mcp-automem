/**
 * Integration tests for AutoMem service.
 * These tests run against a real AutoMem instance (local Docker or remote).
 *
 * Run with: npm run test:integration
 * Requires: AutoMem service at AUTOMEM_TEST_API_URL (default: http://localhost:8001).
 * AUTOMEM_TEST_ENDPOINT is the deprecated alias and is still read as a fallback.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { AutoMemClient } from '../../src/automem-client.js';
import { AUTHORABLE_RELATION_TYPES } from '../../src/types.js';

const AUTOMEM_TEST_API_URL =
  process.env.AUTOMEM_TEST_API_URL || process.env.AUTOMEM_TEST_ENDPOINT || 'http://localhost:8001';
const TEST_TAG = `integration-${randomUUID()}`;
const client = new AutoMemClient({
  endpoint: AUTOMEM_TEST_API_URL,
  apiKey: process.env.AUTOMEM_TEST_API_KEY || process.env.AUTOMEM_TEST_API_TOKEN,
  maxRetries: 0,
  timeoutMs: 5000,
});
// Collection-time gating must finish before describe.skipIf is evaluated.
const health = await client.checkHealth({ timeoutMs: 5000, maxRetries: 0 });
const serviceAvailable = health.status === 'healthy';
const required = process.env.AUTOMEM_REQUIRE_SERVICE === '1' || process.env.CI === 'true';
if (!serviceAvailable) {
  const message = `AutoMem integration service unavailable or unhealthy at ${AUTOMEM_TEST_API_URL}`;
  if (required) throw new Error(message);
  console.warn(`${message}; skipping optional local integration suite`);
}
const vectorSize = Number(
  process.env.AUTOMEM_TEST_VECTOR_SIZE ||
    health.statistics.vector_dimensions?.collection ||
    health.statistics.vector_dimensions?.effective ||
    health.statistics.vector_dimensions?.configured ||
    1024
);
if (!Number.isInteger(vectorSize) || vectorSize <= 0) {
  throw new Error('AUTOMEM_TEST_VECTOR_SIZE must be a positive integer');
}
const createdMemoryIds: string[] = [];

async function recallContaining(
  memoryId: string,
  args: Parameters<AutoMemClient['recallMemory']>[0]
) {
  let result = await client.recallMemory(args);
  const deadline = Date.now() + 10_000;
  while (!result.results.some((memory) => memory.id === memoryId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    result = await client.recallMemory(args);
  }
  expect(result.results.map((memory) => memory.id)).toContain(memoryId);
  return result;
}

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

      expect(health.statistics.falkordb).toBe('connected');
      expect(health.statistics.qdrant).toBe('connected');
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

      // Recall by query
      const recallResult = await recallContaining(storeResult.memory_id, {
        tags: [TEST_TAG],
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

      // Recall by tag
      const recallResult = await recallContaining(storeResult.memory_id, {
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

      // Recall with time query
      const recallResult = await recallContaining(storeResult.memory_id, {
        tags: [TEST_TAG],
        query: 'time query test',
        time_query: 'today',
        limit: 10,
      });

      // Should find the recently stored memory
      expect(recallResult.results.some((memory) => memory.id === storeResult.memory_id)).toBe(true);
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

      // Recall with relation expansion
      const recallResult = await recallContaining(memory1.memory_id, {
        tags: [TEST_TAG],
        query: 'Login fails with special characters in password',
        expand_relations: true,
        limit: 10,
      });

      expect(recallResult.results.flatMap((memory) => memory.relations || [])).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'LEADS_TO' })])
      );
      expect(recallResult.results.map((memory) => memory.id)).toContain(memory2.memory_id);
    });

    it('should support all relationship types', async () => {
      const relationshipTypes = [...AUTHORABLE_RELATION_TYPES];

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

      // Verify count and exercise every authorable type against the backend
      expect(relationshipTypes).toHaveLength(11);

      for (const type of relationshipTypes) {
        const result = await client.associateMemories({
          memory1_id: mem1.memory_id,
          memory2_id: mem2.memory_id,
          type,
          strength: 0.7,
        });

        expect(result.success).toBe(true);
      }
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

      // Keep this CRUD check separate from concurrent enrichment/PATCH semantics.
      // A background enrichment job reads the original tags and can still write them back.
      await expect
        .poll(
          async () => {
            const current = await client.checkHealth();
            const enrichment = current.statistics.enrichment;
            return (enrichment?.pending || 0) + (enrichment?.inflight || 0);
          },
          { timeout: 10_000, interval: 100 }
        )
        .toBe(0);

      // Update
      const updateResult = await client.updateMemory({
        memory_id: storeResult.memory_id,
        importance: 0.9,
        tags: [TEST_TAG, 'updated'],
      });

      expect(updateResult.memory_id).toBe(storeResult.memory_id);

      // Verify by recall
      const recallResult = await recallContaining(storeResult.memory_id, {
        tags: [TEST_TAG, 'updated'],
        tag_mode: 'all',
        limit: 10,
      });

      const found = recallResult.results.find((r) => r.id === storeResult.memory_id);
      expect(found?.memory.importance).toBe(0.9);
      expect(found?.memory.tags).toEqual(expect.arrayContaining([TEST_TAG, 'updated']));
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

      const recalled = await client.recallMemory({ memory_id: storeResult.memory_id });
      expect(recalled.results).toHaveLength(0);

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
      const recallResult = await recallContaining(storeResult.memory_id, {
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
      // Use the test service's collection dimension, rather than a historical default.
      const embedding = new Array(vectorSize).fill(1 / Math.sqrt(vectorSize));

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
      const recallResult = await recallContaining(storeResult.memory_id, {
        tags: [TEST_TAG],
        query: 'special chars quotes brackets',
        limit: 5,
      });

      const found = recallResult.results.find((r) => r.id === storeResult.memory_id);
      expect(found).toBeDefined();
    });
  });
});

// Export for conditional running
export { serviceAvailable, AUTOMEM_TEST_API_URL };

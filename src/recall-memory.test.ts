import { describe, expect, it, vi } from 'vitest';
import { buildRecallMemoryResponse } from './recall-memory.js';
import type { RecallMemoryArgs, RecallResult } from './types.js';

function makeRecallResult(overrides: Partial<RecallResult> = {}): RecallResult {
  return {
    results: [
      {
        id: 'mem-1',
        match_type: 'tag',
        final_score: 0.82,
        score_components: { importance: 0.82 },
        memory: {
          memory_id: 'mem-1',
          content: 'Tagged memory',
          tags: ['project-x'],
          importance: 0.82,
          created_at: '2026-03-25T00:00:00Z',
          updated_at: '2026-03-25T01:00:00Z',
          metadata: { source: 'test' },
          type: 'Context',
          confidence: 0.9,
        },
      },
    ],
    count: 1,
    ...overrides,
  };
}

describe('buildRecallMemoryResponse', () => {
  it('calls recallMemory once for tag-filtered recall and preserves backend metadata', async () => {
    const recallArgs: RecallMemoryArgs = {
      tags: ['project-x'],
      tag_mode: 'all',
      tag_match: 'prefix',
      format: 'json',
    };
    const recallResult = makeRecallResult({
      count: 7,
      dedup_removed: 3,
      tags: ['project-x'],
      tag_mode: 'all',
      tag_match: 'prefix',
      entity_expansion: {
        enabled: true,
        expanded_count: 2,
        entities_found: ['project-x'],
      },
      expansion: {
        enabled: true,
        seed_count: 1,
        expanded_count: 1,
        relation_limit: 5,
        expansion_limit: 25,
      },
    });
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, recallArgs);

    expect(client.recallMemory).toHaveBeenCalledTimes(1);
    expect(client.recallMemory).toHaveBeenCalledWith(recallArgs);
    expect(response.structuredContent).toMatchObject({
      count: 7,
      dedup_removed: 3,
      tags: ['project-x'],
      tag_mode: 'all',
      tag_match: 'prefix',
      entity_expansion: recallResult.entity_expansion,
      expansion: recallResult.expansion,
    });
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      count: 7,
      dedup_removed: 3,
      entity_expansion: recallResult.entity_expansion,
      expansion: recallResult.expansion,
    });
  });

  it('returns no-memories text while preserving structured metadata', async () => {
    const client = {
      recallMemory: vi.fn().mockResolvedValue({
        results: [],
        count: 0,
        dedup_removed: 2,
      }),
    };

    const response = await buildRecallMemoryResponse(client, { tags: ['project-x'] });

    expect(response.content).toEqual([
      {
        type: 'text',
        text: 'No memories found matching your query.',
      },
    ]);
    expect(response.structuredContent).toMatchObject({
      results: [],
      count: 0,
      dedup_removed: 2,
    });
  });

  it('keeps non-tag recall behavior unchanged for text output', async () => {
    const client = {
      recallMemory: vi.fn().mockResolvedValue(makeRecallResult()),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'tagged memory' });

    expect(client.recallMemory).toHaveBeenCalledWith({ query: 'tagged memory' });
    expect(response.content[0].text).toContain('Found 1 memories');
    expect(response.content[0].text).toContain('Tagged memory');
    expect(response.structuredContent).toMatchObject({
      count: 1,
      results: [
        {
          memory_id: 'mem-1',
          content: 'Tagged memory',
        },
      ],
    });
  });

  it('surfaces enumeration metadata (mode/has_more/limit/offset) when present', async () => {
    const recallResult = makeRecallResult({
      mode: 'enumeration',
      count: 1,
      limit: 50,
      offset: 50,
      has_more: true,
    });
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, {
      tags: ['benchmark'],
      exhaustive: true,
      limit: 50,
      offset: 50,
    });

    expect(response.structuredContent).toMatchObject({
      mode: 'enumeration',
      has_more: true,
      limit: 50,
      offset: 50,
    });
    expect(response.content[0].text).toContain('enumeration page: offset 50, limit 50');
    expect(response.content[0].text).toContain('more pages available');
  });

  it('omits enumeration metadata fields when result is in ranked mode', async () => {
    const recallResult = makeRecallResult({ mode: 'ranked' });
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'x' });

    expect(response.structuredContent).toMatchObject({ mode: 'ranked' });
    expect(response.structuredContent).not.toHaveProperty('has_more');
    expect(response.structuredContent).not.toHaveProperty('offset');
    expect(response.structuredContent).not.toHaveProperty('limit');
  });
});

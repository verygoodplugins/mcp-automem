import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRecallMemoryResponse,
  DEFAULT_RECALL_TOKEN_BUDGET,
  RECALL_CHARS_PER_TOKEN,
  RECALL_CONTENT_PREVIEW_CHARS,
  RECALL_MAX_RELATIONS,
  RECALL_RELATION_SUMMARY_CHARS,
} from './recall-memory.js';
import type { RecallMemoryArgs, RecallResult } from './types.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A server-shaped relation record as returned inside /recall results. */
function makeRelationRecord(i: number, summaryChars = 200): Record<string, any> {
  return {
    memory: {
      id: `rel-mem-${i}`,
      summary: `r${i} `.padEnd(summaryChars, 's'),
      tags: ['decision', 'mcp-automem', `entity:topics:rel-${i}`],
      timestamp: '2026-06-01T00:00:00.000000+00:00',
      type: 'Decision',
      confidence: 0.9,
      importance: 0.85,
    },
    strength: 0.8,
    type: 'REINFORCES',
  };
}

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

  it('surfaces state-filter diagnostics in structured content and text notes', async () => {
    const stateFilter = {
      current_only: true,
      suppressed_count: 2,
      replacement_count: 1,
      suppressed: [{ memory_id: 'old-1', reason: 'invalidated' }],
      replacements: [{ old_id: 'old-1', new_id: 'new-1' }],
    };
    const client = {
      recallMemory: vi.fn().mockResolvedValue(makeRecallResult({ state_filter: stateFilter })),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'corrections' });

    expect(response.structuredContent).toMatchObject({
      state_filter: stateFilter,
    });
    expect(response.content[0].text).toContain(
      'state filter suppressed 2, replacements 1'
    );
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

  it('previews long content in text format and points at memory_id for the full record', async () => {
    const longContent = 'x'.repeat(RECALL_CONTENT_PREVIEW_CHARS + 500);
    const recallResult = makeRecallResult();
    recallResult.results![0].memory.content = longContent;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'long' });

    const item = (response.structuredContent.results as any[])[0];
    expect(item.content.length).toBe(RECALL_CONTENT_PREVIEW_CHARS + 1); // preview + ellipsis
    expect(item.content.endsWith('…')).toBe(true);
    expect(item.content_truncated).toBe(true);
    expect(item.content_chars).toBe(longContent.length);
    expect(response.content[0].text).not.toContain(longContent);
    expect(response.content[0].text).toContain('memory_id');
  });

  it('never truncates an id fetch', async () => {
    const longContent = 'y'.repeat(RECALL_CONTENT_PREVIEW_CHARS + 2000);
    const recallResult = makeRecallResult({ mode: 'id_fetch' });
    recallResult.results![0].memory.content = longContent;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, { memory_id: 'mem-1' });

    const item = (response.structuredContent.results as any[])[0];
    expect(item.content).toBe(longContent);
    expect(item).not.toHaveProperty('content_truncated');
    expect(response.structuredContent).not.toHaveProperty('truncation');
  });

  it('drops score_components and replaces metadata with metadata_keys in detailed format', async () => {
    const bigMetadata: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      bigMetadata[`key_${i}`] = 'v'.repeat(50);
    }
    const recallResult = makeRecallResult();
    recallResult.results![0].memory.metadata = bigMetadata;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'rich',
      format: 'detailed',
    });

    const item = (response.structuredContent.results as any[])[0];
    expect(item).not.toHaveProperty('score_components');
    expect(item).not.toHaveProperty('metadata');
    expect(item.metadata_keys).toContain('key_0');
    expect(item.metadata_keys).toHaveLength(40);
  });

  it('omits metadata_keys when metadata is empty', async () => {
    const recallResult = makeRecallResult();
    recallResult.results![0].memory.metadata = {};
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'rich',
      format: 'detailed',
    });

    const item = (response.structuredContent.results as any[])[0];
    expect(item).not.toHaveProperty('metadata');
    expect(item).not.toHaveProperty('metadata_keys');
  });

  it('compacts relations to capped stubs and never emits related_to in detailed format', async () => {
    const relations = Array.from({ length: RECALL_MAX_RELATIONS + 3 }, (_, i) =>
      makeRelationRecord(i)
    );
    const recallResult = makeRecallResult();
    (recallResult.results![0] as any).relations = relations;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'rich',
      format: 'detailed',
    });

    const item = (response.structuredContent.results as any[])[0];
    expect(item).not.toHaveProperty('related_to');
    expect(item.relations).toHaveLength(RECALL_MAX_RELATIONS);
    expect(item.relations_total).toBe(RECALL_MAX_RELATIONS + 3);
    for (const stub of item.relations) {
      expect(stub).not.toHaveProperty('memory');
      expect(stub.id).toMatch(/^rel-mem-/);
      expect(stub.type).toBe('REINFORCES');
      expect(stub.strength).toBe(0.8);
      // truncated summary + ellipsis
      expect(stub.summary.length).toBeLessThanOrEqual(RECALL_RELATION_SUMMARY_CHARS + 1);
    }
  });

  it('shows the stored summary instead of content in budgeted formats', async () => {
    const longContent = 'c'.repeat(2000);
    const summary = 'Concise standalone summary of the memory.';
    const recallResult = makeRecallResult();
    recallResult.results![0].memory.content = longContent;
    (recallResult.results![0].memory as any).summary = summary;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'summary first' });

    const item = (response.structuredContent.results as any[])[0];
    expect(item.summary).toBe(summary);
    expect(item).not.toHaveProperty('content');
    expect(item.content_chars).toBe(longContent.length);
    expect(response.content[0].text).toContain(summary);
    expect(response.content[0].text).not.toContain('cccccccccc');
  });

  it('keeps full content, summary, metadata, and raw relation records in json format', async () => {
    const recallResult = makeRecallResult();
    const longContent = 'j'.repeat(1200);
    recallResult.results![0].memory.content = longContent;
    (recallResult.results![0].memory as any).summary = 'json mode summary';
    (recallResult.results![0] as any).relations = [makeRelationRecord(1)];
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'raw',
      format: 'json',
    });

    const item = (response.structuredContent.results as any[])[0];
    expect(item.content).toBe(longContent);
    expect(item.summary).toBe('json mode summary');
    expect(item.metadata).toEqual({ source: 'test' });
    expect(item.relations[0].memory.id).toBe('rel-mem-1');
    expect(item).not.toHaveProperty('related_to');
  });

  it('keeps raw per-field passthrough in json format but still applies the global budget', async () => {
    const bigMetadata = { blob: 'm'.repeat(1300) };
    const manyResults = Array.from({ length: 60 }, (_, i) => ({
      id: `mem-${i}`,
      match_type: 'semantic',
      final_score: 0.5,
      score_components: { importance: 0.5 },
      memory: {
        memory_id: `mem-${i}`,
        content: 'z'.repeat(2000),
        tags: ['big'],
        importance: 0.5,
        created_at: '2026-03-25T00:00:00Z',
        metadata: bigMetadata,
      },
    }));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 60 }),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'big',
      format: 'json',
    });

    const structured = response.structuredContent as any;
    const firstItem = structured.results[0];
    expect(firstItem.content).toHaveLength(2000); // no per-field caps in json
    expect(firstItem.metadata).toEqual(bigMetadata);
    expect(firstItem.score_components).toEqual({ importance: 0.5 });
    expect(structured.results.length).toBeLessThan(60);
    expect(structured.truncation).toMatchObject({
      applied: true,
      reason: 'response_token_budget',
    });
    expect(structured.truncation.omitted_results).toBe(60 - structured.results.length);
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      truncation: { applied: true },
    });
  });

  it('drops trailing results past the global token budget in text format', async () => {
    const manyResults = Array.from({ length: 200 }, (_, i) => ({
      id: `mem-${i}`,
      match_type: 'semantic',
      final_score: 0.5,
      memory: {
        memory_id: `mem-${i}`,
        content: 'w'.repeat(RECALL_CONTENT_PREVIEW_CHARS + 100),
        tags: ['big'],
        importance: 0.5,
        created_at: '2026-03-25T00:00:00Z',
      },
    }));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 200 }),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'big' });

    const structured = response.structuredContent as any;
    expect(structured.results.length).toBeLessThan(200);
    expect(structured.results.length).toBeGreaterThan(0);
    expect(structured.truncation.applied).toBe(true);
    expect(response.content[0].text.length).toBeLessThan(
      DEFAULT_RECALL_TOKEN_BUDGET * RECALL_CHARS_PER_TOKEN
    );
    expect(response.content[0].text).toContain('Response budget: showing');
  });

  it('respects the AUTOMEM_RECALL_TOKEN_BUDGET env override', async () => {
    vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', '1200');
    const manyResults = Array.from({ length: 20 }, (_, i) => ({
      id: `mem-${i}`,
      match_type: 'semantic',
      final_score: 0.5,
      memory: {
        memory_id: `mem-${i}`,
        content: 'v'.repeat(RECALL_CONTENT_PREVIEW_CHARS + 100),
        tags: ['big'],
        importance: 0.5,
        created_at: '2026-03-25T00:00:00Z',
      },
    }));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 20 }),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'big' });

    const structured = response.structuredContent as any;
    // tiny budget: first result always kept, nearly everything else dropped
    expect(structured.results.length).toBeLessThan(5);
    expect(structured.truncation.applied).toBe(true);
    expect(structured.truncation.omitted_results).toBe(20 - structured.results.length);
  });

  it('falls back to the default budget when AUTOMEM_RECALL_TOKEN_BUDGET is not a clean integer', async () => {
    vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', '1200foo');
    const manyResults = Array.from({ length: 20 }, (_, i) => ({
      id: `mem-${i}`,
      match_type: 'semantic',
      final_score: 0.5,
      memory: {
        memory_id: `mem-${i}`,
        content: 'v'.repeat(RECALL_CONTENT_PREVIEW_CHARS + 100),
        tags: ['big'],
        importance: 0.5,
        created_at: '2026-03-25T00:00:00Z',
      },
    }));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 20 }),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'big' });

    // strict parsing rejects "1200foo"; the default 18k budget keeps all 20
    const structured = response.structuredContent as any;
    expect(structured.results).toHaveLength(20);
    expect(structured).not.toHaveProperty('truncation');
  });

  it('fits a real-world session-start recall (fat relations + enrichment metadata) without truncation', async () => {
    // Modeled on the live 2026-06-10 failure: 26 ranked results, mixed relation
    // counts, enrichment metadata, ~400-char contents, 200-char summaries. The
    // old formatter produced ~65k chars from 16 of these and blew the MCP cap.
    const relationCounts = [5, 2, 5, 5, 5, 5, 0, 3, 5, 5, 5, 1, 5, 5, 5, 2, 5, 4, 5, 0, 5, 3, 5, 5, 2, 5];
    const manyResults = relationCounts.map((relCount, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      match_type: 'semantic',
      match_score: 0.42,
      relation_score: 0.1,
      final_score: 0.61,
      score_components: { semantic: 0.42, recency: 0.1, importance: 0.09 },
      relations: Array.from({ length: relCount }, (_, r) => makeRelationRecord(r)),
      memory: {
        memory_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        content: `memory ${i} `.padEnd(400, 'x'),
        summary: `summary ${i} `.padEnd(200, 'y'),
        tags: ['decision', 'mcp-automem', 'typescript', `entity:topics:thing-${i}`],
        importance: 0.8,
        created_at: '2026-05-01T00:00:00.000000+00:00',
        updated_at: '2026-06-01T00:00:00.000000+00:00',
        last_accessed: '2026-06-09T00:00:00.000000+00:00',
        metadata: {
          enrichment: {
            forced: false,
            last_run: '2026-06-01T00:00:00.000000+00:00',
            patterns_detected: ['decision'],
            semantic_neighbors: ['a', 'b', 'c'],
            temporal_links: 2,
          },
          entities: ['mcp-automem', 'claude-code'],
        },
        type: 'Decision',
        confidence: 0.9,
      },
    }));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 26 }),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'session start',
      format: 'detailed',
      limit: 30,
    });

    const structured = response.structuredContent as any;
    expect(structured.results).toHaveLength(26);
    expect(structured).not.toHaveProperty('truncation');
    const totalChars =
      JSON.stringify(response.structuredContent).length +
      response.content.reduce((sum, block) => sum + block.text.length, 0);
    expect(totalChars).toBeLessThanOrEqual(45_000);
  });

  it('surfaces updated_at in text output and the structured base item', async () => {
    const client = {
      recallMemory: vi.fn().mockResolvedValue(makeRecallResult()),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'tagged memory' });

    expect(response.content[0].text).toContain('Updated: 2026-03-25T01:00:00Z');
    const item = (response.structuredContent.results as any[])[0];
    expect(item.updated_at).toBe('2026-03-25T01:00:00Z');
  });
});

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

function makeTypicalPreferenceResult(i: number, relCount = 2) {
  return {
    id: `pref-${i}`,
    match_type: 'tag' as const,
    final_score: 0.7,
    score_components: { importance: 0.7 },
    relations: Array.from({ length: relCount }, (_, r) => makeRelationRecord(r, 80)),
    memory: {
      memory_id: `pref-${i}`,
      content:
        `Preference ${i}. Keep worktrees under .worktrees/ when hub files would change while WIP sits in the main checkout.`.padEnd(
          220,
          ' '
        ),
      summary: `Preference ${i} title.`,
      tags: ['preference', 'mcp-automem'],
      importance: 0.85,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      last_accessed: '2026-08-01T00:00:00Z',
      metadata: { source: 'test', revision: 'none' },
      type: 'Preference',
      confidence: 0.95,
    },
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
    expect(response.content[0].text).toContain('state filter suppressed 2, replacements 1');
  });

  it('surfaces recall scope, recency, score, and per-result diagnostics', async () => {
    const recallResult = makeRecallResult({
      state_mode: 'history',
      tag_scope: { filtered: true, pool_size_hint: 12, gated_low_evidence: 2 },
      scope_fallback: true,
      recency_bias: 'on',
      score_filter: { min_score: 0.2, adaptive_floor: 0.4, filtered_count: 3 },
      query_time_ms: 42.5,
      vector_search: { enabled: true, matched: true },
      exclude_tags: ['archived'],
      jit_enriched_count: 1,
      entities: [{ slug: 'automem', identity: 'AutoMem memory service' }],
      queries: ['q1', 'q2'],
    } as any);
    recallResult.results[0].outside_tag_scope = true;
    recallResult.results[0].deduped_from = ['older-duplicate'];
    recallResult.results[0].jit_enriched = true;
    recallResult.results[0].state_replaces = 'suppressed-memory';

    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'scoped memories',
      format: 'detailed',
    });

    expect(response.structuredContent).toMatchObject({
      state_mode: 'history',
      tag_scope: { filtered: true, pool_size_hint: 12, gated_low_evidence: 2 },
      scope_fallback: true,
      recency_bias: 'on',
      score_filter: { min_score: 0.2, adaptive_floor: 0.4, filtered_count: 3 },
      query_time_ms: 42.5,
      vector_search: { enabled: true, matched: true },
      exclude_tags: ['archived'],
      jit_enriched_count: 1,
      entities: [{ slug: 'automem', identity: 'AutoMem memory service' }],
      queries: ['q1', 'q2'],
      results: [
        {
          memory_id: 'mem-1',
          outside_tag_scope: true,
          deduped_from: ['older-duplicate'],
          jit_enriched: true,
          state_replaces: 'suppressed-memory',
        },
      ],
    });
  });

  it('marks which results came from scope_fallback in every text format', async () => {
    const recallResult = makeRecallResult({ scope_fallback: true, dedup_removed: 2 });
    recallResult.results.push({
      ...recallResult.results[0],
      id: 'mem-2',
      outside_tag_scope: true,
      memory: { ...recallResult.results[0].memory, memory_id: 'mem-2', content: 'Unscoped fill' },
    });
    const client = { recallMemory: vi.fn().mockResolvedValue(recallResult) };
    const render = async (format: RecallMemoryArgs['format']) =>
      (await buildRecallMemoryResponse(client, { query: 'x', format })).content.map((c) => c.text);

    const [text] = await render('text');
    expect(text).toContain('scope fallback included outside-scope results');
    const [scoped, unscoped] = text.split('\n\n').slice(1);
    expect(scoped).not.toContain('outside tag scope');
    expect(unscoped.split('\n')[0]).toMatch(/Unscoped fill.* \[outside tag scope\]$/);

    const [detailed] = await render('detailed');
    const [detailedScoped, detailedUnscoped] = detailed.split('\n\n').slice(1);
    expect(detailedScoped).not.toContain('Outside tag scope');
    expect(detailedUnscoped).toContain('\n  Outside tag scope: true');

    // items: one block per result, in order, then a trailing block with the notes.
    const items = await render('items');
    expect(items).toEqual([
      '[mem-1] Tagged memory',
      '[mem-2] Unscoped fill [outside tag scope]',
      '[Notes: 2 duplicates removed; scope fallback included outside-scope results.]',
    ]);
  });

  it('adds no trailing block to items when there are no notes', async () => {
    const client = { recallMemory: vi.fn().mockResolvedValue(makeRecallResult()) };

    const response = await buildRecallMemoryResponse(client, { query: 'x', format: 'items' });

    expect(response.content).toEqual([{ type: 'text', text: '[mem-1] Tagged memory' }]);
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

  it("keeps the seed (`from`) and `kind` of recall's own relation entries in stubs", async () => {
    // What /recall sends: expanded results point back at their seed through `from`;
    // state replacements point at the suppressed memory. Neither nests a memory.
    const recallResult = makeRecallResult();
    recallResult.results[0].relations = [
      {
        type: 'RELATES_TO',
        strength: 0.7,
        from: 'seed-1',
        seed_rank: 0,
        seed_score: 0.91,
        kind: 'causal',
      },
      { type: 'INVALIDATED_BY', strength: 0.9, from: 'old-1' },
    ];
    const client = { recallMemory: vi.fn().mockResolvedValue(recallResult) };

    for (const format of ['text', 'items', 'detailed'] as const) {
      const response = await buildRecallMemoryResponse(client, { query: 'x', format });
      const item = (response.structuredContent.results as any[])[0];
      if (format !== 'detailed') {
        expect(item, format).not.toHaveProperty('relations');
        continue;
      }
      expect(item.relations).toEqual([
        { from: 'seed-1', type: 'RELATES_TO', strength: 0.7, kind: 'causal' },
        { from: 'old-1', type: 'INVALIDATED_BY', strength: 0.9 },
      ]);
    }
  });

  it('keeps a content preview and attaches summary as additive in budgeted formats', async () => {
    const longContent = 'c'.repeat(2000);
    const summary = 'Concise standalone summary of the memory.';
    const recallResult = makeRecallResult();
    recallResult.results![0].memory.content = longContent;
    (recallResult.results![0].memory as any).summary = summary;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'content preview' });

    const item = (response.structuredContent.results as any[])[0];
    expect(item.content.length).toBe(RECALL_CONTENT_PREVIEW_CHARS + 1); // preview + ellipsis
    expect(item.content.endsWith('…')).toBe(true);
    expect(item.content_truncated).toBe(true);
    expect(item.content_chars).toBe(longContent.length);
    expect(item.summary).toBe(summary);
    expect(response.content[0].text).toContain(item.content.slice(0, 40));
    expect(response.content[0].text).toContain('Content shown as previews');
    expect(response.content[0].text).not.toContain(longContent);
  });

  it('shows full short content with summary additive and no preview trailer', async () => {
    const content = 'Short preference: always use they pronouns in lyrics.';
    const summary = 'Pronoun preference.';
    const recallResult = makeRecallResult();
    recallResult.results![0].memory.content = content;
    (recallResult.results![0].memory as any).summary = summary;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'short' });

    const item = (response.structuredContent.results as any[])[0];
    expect(item.content).toBe(content);
    expect(item.summary).toBe(summary);
    expect(item).not.toHaveProperty('content_truncated');
    expect(response.content[0].text).toContain(content);
    expect(response.content[0].text).not.toContain('Content shown as previews');
  });

  it('falls back to summary in the text channel when content is empty', async () => {
    const summary = 'Voice calibration correction.';
    const recallResult = makeRecallResult();
    recallResult.results![0].memory.content = '';
    (recallResult.results![0].memory as any).summary = summary;
    const client = {
      recallMemory: vi.fn().mockResolvedValue(recallResult),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'empty content' });

    const item = (response.structuredContent.results as any[])[0];
    expect(item.content).toBe('');
    expect(item.summary).toBe(summary);
    expect(response.content[0].text).toContain(summary);
    expect(response.content[0].text).not.toContain('Content shown as previews');
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

  it('budgets json format by actual pretty-printed length, not a 2x minified guess', async () => {
    vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', '2000');
    // Metadata built from many tiny arrays: pretty-printing inflates these ~6x
    // over minified, so a 2x heuristic badly underestimates the text channel.
    const inflatedMetadata = { rows: Array.from({ length: 40 }, () => [1]) };
    const manyResults = Array.from({ length: 40 }, (_, i) => ({
      id: `mem-${i}`,
      match_type: 'semantic',
      final_score: 0.5,
      score_components: { importance: 0.5 },
      memory: {
        memory_id: `mem-${i}`,
        content: 'small content',
        tags: ['big'],
        importance: 0.5,
        created_at: '2026-03-25T00:00:00Z',
        metadata: inflatedMetadata,
      },
    }));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 40 }),
    };

    const response = await buildRecallMemoryResponse(client, {
      query: 'inflated',
      format: 'json',
    });

    const structured = response.structuredContent as any;
    expect(structured.truncation.applied).toBe(true);
    // the pretty-printed text channel must respect the token budget
    expect(response.content[0].text.length).toBeLessThanOrEqual(2000 * RECALL_CHARS_PER_TOKEN);
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
    // tiny budget: nearly everything dropped
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

  it('fits a typical text session-start recall of 30 memories without truncation', async () => {
    const manyResults = Array.from({ length: 30 }, (_, i) => makeTypicalPreferenceResult(i, 0));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 30 }),
    };

    const response = await buildRecallMemoryResponse(client, { query: 'session start', limit: 30 });

    const structured = response.structuredContent as any;
    expect(structured.results).toHaveLength(30);
    expect(structured).not.toHaveProperty('truncation');
    expect(response.content[0].text).toContain('Preference 0.');
    expect(response.content[0].text).not.toContain('Response budget:');
  });

  it('fits a typical detailed preference recall of 20 memories without truncation', async () => {
    const manyResults = Array.from({ length: 20 }, (_, i) => makeTypicalPreferenceResult(i, 3));
    const client = {
      recallMemory: vi.fn().mockResolvedValue({ results: manyResults, count: 20 }),
    };

    const response = await buildRecallMemoryResponse(client, {
      tags: ['preference'],
      format: 'detailed',
      limit: 20,
    });

    const structured = response.structuredContent as any;
    expect(structured.results).toHaveLength(20);
    expect(structured).not.toHaveProperty('truncation');
    expect(structured.results[0].content).toContain('Preference 0.');
    expect(structured.results[0].summary).toBe('Preference 0 title.');
    expect(structured.results[0].relations).toHaveLength(3);
  });

  it('keeps content previews under budget for a fat session-start detailed recall', async () => {
    // Modeled on the live 2026-06-10 failure: 26 ranked results, mixed relation
    // counts, enrichment metadata, ~400-char contents. Summary-first used to
    // fit all 26; content previews are larger, so the global token budget may
    // omit a few tail results — that is preferred over title-only dumps.
    const relationCounts = [
      5, 2, 5, 5, 5, 5, 0, 3, 5, 5, 5, 1, 5, 5, 5, 2, 5, 4, 5, 0, 5, 3, 5, 5, 2, 5,
    ];
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
    expect(structured.results).toHaveLength(20);
    expect(structured.truncation).toMatchObject({
      applied: true,
      omitted_results: 6,
      reason: 'response_token_budget',
    });
    for (const item of structured.results) {
      expect(item.content).toMatch(/^memory \d+ /);
      expect(item.summary).toMatch(/^summary \d+ /);
      expect(item).not.toHaveProperty('metadata');
      expect(item.metadata_keys).toEqual(expect.arrayContaining(['enrichment', 'entities']));
    }
    expect(JSON.stringify(response).length).toBeLessThanOrEqual(
      DEFAULT_RECALL_TOKEN_BUDGET * RECALL_CHARS_PER_TOKEN
    );
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

  describe('whole-response budget', () => {
    const FORMATS = ['text', 'items', 'detailed', 'json'] as const;
    const fitsBudget = (response: unknown, tokens = DEFAULT_RECALL_TOKEN_BUDGET) =>
      JSON.stringify(response).length <= tokens * RECALL_CHARS_PER_TOKEN;

    it('compacts a json result too large to show whole instead of keeping it anyway', async () => {
      vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', '1500');
      const recallResult = makeRecallResult({ count: 2 });
      const first = recallResult.results[0];
      first.memory.content = 'c'.repeat(1500);
      first.memory.metadata = { blob: 'm'.repeat(4000), source: 'test' };
      first.relations = Array.from({ length: 4 }, (_, i) => makeRelationRecord(i));
      recallResult.results.push({
        ...first,
        id: 'mem-2',
        memory: { ...first.memory, memory_id: 'mem-2' },
      });
      const client = { recallMemory: vi.fn().mockResolvedValue(recallResult) };

      const response = await buildRecallMemoryResponse(client, { query: 'big', format: 'json' });

      expect(fitsBudget(response, 1500)).toBe(true);
      const structured = response.structuredContent as any;
      expect(structured.results).toHaveLength(1);
      const [item] = structured.results;
      expect(item.memory_id).toBe('mem-1');
      expect(item.content_truncated).toBe(true);
      expect(item).not.toHaveProperty('metadata');
      expect(item.metadata_keys).toEqual(['blob', 'source']);
      expect(item.relations).toHaveLength(RECALL_MAX_RELATIONS);
      expect(structured.truncation).toEqual({
        applied: true,
        omitted_results: 1,
        compacted_results: 1,
        reason: 'response_token_budget',
      });
      expect(JSON.parse(response.content[0].text)).toEqual(structured);
    });

    it('drops state_filter detail, not results, when the diagnostics alone overflow', async () => {
      vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', '4000');
      const suppressed = Array.from({ length: 400 }, (_, i) => ({
        memory_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        reason: 'invalidated',
      }));
      const stateFilter = {
        current_only: true,
        suppressed_count: 400,
        replacement_count: 1,
        suppressed,
        replacements: [{ old_id: 'old-1', new_id: 'new-1' }],
      };
      const client = {
        recallMemory: vi.fn().mockResolvedValue(makeRecallResult({ state_filter: stateFilter })),
      };

      for (const format of FORMATS) {
        const response = await buildRecallMemoryResponse(client, {
          query: 'corrections',
          state_debug: true,
          format,
        });
        expect(fitsBudget(response, 4000), format).toBe(true);
        const structured = response.structuredContent as any;
        expect(structured.results, format).toHaveLength(1);
        expect(structured.state_filter, format).toEqual({
          current_only: true,
          suppressed_count: 400,
          replacement_count: 1,
          replacements: [{ old_id: 'old-1', new_id: 'new-1' }],
        });
        expect(structured.truncation, format).toEqual({
          applied: true,
          omitted_results: 0,
          omitted_fields: ['state_filter.suppressed'],
          reason: 'response_token_budget',
        });
        if (format !== 'json') {
          const text = response.content.map((block) => block.text).join('\n');
          expect(text, format).toContain('state filter suppressed 400, replacements 1');
          expect(text, format).toContain('Response budget: omitted state_filter.suppressed.');
        }
      }
      expect(stateFilter.suppressed).toHaveLength(400);
    });

    it('bounds a response with no results whose diagnostics alone overflow', async () => {
      vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', '1000');
      const entities = Array.from({ length: 300 }, (_, i) => ({
        slug: `entity-${i}`,
        identity: 'x'.repeat(40),
      }));
      const client = {
        recallMemory: vi.fn().mockResolvedValue({ results: [], count: 0, entities, query: 'q' }),
      };

      const response = await buildRecallMemoryResponse(client, { query: 'q' });

      expect(fitsBudget(response, 1000)).toBe(true);
      expect(response.content).toEqual([
        { type: 'text', text: 'No memories found matching your query.' },
      ]);
      expect(response.structuredContent).not.toHaveProperty('entities');
      expect(response.structuredContent).toMatchObject({
        results: [],
        count: 0,
        query: 'q',
        truncation: { applied: true, omitted_results: 0, omitted_fields: ['entities'] },
      });
    });

    it('keeps every format under the budget whatever the results and diagnostics', async () => {
      const results = Array.from({ length: 120 }, (_, i) => ({
        ...makeTypicalPreferenceResult(i, i % 6),
        memory: {
          ...makeTypicalPreferenceResult(i, 0).memory,
          content: `memory ${i} `.padEnd(80 + ((i * 397) % 2400), 'q"\n'),
          metadata: { blob: 'n'.repeat((i * 131) % 3000), list: Array.from({ length: i % 9 }) },
        },
      }));
      const diagnostics = {
        state_filter: {
          suppressed_count: 50,
          replacement_count: 0,
          suppressed: Array.from({ length: 50 }, (_, i) => ({ memory_id: `s-${i}` })),
        },
        entities: Array.from({ length: 40 }, (_, i) => ({ slug: `e-${i}`, identity: 'id' })),
        queries: ['a', 'b'],
      };
      const client = {
        recallMemory: vi
          .fn()
          .mockResolvedValue({ results, count: results.length, ...diagnostics } as any),
      };

      for (const tokens of [1500, 6000, DEFAULT_RECALL_TOKEN_BUDGET]) {
        vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', String(tokens));
        for (const format of FORMATS) {
          const response = await buildRecallMemoryResponse(client, { query: 'x', format });
          expect(fitsBudget(response, tokens), `${format} @ ${tokens}`).toBe(true);
          expect((response.structuredContent.results as any[]).length).toBeGreaterThan(0);
        }
      }
    });

    it('reports a trimmed enumeration page so paging loops see every record', async () => {
      // 60 memories of 1,500 chars on one tag: one upstream page (limit 200) holds all.
      const memories = Array.from({ length: 60 }, (_, i) => ({
        id: `mem-${i}`,
        match_type: 'direct',
        final_score: 1,
        score_components: {},
        relations: [],
        memory: {
          memory_id: `mem-${i}`,
          content: `memory ${i} `.padEnd(1500, 'x'),
          tags: ['audit'],
          importance: 0.5,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      }));
      // GET /memory/by-tag semantics: up to `limit` records from `offset`.
      const client = {
        recallMemory: vi.fn(async (args: RecallMemoryArgs): Promise<RecallResult> => {
          const offset = args.offset ?? 0;
          const limit = Math.min(args.limit ?? 20, 200);
          const page = memories.slice(offset, offset + limit);
          return {
            results: page,
            count: page.length,
            mode: 'enumeration',
            tags: ['audit'],
            limit,
            offset,
            has_more: offset + limit < memories.length,
          };
        }),
      };
      const args = { tags: ['audit'], exhaustive: true, limit: 200 };

      const first = await buildRecallMemoryResponse(client, args);
      const page = first.structuredContent as any;
      const kept = page.results.length;
      expect(kept).toBeGreaterThan(0);
      expect(kept).toBeLessThan(60);
      expect(page).toMatchObject({
        count: kept,
        limit: kept,
        offset: 0,
        has_more: true,
        next_offset: kept,
        truncation: { applied: true, omitted_results: 60 - kept },
      });
      expect(first.content[0].text).toContain(
        `enumeration page: offset 0, limit ${kept} — more pages available, next offset ${kept}`
      );

      // A pager following next_offset, and one continuing at offset + limit as the
      // contract said before next_offset existed, both see all 60 exactly once.
      const page$ = async (offset: number, format: RecallMemoryArgs['format']) => {
        const response = await buildRecallMemoryResponse(client, { ...args, offset, format });
        expect(fitsBudget(response)).toBe(true);
        return response.structuredContent as any;
      };
      for (const format of FORMATS) {
        for (const next of [
          (sc: any) => sc.next_offset as number,
          (sc: any) => (sc.offset as number) + (sc.limit as number),
        ]) {
          const seen: string[] = [];
          let offset = 0;
          for (let guard = 0; guard < 20; guard += 1) {
            const sc = await page$(offset, format);
            seen.push(...sc.results.map((r: any) => r.memory_id));
            if (!sc.has_more) break;
            offset = next(sc);
          }
          expect(seen, format).toEqual(memories.map((m) => m.id));
        }
      }
    });

    it('refuses an enumeration page that cannot show even one record', async () => {
      // Returning an empty page with has_more would send a pager back to the same
      // offset forever.
      vi.stubEnv('AUTOMEM_RECALL_TOKEN_BUDGET', '100');
      const client = {
        recallMemory: vi.fn().mockResolvedValue(
          makeRecallResult({
            mode: 'enumeration',
            count: 1,
            limit: 20,
            offset: 40,
            has_more: true,
          })
        ),
      };

      await expect(
        buildRecallMemoryResponse(client, { tags: ['project-x'], exhaustive: true, offset: 40 })
      ).rejects.toThrow(
        'recall_memory: the record at offset 40 does not fit the response budget (AUTOMEM_RECALL_TOKEN_BUDGET=100); fetch it with recall_memory({ memory_id: "mem-1" }) or raise the budget'
      );
    });
  });
});

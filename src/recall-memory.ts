import type { AutoMemClient } from './automem-client.js';
import type { RecallMemoryArgs, RecallResult } from './types.js';

// Response budgeting: recall responses must stay comfortably under MCP client
// tool-response caps (~25k tokens in Claude Code). Budgeted formats
// (text/items/detailed) show a content preview (default 400 chars), keep any
// server summary as an additive field, collapse relations to compact stubs,
// and collapse metadata to its key list. The global budget is measured in
// estimated tokens — dense recall JSON tokenizes at ~2.5 chars/token
// (empirical: a 64.8k-char response was rejected by Claude Code's 25k-token
// cap), so the old 80k-char budget overflowed despite firing. `format: "json"`
// keeps raw per-field passthrough (escape hatch) but the global budget still
// applies. The budget bounds the whole serialized response (structuredContent
// plus every text block, JSON-escaped), not just the results: diagnostics that
// do not fit even with no results are dropped, and a json result too large to
// show whole falls back to the compact shape. ID fetches (`memory_id`) are never
// truncated — that is the documented way to retrieve a full record.
export const RECALL_CONTENT_PREVIEW_CHARS = 400;
export const RECALL_MAX_RELATIONS = 3;
export const RECALL_RELATION_SUMMARY_CHARS = 100;
export const RECALL_CHARS_PER_TOKEN = 2.5;
export const DEFAULT_RECALL_TOKEN_BUDGET = 18_000;

// Diagnostics the budget drops, in this order, when the response does not fit even
// with no results. Never dropped: results, count, mode, the paging fields and
// truncation. state_filter keeps its counts, which the text notes read.
const ENVELOPE_DROP_ORDER = [
  'state_filter.suppressed',
  'state_filter.replacements',
  'entities',
  'entity_expansion',
  'expansion',
  'context_priority',
  'vector_search',
  'tag_scope',
  'score_filter',
  'keywords',
  'queries',
  'query',
  'exclude_tags',
  'tags',
  'time_window',
];

function resolveTokenBudget(): number {
  const raw = process.env.AUTOMEM_RECALL_TOKEN_BUDGET;
  if (raw) {
    // Strict parse: reject non-numeric suffixes ("1200foo") and fractions.
    const parsed = Number(raw.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_RECALL_TOKEN_BUDGET;
}

type RecallToolContent = {
  type: 'text';
  text: string;
};

type RecallToolResponse = {
  content: RecallToolContent[];
  structuredContent: Record<string, unknown>;
};

type RecallClient = Pick<AutoMemClient, 'recallMemory'>;

type RecallResultItem = NonNullable<RecallResult['results']>[number];

type PerItemOutput = {
  structuredItem: Record<string, unknown>;
  textBlock: string;
  /** Estimated characters this result adds to the serialized response. */
  cost: number;
  contentTruncated: boolean;
};

/** What the budget cut, beyond trailing results; reported in `truncation`. */
type BudgetCuts = {
  omittedFields: string[];
  compactedResults: number;
};

function capContent(
  content: string | undefined,
  budgeted: boolean
): { preview: string; truncated: boolean; chars: number } {
  const text = content ?? '';
  if (!budgeted || text.length <= RECALL_CONTENT_PREVIEW_CHARS) {
    return { preview: text, truncated: false, chars: text.length };
  }
  return {
    preview: `${text.slice(0, RECALL_CONTENT_PREVIEW_CHARS)}…`,
    truncated: true,
    chars: text.length,
  };
}

function metadataKeyList(metadata: unknown): string[] | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const keys = Object.keys(metadata as Record<string, unknown>);
  return keys.length > 0 ? keys : undefined;
}

// A relation as stored on a recall result embeds a full nested memory record.
// Budgeted formats keep only what makes the edge meaningful: the target id,
// edge type/strength, and a short summary of the target. Recall's own relation
// entries name their other end in `from` instead (the seed for expanded results,
// the suppressed memory for state replacements) and may carry a `kind`.
function relationStub(rel: Record<string, any>): Record<string, unknown> {
  const memory = rel?.memory && typeof rel.memory === 'object' ? rel.memory : undefined;
  const id = memory?.id ?? rel?.id ?? rel?.memory_id;
  const rawSummary = memory?.summary ?? memory?.content ?? rel?.summary ?? rel?.content;
  const summary =
    typeof rawSummary === 'string' && rawSummary.length > 0
      ? rawSummary.length > RECALL_RELATION_SUMMARY_CHARS
        ? `${rawSummary.slice(0, RECALL_RELATION_SUMMARY_CHARS)}…`
        : rawSummary
      : undefined;
  return {
    ...(id !== undefined ? { id } : {}),
    ...(typeof rel?.from === 'string' ? { from: rel.from } : {}),
    ...(rel?.type !== undefined ? { type: rel.type } : {}),
    ...(typeof rel?.strength === 'number' ? { strength: rel.strength } : {}),
    ...(typeof rel?.kind === 'string' ? { kind: rel.kind } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

function compactRelations(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length === 0) {
    return {};
  }
  return {
    relations: value.slice(0, RECALL_MAX_RELATIONS).map(relationStub),
    ...(value.length > RECALL_MAX_RELATIONS ? { relations_total: value.length } : {}),
  };
}

function buildStructuredRecallItem(
  item: RecallResultItem,
  isRichFormat: boolean,
  budgeted: boolean,
  keepScoreComponents: boolean
): {
  structuredItem: Record<string, unknown>;
  displayText: string;
  contentTruncated: boolean;
} {
  const memory = item.memory;
  const summary =
    typeof memory.summary === 'string' && memory.summary.trim().length > 0
      ? memory.summary
      : undefined;
  const { preview, truncated, chars } = capContent(memory.content, budgeted);
  // Empty content still happens on some records; fall back to summary so the
  // text channel is not a blank line. Structured `content` stays the preview
  // (possibly empty) so callers can tell the fields apart.
  const displayText = preview.trim().length > 0 ? preview : (summary ?? preview);

  const base: Record<string, unknown> = {
    memory_id: memory.memory_id,
    content: preview,
    ...(truncated ? { content_truncated: true, content_chars: chars } : {}),
    ...(summary !== undefined ? { summary } : {}),
    tags: memory.tags,
    importance: memory.importance,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    final_score: item.final_score,
    match_type: item.match_type,
  };
  if (!isRichFormat) {
    return { structuredItem: base, displayText, contentTruncated: truncated };
  }

  const metadataFields = budgeted
    ? (() => {
        const keys = metadataKeyList(memory.metadata);
        return keys ? { metadata_keys: keys } : {};
      })()
    : { metadata: memory.metadata };

  const structuredItem: Record<string, unknown> = {
    ...base,
    last_accessed: memory.last_accessed,
    ...metadataFields,
    type: memory.type,
    confidence: memory.confidence,
    ...(budgeted
      ? {}
      : {
          match_score: item.match_score,
          relation_score: item.relation_score,
          source: item.source,
        }),
    ...(keepScoreComponents ? { score_components: item.score_components } : {}),
    ...(budgeted ? compactRelations(item.relations) : { relations: item.relations }),
    deduped_from: item.deduped_from,
    expanded_from_entity: item.expanded_from_entity,
    outside_tag_scope: item.outside_tag_scope,
    jit_enriched: item.jit_enriched,
    state_replaces: item.state_replaces,
  };
  return { structuredItem, displayText, contentTruncated: truncated };
}

// `returned` is how many results the response keeps. An enumeration page the budget
// trimmed reports itself as a page of that size with more to come, so a pager that
// continues at offset + limit, or at next_offset, still sees every record.
function buildStructuredEnvelope(
  recallResult: RecallResult,
  returned: number
): Record<string, unknown> {
  const results = recallResult.results || [];
  const isEnumeration = recallResult.mode === 'enumeration';
  const trimmedPage = isEnumeration && returned < results.length;
  const hasMore = trimmedPage ? true : recallResult.has_more;
  const limit = trimmedPage ? returned : recallResult.limit;
  const offset = recallResult.offset;
  return {
    count: trimmedPage ? returned : (recallResult.count ?? results.length),
    ...(recallResult.mode ? { mode: recallResult.mode } : {}),
    ...(typeof hasMore === 'boolean' ? { has_more: hasMore } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof offset === 'number' ? { offset } : {}),
    ...(isEnumeration && hasMore === true ? { next_offset: (offset ?? 0) + returned } : {}),
    ...(typeof recallResult.dedup_removed === 'number'
      ? { dedup_removed: recallResult.dedup_removed }
      : {}),
    ...(recallResult.query ? { query: recallResult.query } : {}),
    ...(recallResult.sort ? { sort: recallResult.sort } : {}),
    ...(recallResult.keywords ? { keywords: recallResult.keywords } : {}),
    ...(recallResult.time_window ? { time_window: recallResult.time_window } : {}),
    ...(recallResult.tags ? { tags: recallResult.tags } : {}),
    ...(recallResult.exclude_tags ? { exclude_tags: recallResult.exclude_tags } : {}),
    ...(recallResult.tag_mode ? { tag_mode: recallResult.tag_mode } : {}),
    ...(recallResult.tag_match ? { tag_match: recallResult.tag_match } : {}),
    ...(recallResult.state_mode ? { state_mode: recallResult.state_mode } : {}),
    ...(recallResult.tag_scope ? { tag_scope: recallResult.tag_scope } : {}),
    ...(typeof recallResult.scope_fallback === 'boolean'
      ? { scope_fallback: recallResult.scope_fallback }
      : {}),
    ...(recallResult.recency_bias ? { recency_bias: recallResult.recency_bias } : {}),
    ...(recallResult.score_filter ? { score_filter: recallResult.score_filter } : {}),
    ...(recallResult.queries ? { queries: recallResult.queries } : {}),
    ...(recallResult.vector_search ? { vector_search: recallResult.vector_search } : {}),
    ...(typeof recallResult.jit_enriched_count === 'number'
      ? { jit_enriched_count: recallResult.jit_enriched_count }
      : {}),
    ...(typeof recallResult.query_time_ms === 'number'
      ? { query_time_ms: recallResult.query_time_ms }
      : {}),
    ...(recallResult.entities ? { entities: recallResult.entities } : {}),
    ...(recallResult.expansion ? { expansion: recallResult.expansion } : {}),
    ...(recallResult.entity_expansion ? { entity_expansion: recallResult.entity_expansion } : {}),
    ...(recallResult.context_priority ? { context_priority: recallResult.context_priority } : {}),
    ...(recallResult.state_filter ? { state_filter: recallResult.state_filter } : {}),
  };
}

// Drops one ENVELOPE_DROP_ORDER entry ("field" or "field.nested") without touching
// the recall result it was copied from. Returns false when the field is absent.
function omitEnvelopeField(envelope: Record<string, unknown>, field: string): boolean {
  const [key, nested] = field.split('.');
  const value = envelope[key];
  if (value === undefined) return false;
  if (nested === undefined) {
    delete envelope[key];
    return true;
  }
  if (!value || typeof value !== 'object' || !(nested in value)) return false;
  const { [nested]: _omitted, ...rest } = value as Record<string, unknown>;
  envelope[key] = rest;
  return true;
}

function buildNotes(envelope: Record<string, unknown>): string[] {
  const env = envelope as Partial<RecallResult> & { next_offset?: number };
  const notes: string[] = [];
  if ((env.dedup_removed || 0) > 0) {
    notes.push(`${env.dedup_removed} duplicates removed`);
  }
  if (env.entity_expansion?.enabled && env.entity_expansion.expanded_count > 0) {
    notes.push(
      `${env.entity_expansion.expanded_count} via entity expansion (${
        env.entity_expansion.entities_found?.join(', ') || 'entities found'
      })`
    );
  }
  if (env.expansion?.enabled && env.expansion.expanded_count > 0) {
    notes.push(`${env.expansion.expanded_count} via relation expansion`);
  }
  if (env.state_filter) {
    notes.push(
      `state filter suppressed ${env.state_filter.suppressed_count}, replacements ${env.state_filter.replacement_count}`
    );
  }
  if (env.scope_fallback) {
    notes.push('scope fallback included outside-scope results');
  }
  const filteredCount = env.score_filter?.filtered_count;
  if (typeof filteredCount === 'number' && filteredCount > 0) {
    notes.push(`score filter removed ${filteredCount}`);
  }
  if (env.mode === 'enumeration') {
    const pageSuffix = env.has_more
      ? ` — more pages available, next offset ${env.next_offset}`
      : '';
    notes.push(
      `enumeration page: offset ${env.offset ?? 0}, limit ${env.limit ?? env.count}${pageSuffix}`
    );
  }
  return notes;
}

// scope_fallback appends unscoped fills after the scoped results; mark them so a
// reader of the text channel can tell them apart.
const OUTSIDE_SCOPE_NOTE = ' [outside tag scope]';

function scopeNote(item: RecallResultItem): string {
  return item.outside_tag_scope ? OUTSIDE_SCOPE_NOTE : '';
}

function renderTextBlock(item: RecallResultItem, preview: string, index: number): string {
  const memory = item.memory;
  const tags = memory.tags?.length ? ` [${memory.tags.join(', ')}]` : '';
  const importance =
    typeof memory.importance === 'number' ? ` (importance: ${memory.importance})` : '';
  const score = typeof item.final_score === 'number' ? ` score=${item.final_score.toFixed(3)}` : '';
  const matchType = item.match_type ? ` [${item.match_type}]` : '';
  const relationNote =
    Array.isArray(item.relations) && item.relations.length
      ? ` relations=${item.relations.length}`
      : '';
  const dedupNote =
    Array.isArray(item.deduped_from) && item.deduped_from.length
      ? ` (deduped x${item.deduped_from.length})`
      : '';
  const entityNote = item.expanded_from_entity ? ` [via entity: ${item.expanded_from_entity}]` : '';
  const updatedNote = memory.updated_at ? `  Updated: ${memory.updated_at}` : '';
  return `${index + 1}. ${preview}${tags}${importance}${score}${matchType}${relationNote}${entityNote}${dedupNote}${scopeNote(item)}\n   ID: ${
    memory.memory_id
  }\n   Created: ${memory.created_at}${updatedNote}`;
}

function renderDetailedBlock(item: RecallResultItem, preview: string): string {
  const memory = item.memory;
  const lines = [preview, `  ID: ${memory.memory_id}`];
  if (memory.type) lines.push(`  Type: ${memory.type}`);
  lines.push(`  Created: ${memory.created_at}`);
  if (memory.updated_at) lines.push(`  Updated: ${memory.updated_at}`);
  if (memory.last_accessed) lines.push(`  Accessed: ${memory.last_accessed}`);
  if (typeof memory.importance === 'number') {
    lines.push(`  Importance: ${memory.importance.toFixed(3)}`);
  }
  if (typeof memory.confidence === 'number') {
    lines.push(`  Confidence: ${memory.confidence.toFixed(3)}`);
  }
  if (memory.tags?.length) lines.push(`  Tags: ${memory.tags.join(', ')}`);
  if (typeof item.final_score === 'number') {
    lines.push(`  Score: ${item.final_score.toFixed(3)}`);
  }
  if (item.match_type) lines.push(`  Match: ${item.match_type}`);
  if (item.outside_tag_scope) lines.push('  Outside tag scope: true');
  return lines.join('\n');
}

// Estimated characters a result adds to the serialized response: its structured
// item, plus its text block JSON-escaped (json repeats the item pretty-printed,
// four spaces deeper inside `results`). The final size check is exact; this only
// has to be close.
function estimateItemCost(
  format: string,
  structuredItem: Record<string, unknown>,
  textBlock: string
): number {
  const structured = (JSON.stringify(structuredItem)?.length ?? 0) + 1;
  if (format === 'json') {
    const nested = (JSON.stringify(structuredItem, null, 2) ?? '').replace(/^/gm, '    ');
    return structured + JSON.stringify(nested).length + 1;
  }
  if (format === 'items') {
    return structured + JSON.stringify({ type: 'text', text: textBlock }).length + 1;
  }
  return structured + JSON.stringify(textBlock).length + 2;
}

function buildItemOutput(
  item: RecallResultItem,
  index: number,
  format: string,
  isRichFormat: boolean,
  budgeted: boolean,
  keepScoreComponents: boolean
): PerItemOutput {
  const { structuredItem, displayText, contentTruncated } = buildStructuredRecallItem(
    item,
    isRichFormat,
    budgeted,
    keepScoreComponents
  );
  let textBlock = '';
  if (format === 'items') {
    textBlock = `[${item.memory.memory_id}] ${displayText}${scopeNote(item)}`;
  } else if (format === 'detailed') {
    textBlock = renderDetailedBlock(item, displayText);
  } else if (format !== 'json') {
    textBlock = renderTextBlock(item, displayText, index);
  }
  const cost = estimateItemCost(format, structuredItem, textBlock);
  return { structuredItem, textBlock, cost, contentTruncated };
}

// The whole response as it goes over the wire: what the budget bounds.
function responseChars(response: RecallToolResponse): number {
  return JSON.stringify(response).length;
}

function renderRecallResponse(
  recallResult: RecallResult,
  format: string,
  kept: PerItemOutput[],
  cuts: BudgetCuts
): RecallToolResponse {
  const total = (recallResult.results || []).length;
  const omitted = total - kept.length;
  const envelope = buildStructuredEnvelope(recallResult, kept.length);
  for (const field of cuts.omittedFields) {
    omitEnvelopeField(envelope, field);
  }
  const truncated = omitted > 0 || cuts.omittedFields.length > 0 || cuts.compactedResults > 0;
  const structuredContent: Record<string, unknown> = {
    results: kept.map((entry) => entry.structuredItem),
    ...envelope,
    ...(truncated
      ? {
          truncation: {
            applied: true,
            omitted_results: omitted,
            ...(cuts.omittedFields.length > 0 ? { omitted_fields: cuts.omittedFields } : {}),
            ...(cuts.compactedResults > 0 ? { compacted_results: cuts.compactedResults } : {}),
            reason: 'response_token_budget',
          },
        }
      : {}),
  };

  if (total === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No memories found matching your query.',
        },
      ],
      structuredContent,
    };
  }

  if (format === 'json') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      structuredContent,
    };
  }

  const notes = buildNotes(envelope);
  const trailerParts: string[] = [];
  if (omitted > 0) {
    trailerParts.push(
      `Response budget: showing ${kept.length} of ${total} results; ${omitted} omitted.`
    );
  }
  if (cuts.omittedFields.length > 0) {
    trailerParts.push(`Response budget: omitted ${cuts.omittedFields.join(', ')}.`);
  }
  if (kept.some((entry) => entry.contentTruncated)) {
    trailerParts.push(
      'Content shown as previews — fetch full records with recall_memory({ memory_id: "<id>" }).'
    );
  }

  if (format === 'items') {
    const itemBlocks: RecallToolContent[] = kept.map((entry) => ({
      type: 'text' as const,
      text: entry.textBlock,
    }));
    // items has no header, so its notes ride in the trailing block, after the
    // per-memory blocks, which keep their one-to-one order with `results`.
    const itemsTrailerParts =
      notes.length > 0 ? [`Notes: ${notes.join('; ')}.`, ...trailerParts] : trailerParts;
    if (itemsTrailerParts.length > 0) {
      itemBlocks.push({ type: 'text' as const, text: `[${itemsTrailerParts.join(' ')}]` });
    }
    return {
      content: itemBlocks,
      structuredContent,
    };
  }

  const notesSuffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  const showingSuffix = omitted > 0 ? ` (showing ${kept.length})` : '';
  const joinedBlocks = kept.map((entry) => entry.textBlock).join('\n\n');
  const trailer = trailerParts.length > 0 ? `\n\n[${trailerParts.join(' ')}]` : '';
  return {
    content: [
      {
        type: 'text',
        text: `Found ${total} memories${showingSuffix}${notesSuffix}:\n\n${joinedBlocks}${trailer}`,
      },
    ],
    structuredContent,
  };
}

export async function buildRecallMemoryResponse(
  client: RecallClient,
  recallArgs: RecallMemoryArgs
): Promise<RecallToolResponse> {
  const recallResult = await client.recallMemory(recallArgs);
  const results = recallResult.results || [];
  const format = recallArgs.format || 'text';
  const isRichFormat = format === 'detailed' || format === 'json';
  const isIdFetch = recallResult.mode === 'id_fetch' || Boolean(recallArgs.memory_id);
  // json keeps raw per-field passthrough; id fetches are never truncated.
  const budgeted = !isIdFetch && format !== 'json';
  const keepScoreComponents = format === 'json' || isIdFetch;

  const perItem = results.map((item, index) =>
    buildItemOutput(item, index, format, isRichFormat, budgeted, keepScoreComponents)
  );
  const cuts: BudgetCuts = { omittedFields: [], compactedResults: 0 };
  if (isIdFetch) {
    return renderRecallResponse(recallResult, format, perItem, cuts);
  }

  const tokenBudget = resolveTokenBudget();
  const budgetChars = tokenBudget * RECALL_CHARS_PER_TOKEN;
  const render = (kept: PerItemOutput[]) => renderRecallResponse(recallResult, format, kept, cuts);

  // 1. Everything but the results must fit on its own: drop diagnostics until it does.
  const probe = buildStructuredEnvelope(recallResult, 0);
  for (const field of ENVELOPE_DROP_ORDER) {
    if (responseChars(render([])) <= budgetChars) break;
    if (omitEnvelopeField(probe, field)) {
      cuts.omittedFields.push(field);
    }
  }

  // 2. Results in rank order while the whole response fits. The per-item costs are
  // estimates (headers and counts change with what is kept), so the assembled
  // response is measured and trimmed from the tail until it really fits.
  const kept: PerItemOutput[] = [];
  let used = responseChars(render([]));
  for (const entry of perItem) {
    if (used + entry.cost > budgetChars) break;
    kept.push(entry);
    used += entry.cost;
  }
  let response = render(kept);
  while (kept.length > 0 && responseChars(response) > budgetChars) {
    kept.pop();
    response = render(kept);
  }

  // 3. A json result too large to show whole falls back to the compact shape
  // (preview, metadata keys, relation stubs) rather than leaving nothing: the
  // caller still gets its id and can fetch the full record with memory_id.
  if (kept.length === 0 && results.length > 0 && format === 'json') {
    const compact = buildItemOutput(results[0], 0, format, true, true, false);
    cuts.compactedResults = 1;
    const compacted = render([compact]);
    if (responseChars(compacted) <= budgetChars) {
      kept.push(compact);
      response = compacted;
    } else {
      // `response` is still step 2's empty render, made before this flag was set.
      cuts.compactedResults = 0;
    }
  }

  // An enumeration page that shows nothing would send a pager back to the same
  // offset forever, so refuse it with what the caller can do instead.
  if (kept.length === 0 && results.length > 0 && recallResult.mode === 'enumeration') {
    throw new Error(
      `recall_memory: the record at offset ${recallResult.offset ?? 0} does not fit the response budget (AUTOMEM_RECALL_TOKEN_BUDGET=${tokenBudget}); fetch it with recall_memory({ memory_id: "${results[0].memory.memory_id}" }) or raise the budget`
    );
  }

  return response;
}

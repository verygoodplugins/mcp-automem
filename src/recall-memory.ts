import type { AutoMemClient } from './automem-client.js';
import type { RecallMemoryArgs, RecallResult } from './types.js';

// Response budgeting: recall responses must stay comfortably under MCP client
// tool-response caps (~25k tokens in Claude Code). Budgeted formats
// (text/items/detailed) are summary-first: the server's 1-2 sentence summary
// replaces the content preview when present, relations collapse to compact
// stubs, and metadata collapses to its key list. The global budget is measured
// in estimated tokens — dense recall JSON tokenizes at ~2.5 chars/token
// (empirical: a 64.8k-char response was rejected by Claude Code's 25k-token
// cap), so the old 80k-char budget overflowed despite firing. `format: "json"`
// keeps raw per-field passthrough (escape hatch) but the global budget still
// applies. ID fetches (`memory_id`) are never truncated — that is the
// documented way to retrieve a full record.
export const RECALL_CONTENT_PREVIEW_CHARS = 400;
export const RECALL_MAX_RELATIONS = 3;
export const RECALL_RELATION_SUMMARY_CHARS = 100;
export const RECALL_CHARS_PER_TOKEN = 2.5;
export const DEFAULT_RECALL_TOKEN_BUDGET = 18_000;

const RESPONSE_ENVELOPE_RESERVE_TOKENS = 800;

function estimateTokens(chars: number): number {
  return Math.ceil(chars / RECALL_CHARS_PER_TOKEN);
}

function resolveTokenBudget(): number {
  const raw = process.env.AUTOMEM_RECALL_TOKEN_BUDGET;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
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
  cost: number;
  contentTruncated: boolean;
  summaryShown: boolean;
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
// edge type/strength, and a short summary of the target.
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
    ...(rel?.type !== undefined ? { type: rel.type } : {}),
    ...(typeof rel?.strength === 'number' ? { strength: rel.strength } : {}),
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
  summaryShown: boolean;
} {
  const memory = item.memory;
  const summary =
    typeof memory.summary === 'string' && memory.summary.trim().length > 0
      ? memory.summary
      : undefined;
  const useSummary = budgeted && summary !== undefined;
  const { preview, truncated, chars } = capContent(memory.content, budgeted);
  const contentTruncated = !useSummary && truncated;

  const base: Record<string, unknown> = {
    memory_id: memory.memory_id,
    ...(useSummary
      ? {
          summary,
          ...(chars > 0 ? { content_chars: chars } : {}),
        }
      : {
          content: preview,
          ...(truncated ? { content_truncated: true, content_chars: chars } : {}),
          ...(summary !== undefined ? { summary } : {}),
        }),
    tags: memory.tags,
    importance: memory.importance,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    final_score: item.final_score,
    match_type: item.match_type,
  };

  const displayText = useSummary ? summary : preview;
  if (!isRichFormat) {
    return { structuredItem: base, displayText, contentTruncated, summaryShown: useSummary };
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
  };
  return { structuredItem, displayText, contentTruncated, summaryShown: useSummary };
}

function buildStructuredEnvelope(recallResult: RecallResult): Record<string, unknown> {
  const results = recallResult.results || [];
  return {
    count: recallResult.count ?? results.length,
    ...(recallResult.mode ? { mode: recallResult.mode } : {}),
    ...(typeof recallResult.has_more === 'boolean'
      ? { has_more: recallResult.has_more }
      : {}),
    ...(typeof recallResult.limit === 'number' ? { limit: recallResult.limit } : {}),
    ...(typeof recallResult.offset === 'number' ? { offset: recallResult.offset } : {}),
    ...(typeof recallResult.dedup_removed === 'number'
      ? { dedup_removed: recallResult.dedup_removed }
      : {}),
    ...(recallResult.keywords ? { keywords: recallResult.keywords } : {}),
    ...(recallResult.time_window ? { time_window: recallResult.time_window } : {}),
    ...(recallResult.tags ? { tags: recallResult.tags } : {}),
    ...(recallResult.tag_mode ? { tag_mode: recallResult.tag_mode } : {}),
    ...(recallResult.tag_match ? { tag_match: recallResult.tag_match } : {}),
    ...(recallResult.expansion ? { expansion: recallResult.expansion } : {}),
    ...(recallResult.entity_expansion
      ? { entity_expansion: recallResult.entity_expansion }
      : {}),
    ...(recallResult.context_priority
      ? { context_priority: recallResult.context_priority }
      : {}),
    ...(recallResult.state_filter ? { state_filter: recallResult.state_filter } : {}),
  };
}

function renderTextBlock(
  item: RecallResultItem,
  preview: string,
  index: number
): string {
  const memory = item.memory;
  const tags = memory.tags?.length ? ` [${memory.tags.join(', ')}]` : '';
  const importance =
    typeof memory.importance === 'number'
      ? ` (importance: ${memory.importance})`
      : '';
  const score =
    typeof item.final_score === 'number'
      ? ` score=${item.final_score.toFixed(3)}`
      : '';
  const matchType = item.match_type ? ` [${item.match_type}]` : '';
  const relationNote =
    Array.isArray(item.relations) && item.relations.length
      ? ` relations=${item.relations.length}`
      : '';
  const dedupNote =
    Array.isArray(item.deduped_from) && item.deduped_from.length
      ? ` (deduped x${item.deduped_from.length})`
      : '';
  const entityNote = item.expanded_from_entity
    ? ` [via entity: ${item.expanded_from_entity}]`
    : '';
  const updatedNote = memory.updated_at ? `  Updated: ${memory.updated_at}` : '';
  return `${index + 1}. ${preview}${tags}${importance}${score}${matchType}${relationNote}${entityNote}${dedupNote}\n   ID: ${
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
  return lines.join('\n');
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

  if (results.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No memories found matching your query.',
        },
      ],
      structuredContent: {
        results: [],
        ...buildStructuredEnvelope(recallResult),
      },
    };
  }

  const perItem: PerItemOutput[] = results.map((item, index) => {
    const { structuredItem, displayText, contentTruncated, summaryShown } =
      buildStructuredRecallItem(item, isRichFormat, budgeted, keepScoreComponents);
    let textBlock = '';
    if (format === 'items') {
      textBlock = `[${item.memory.memory_id}] ${displayText}`;
    } else if (format === 'detailed') {
      textBlock = renderDetailedBlock(item, displayText);
    } else if (format !== 'json') {
      textBlock = renderTextBlock(item, displayText, index);
    }
    const structuredLength = JSON.stringify(structuredItem)?.length ?? 0;
    // json doubles the structured payload into the text channel (pretty-printed).
    const cost =
      format === 'json' ? structuredLength * 2 : structuredLength + textBlock.length;
    return { structuredItem, textBlock, cost, contentTruncated, summaryShown };
  });

  // Global budget: always keep the first result; keep the rest while in budget.
  const tokenBudget = resolveTokenBudget();
  const kept: PerItemOutput[] = [];
  let runningTokens = RESPONSE_ENVELOPE_RESERVE_TOKENS;
  if (isIdFetch) {
    kept.push(...perItem);
  } else {
    for (const entry of perItem) {
      const entryTokens = estimateTokens(entry.cost);
      if (kept.length > 0 && runningTokens + entryTokens > tokenBudget) {
        break;
      }
      kept.push(entry);
      runningTokens += entryTokens;
    }
  }
  const omitted = perItem.length - kept.length;

  const structuredContent: Record<string, unknown> = {
    results: kept.map((entry) => entry.structuredItem),
    ...buildStructuredEnvelope(recallResult),
    ...(omitted > 0
      ? {
          truncation: {
            applied: true,
            omitted_results: omitted,
            reason: 'response_token_budget',
          },
        }
      : {}),
  };

  const notes: string[] = [];
  if ((recallResult.dedup_removed || 0) > 0) {
    notes.push(`${recallResult.dedup_removed} duplicates removed`);
  }
  if (
    recallResult.entity_expansion?.enabled &&
    recallResult.entity_expansion.expanded_count > 0
  ) {
    notes.push(
      `${recallResult.entity_expansion.expanded_count} via entity expansion (${
        recallResult.entity_expansion.entities_found?.join(', ') || 'entities found'
      })`
    );
  }
  if (recallResult.expansion?.enabled && recallResult.expansion.expanded_count > 0) {
    notes.push(`${recallResult.expansion.expanded_count} via relation expansion`);
  }
  if (recallResult.state_filter) {
    notes.push(
      `state filter suppressed ${recallResult.state_filter.suppressed_count}, replacements ${recallResult.state_filter.replacement_count}`
    );
  }
  if (recallResult.mode === 'enumeration') {
    const offset = recallResult.offset ?? 0;
    const limit = recallResult.limit ?? results.length;
    const pageSuffix = recallResult.has_more ? ' — more pages available' : '';
    notes.push(`enumeration page: offset ${offset}, limit ${limit}${pageSuffix}`);
  }
  const notesSuffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';

  const anyContentTruncated = kept.some((entry) => entry.contentTruncated);
  const anySummaryShown = kept.some((entry) => entry.summaryShown);
  const trailerParts: string[] = [];
  if (omitted > 0) {
    trailerParts.push(
      `Response budget: showing ${kept.length} of ${perItem.length} results; ${omitted} omitted.`
    );
  }
  if (anyContentTruncated || anySummaryShown) {
    trailerParts.push(
      'Content shown as summaries/previews — fetch full records with recall_memory({ memory_id: "<id>" }).'
    );
  }
  const trailer = trailerParts.length > 0 ? `\n\n[${trailerParts.join(' ')}]` : '';

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

  if (format === 'items') {
    const itemBlocks: RecallToolContent[] = kept.map((entry) => ({
      type: 'text' as const,
      text: entry.textBlock,
    }));
    if (trailer) {
      itemBlocks.push({ type: 'text' as const, text: trailer.trim() });
    }
    return {
      content: itemBlocks,
      structuredContent,
    };
  }

  const joinedBlocks = kept.map((entry) => entry.textBlock).join('\n\n');
  const showingSuffix = omitted > 0 ? ` (showing ${kept.length})` : '';
  return {
    content: [
      {
        type: 'text',
        text: `Found ${results.length} memories${showingSuffix}${notesSuffix}:\n\n${joinedBlocks}${trailer}`,
      },
    ],
    structuredContent,
  };
}

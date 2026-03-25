import type { AutoMemClient } from './automem-client.js';
import type { RecallMemoryArgs, RecallResult } from './types.js';

type RecallToolContent = {
  type: 'text';
  text: string;
};

type RecallToolResponse = {
  content: RecallToolContent[];
  structuredContent: Record<string, unknown>;
};

type RecallClient = Pick<AutoMemClient, 'recallMemory'>;

function buildStructuredRecallOutput(
  recallArgs: RecallMemoryArgs,
  recallResult: RecallResult
): Record<string, unknown> {
  const format = recallArgs.format || 'text';
  const isRichFormat = format === 'detailed' || format === 'json';
  const results = recallResult.results || [];

  return {
    results: results.map((item) => {
      const base = {
        memory_id: item.memory.memory_id,
        content: item.memory.content,
        tags: item.memory.tags,
        importance: item.memory.importance,
        created_at: item.memory.created_at,
        final_score: item.final_score,
        match_type: item.match_type,
      };

      if (!isRichFormat) {
        return base;
      }

      return {
        ...base,
        updated_at: item.memory.updated_at,
        last_accessed: item.memory.last_accessed,
        metadata: item.memory.metadata,
        type: item.memory.type,
        confidence: item.memory.confidence,
        match_score: item.match_score,
        relation_score: item.relation_score,
        score_components: item.score_components,
        source: item.source,
        relations: item.relations,
        related_to: item.related_to,
        deduped_from: item.deduped_from,
        expanded_from_entity: item.expanded_from_entity,
      };
    }),
    count: recallResult.count ?? results.length,
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
  };
}

export async function buildRecallMemoryResponse(
  client: RecallClient,
  recallArgs: RecallMemoryArgs
): Promise<RecallToolResponse> {
  const recallResult = await client.recallMemory(recallArgs);
  const results = recallResult.results || [];
  const structuredContent = buildStructuredRecallOutput(recallArgs, recallResult);

  if (results.length === 0) {
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

  const memoriesText = results
    .map((item, index) => {
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
      return `${index + 1}. ${
        memory.content
      }${tags}${importance}${score}${matchType}${relationNote}${entityNote}${dedupNote}\n   ID: ${
        memory.memory_id
      }\n   Created: ${memory.created_at}`;
    })
    .join('\n\n');

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
  const notesSuffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  const format = recallArgs.format || 'text';

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
    return {
      content: results.map((item) => ({
        type: 'text' as const,
        text: `[${item.memory.memory_id}] ${item.memory.content}`,
      })),
      structuredContent,
    };
  }

  if (format === 'detailed') {
    const detailedText = results
      .map((item) => {
        const memory = item.memory;
        const lines = [memory.content, `  ID: ${memory.memory_id}`];
        if (memory.type) lines.push(`  Type: ${memory.type}`);
        lines.push(`  Created: ${memory.created_at}`);
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
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} memories${notesSuffix}:\n\n${detailedText}`,
        },
      ],
      structuredContent,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Found ${results.length} memories${notesSuffix}:\n\n${memoriesText}`,
      },
    ],
    structuredContent,
  };
}

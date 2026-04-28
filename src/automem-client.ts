import type {
  AutoMemConfig,
  BatchMemoryInput,
  MemoryRecord,
  RecallResult,
  HealthStatus,
  StoreMemoryArgs,
  StoreMemoryResult,
  RecallMemoryArgs,
  AssociateMemoryArgs,
  UpdateMemoryArgs,
  DeleteMemoryArgs,
  DeleteMemoryResult,
} from './types.js';

const BATCH_DISALLOWED_FIELDS = ['id', 'embedding', 't_valid', 't_invalid'] as const;
const BATCH_TOP_LEVEL_SINGLE_FIELDS = [
  'content',
  'type',
  'confidence',
  'id',
  'tags',
  'importance',
  'embedding',
  'metadata',
  'timestamp',
  't_valid',
  't_invalid',
  'updated_at',
  'last_accessed',
] as const;
const BATCH_MAX_ITEMS = 500;

function nonEmptyTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0);
}

function mapStoredMemory(raw: any) {
  return {
    memory_id: raw?.id || raw?.memory_id || '',
    content: raw?.content || '',
    tags: raw?.tags || [],
    importance: raw?.importance ?? 0,
    created_at: raw?.timestamp || raw?.created_at || '',
    updated_at: raw?.updated_at || raw?.timestamp || '',
    metadata: raw?.metadata || {},
    type: raw?.type,
    confidence: raw?.confidence,
    last_accessed: raw?.last_accessed,
  };
}

function wrapMemoryAsRecallResult(raw: any): RecallResult['results'][number] {
  const memory = mapStoredMemory(raw);
  return {
    id: memory.memory_id,
    match_type: 'direct',
    final_score: 1,
    score_components: {},
    relations: [],
    related_to: [],
    memory: memory as any,
  };
}

export class AutoMemClient {
  private config: AutoMemConfig;

  constructor(config: AutoMemConfig) {
    this.config = config;
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: any,
    retryCount = 0
  ): Promise<any> {
    const url = `${this.config.endpoint.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);

    const options: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const maxRetries = 3;
    const baseDelay = 500; // 500ms base delay

    // Network errors (fetch) should be retried; HTTP errors handled below
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount);
        console.error(`[AutoMem] Network error, retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(method, path, body, retryCount + 1);
      }

      console.error(`AutoMem API error (${method} ${url}):`, error);
      throw error;
    }
    clearTimeout(timeoutId);

    let data: any;
    try {
      // Some error responses may not be JSON; treat parse errors as non-retryable
      data = await response.json();
    } catch {
      throw new Error(`Invalid JSON response (${response.status})`);
    }

    if (!response.ok) {
      // Retry on 5xx only
      const isRetryable = response.status >= 500 && response.status < 600;

      if (isRetryable && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount); // 500ms, 1s, 2s
        console.error(`[AutoMem] Retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(method, path, body, retryCount + 1);
      }

      const baseMessage =
        (data as any)?.message || (data as any)?.detail || `HTTP ${response.status}`;

      const hint =
        response.status === 401 || response.status === 403
          ? ' (check AUTOMEM_API_KEY or AUTOMEM_API_TOKEN is set for the MCP server process)'
          : '';

      const error = new Error(`${baseMessage}${hint}`);
      console.error(`AutoMem API error (${method} ${url}):`, error);
      throw error;
    }

    return data;
  }

  async storeMemory(args: StoreMemoryArgs): Promise<StoreMemoryResult> {
    if (Array.isArray(args.memories)) {
      const conflictingFields = BATCH_TOP_LEVEL_SINGLE_FIELDS.filter(
        (field) => args[field] !== undefined
      );
      if (conflictingFields.length > 0) {
        throw new Error(
          `store_memory: batch mode accepts per-item fields inside \`memories\` only. Remove top-level single-mode field(s): ${conflictingFields.join(', ')}.`
        );
      }
      return this.batchStore(args.memories);
    }

    if (typeof args.content !== 'string' || args.content.length === 0) {
      throw new Error('store_memory: `content` is required (or pass `memories` for batch mode)');
    }

    const body: MemoryRecord = {
      content: args.content,
      ...(args.type && { type: args.type }),
      ...(args.confidence !== undefined && { confidence: args.confidence }),
      ...(args.id && { id: args.id }),
      tags: args.tags || [],
      importance: args.importance,
      embedding: args.embedding,
      metadata: args.metadata,
      timestamp: args.timestamp,
      ...(args.t_valid && { t_valid: args.t_valid }),
      ...(args.t_invalid && { t_invalid: args.t_invalid }),
      ...(args.updated_at && { updated_at: args.updated_at }),
      ...(args.last_accessed && { last_accessed: args.last_accessed }),
    };

    const response = await this.makeRequest('POST', 'memory', body);
    return {
      memory_id:
        response.memory_id ??
        response.id ??
        response.response?.memory_id,
      message: response.message || 'Memory stored successfully',
    };
  }

  private async batchStore(memories: BatchMemoryInput[]): Promise<StoreMemoryResult> {
    if (memories.length === 0) {
      throw new Error('store_memory: `memories` array must contain at least one item');
    }
    if (memories.length > BATCH_MAX_ITEMS) {
      throw new Error(
        `store_memory: \`memories\` array exceeds max ${BATCH_MAX_ITEMS} items (got ${memories.length})`
      );
    }

    const sanitized = memories.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`store_memory: memories[${index}] must be an object`);
      }
      if (typeof item.content !== 'string' || item.content.trim().length === 0) {
        throw new Error(`store_memory: memories[${index}].content is required`);
      }
      for (const field of BATCH_DISALLOWED_FIELDS) {
        if ((item as any)[field] !== undefined) {
          throw new Error(
            `store_memory: memories[${index}].${field} is not allowed in batch mode (use single-store mode for ${field})`
          );
        }
      }
      const out: BatchMemoryInput = { content: item.content };
      if (item.tags !== undefined) out.tags = item.tags;
      if (item.importance !== undefined) out.importance = item.importance;
      if (item.metadata !== undefined) out.metadata = item.metadata;
      if (item.timestamp !== undefined) out.timestamp = item.timestamp;
      if (item.type !== undefined) out.type = item.type;
      if (item.confidence !== undefined) out.confidence = item.confidence;
      return out;
    });

    const response = await this.makeRequest('POST', 'memory/batch', { memories: sanitized });
    const memoryIds: string[] = Array.isArray(response.memory_ids) ? response.memory_ids : [];
    const stored: number =
      typeof response.stored === 'number' ? response.stored : memoryIds.length;
    return {
      memory_ids: memoryIds,
      stored,
      qdrant: response.qdrant,
      enrichment: response.enrichment,
      query_time_ms: response.query_time_ms,
      message: response.message || `Stored ${stored} memories`,
    };
  }

  async recallMemory(args: RecallMemoryArgs): Promise<RecallResult> {
    // Mode 1: ID fetch — short-circuit to GET /memory/{id}.
    if (typeof args.memory_id === 'string' && args.memory_id.trim().length > 0) {
      const memory = await this.fetchMemoryById(args.memory_id.trim());
      return {
        results: memory ? [wrapMemoryAsRecallResult(memory)] : [],
        count: memory ? 1 : 0,
        mode: 'id_fetch',
      };
    }

    // Mode 2: tag enumeration — route to GET /memory/by-tag for paginated exact-match listing.
    if (args.exhaustive === true) {
      const cleanTags = nonEmptyTags(args.tags);
      if (cleanTags.length === 0) {
        throw new Error(
          'recall_memory: `exhaustive: true` requires non-empty `tags`'
        );
      }
      if (args.tag_match && args.tag_match !== 'exact') {
        throw new Error(
          'recall_memory: enumeration mode (`exhaustive: true`) only supports exact tag matching; remove `tag_match: "prefix"`'
        );
      }
      if (args.tag_mode && args.tag_mode !== 'any') {
        throw new Error(
          'recall_memory: enumeration mode (`exhaustive: true`) only supports any-of tag matching; remove `tag_mode: "all"`'
        );
      }
      // Reject ranked-only params that would silently change the meaning of the query.
      // Without this, `recall_memory({ tags, exhaustive: true, time_query: "last 7 days" })`
      // would return *all* memories tagged X (ignoring the time window), which is misleading.
      const rankedOnlyParams: Array<keyof RecallMemoryArgs> = [
        'query',
        'queries',
        'embedding',
        'time_query',
        'start',
        'end',
        'exclude_tags',
        'expand_relations',
        'expand_entities',
        'auto_decompose',
        'expansion_limit',
        'relation_limit',
        'expand_min_importance',
        'expand_min_strength',
        'sort',
      ];
      const conflicting = rankedOnlyParams.filter((key) => {
        const v = (args as Record<string, unknown>)[key];
        if (v === undefined || v === null) return false;
        if (Array.isArray(v)) return v.length > 0;
        return true;
      });
      if (conflicting.length > 0) {
        throw new Error(
          `recall_memory: enumeration mode (\`exhaustive: true\`) only accepts \`tags\`, \`limit\`, \`offset\`, \`tag_mode: "any"\`, \`tag_match: "exact"\`, and \`format\`. Remove ranked-only param(s): ${conflicting.join(', ')}.`
        );
      }
      return this.listByTag(cleanTags, args.limit, args.offset);
    }

    // Mode 3: ranked retrieval — existing /recall path.
    const params = new URLSearchParams();

    // Support single query OR multiple queries
    if (args.query) {
      params.set('query', args.query);
    }

    if (Array.isArray(args.queries) && args.queries.length > 0) {
      args.queries.filter(q => q && q.trim()).forEach((q) => params.append('queries', q));
    }

    if (args.limit) {
      params.set('limit', String(args.limit));
    }

    if (Array.isArray(args.embedding)) {
      params.set('embedding', args.embedding.join(','));
    }

    if (args.time_query) {
      params.set('time_query', args.time_query);
    }

    if (args.start) {
      params.set('start', args.start);
    }

    if (args.end) {
      params.set('end', args.end);
    }

    if (Array.isArray(args.tags)) {
      args.tags.forEach((tag) => params.append('tags', tag));
    }

    if (Array.isArray(args.exclude_tags) && args.exclude_tags.length > 0) {
      args.exclude_tags.forEach((tag) => params.append('exclude_tags', tag));
    }

    if (args.tag_mode && (args.tag_mode === 'any' || args.tag_mode === 'all')) {
      params.set('tag_mode', args.tag_mode);
    }

    if (args.tag_match && (args.tag_match === 'exact' || args.tag_match === 'prefix')) {
      params.set('tag_match', args.tag_match);
    }

    // Graph expansion options
    if (typeof args.expand_relations === 'boolean') {
      params.set('expand_relations', String(args.expand_relations));
    }

    if (typeof args.expand_entities === 'boolean') {
      params.set('expand_entities', String(args.expand_entities));
    }

    if (typeof args.auto_decompose === 'boolean') {
      params.set('auto_decompose', String(args.auto_decompose));
    }

    if (typeof args.expansion_limit === 'number') {
      params.set('expansion_limit', String(args.expansion_limit));
    }

    if (typeof args.relation_limit === 'number') {
      params.set('relation_limit', String(args.relation_limit));
    }

    // Expansion filtering (reduces noise)
    if (typeof args.expand_min_importance === 'number') {
      params.set('expand_min_importance', String(args.expand_min_importance));
    }

    if (typeof args.expand_min_strength === 'number') {
      params.set('expand_min_strength', String(args.expand_min_strength));
    }

    // Context hints for smarter recall
    if (args.context) {
      params.set('context', args.context);
    }

    if (args.language) {
      params.set('language', args.language);
    }

    if (args.active_path) {
      params.set('active_path', args.active_path);
    }

    if (Array.isArray(args.context_tags) && args.context_tags.length > 0) {
      args.context_tags.forEach((tag) => params.append('context_tags', tag));
    }

    if (Array.isArray(args.context_types) && args.context_types.length > 0) {
      args.context_types.forEach((t) => params.append('context_types', t));
    }

    if (Array.isArray(args.priority_ids) && args.priority_ids.length > 0) {
      args.priority_ids.forEach((id) => params.append('priority_ids', id));
    }

    // Pagination and output control
    if (args.per_query_limit !== undefined && args.per_query_limit > 0) {
      params.set('per_query_limit', String(args.per_query_limit));
    }

    if (args.sort) {
      params.set('sort', args.sort);
    }

    if (args.format) {
      params.set('format', args.format);
    }

    if (args.offset !== undefined && args.offset > 0) {
      params.set('offset', String(args.offset));
    }

    const queryString = params.toString();
    const path = queryString ? `recall?${queryString}` : 'recall';

    const response = await this.makeRequest('GET', path);
    return {
      results: (response.results || []).map((result: any) => ({
        id: result.id,
        match_type: result.match_type,
        match_score: result.match_score,
        relation_score: result.relation_score,
        final_score: result.final_score ?? result.score ?? 0,
        score_components: result.score_components || {},
        source: result.source,
        relations: result.relations || [],
        related_to: result.related_to || result.relations || [],
        expanded_from_entity: result.expanded_from_entity,
        memory: {
          memory_id: result.id,
          content: result.memory?.content || '',
          tags: result.memory?.tags || [],
          importance: result.memory?.importance ?? 0,
          created_at: result.memory?.timestamp || result.memory?.created_at || '',
          updated_at: result.memory?.updated_at || result.memory?.timestamp || '',
          metadata: result.memory?.metadata || {},
          type: result.memory?.type,
          confidence: result.memory?.confidence,
        },
      })),
      count: response.count || (response.results ? response.results.length : 0),
      mode: 'ranked',
      dedup_removed: response.dedup_removed,
      keywords: response.keywords,
      time_window: response.time_window,
      tags: response.tags,
      tag_mode: response.tag_mode,
      tag_match: response.tag_match,
      expansion: response.expansion,
      entity_expansion: response.entity_expansion,
      context_priority: response.context_priority,
    };
  }

  private async fetchMemoryById(memoryId: string): Promise<any | null> {
    const response = await this.makeRequest('GET', `memory/${encodeURIComponent(memoryId)}`);
    return response?.memory ?? response ?? null;
  }

  private async listByTag(
    tags: string[],
    limit?: number,
    offset?: number
  ): Promise<RecallResult> {
    const params = new URLSearchParams();
    tags.forEach((tag) => params.append('tags', tag));
    if (typeof limit === 'number' && limit > 0) {
      params.set('limit', String(Math.min(Math.floor(limit), 200)));
    }
    if (typeof offset === 'number' && offset > 0) {
      params.set('offset', String(Math.floor(offset)));
    }
    const response = await this.makeRequest('GET', `memory/by-tag?${params.toString()}`);
    const memories = Array.isArray(response.memories) ? response.memories : [];
    return {
      results: memories.map((m: any) => wrapMemoryAsRecallResult(m)),
      count: typeof response.count === 'number' ? response.count : memories.length,
      mode: 'enumeration',
      tags: response.tags ?? tags,
      limit: response.limit,
      offset: response.offset,
      has_more: Boolean(response.has_more),
    };
  }

  async associateMemories(args: AssociateMemoryArgs): Promise<{ success: boolean; message: string }> {
    const response = await this.makeRequest('POST', 'associate', {
      memory1_id: args.memory1_id,
      memory2_id: args.memory2_id,
      type: args.type,
      strength: args.strength,
    });

    return {
      success: true,
      message: response.message || 'Association created successfully',
    };
  }

  async checkHealth(): Promise<HealthStatus> {
    try {
      const response = await this.makeRequest('GET', 'health');
      
      return {
        status: response.status === 'healthy' ? 'healthy' : 'error',
        backend: 'automem',
        statistics: {
          falkordb: response.falkordb,
          qdrant: response.qdrant,
          graph: response.graph,
          timestamp: response.timestamp,
        },
        error: response.status !== 'healthy' ? 'Service unhealthy' : undefined,
      };
    } catch (error) {
      return {
        status: 'error',
        backend: 'automem',
        statistics: {},
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async updateMemory(args: UpdateMemoryArgs): Promise<{ memory_id: string; message: string }> {
    const { memory_id, ...updates } = args;
    if (!memory_id) {
      throw new Error('memory_id is required');
    }

    const response = await this.makeRequest('PATCH', `memory/${memory_id}`, updates);
    return {
      memory_id: response.memory_id || memory_id,
      message: response.message || 'Memory updated successfully',
    };
  }

  async deleteMemory(args: DeleteMemoryArgs): Promise<DeleteMemoryResult> {
    const cleanTags = nonEmptyTags(args.tags);
    const hasTags = cleanTags.length > 0;
    const hasId = typeof args.memory_id === 'string' && args.memory_id.trim().length > 0;

    if (hasTags && hasId) {
      throw new Error(
        'delete_memory: pass either `memory_id` (single) or `tags` (bulk-by-tag), not both'
      );
    }

    if (hasTags) {
      return this.bulkDeleteByTag(cleanTags);
    }

    if (!hasId) {
      throw new Error('delete_memory: `memory_id` or `tags` is required');
    }

    const response = await this.makeRequest('DELETE', `memory/${args.memory_id}`);
    return {
      memory_id: response.memory_id || args.memory_id,
      message: response.message || 'Memory deleted successfully',
    };
  }

  private async bulkDeleteByTag(tags: string[]): Promise<DeleteMemoryResult> {
    const params = new URLSearchParams();
    tags.forEach((tag) => params.append('tags', tag));
    const response = await this.makeRequest('DELETE', `memory/by-tag?${params.toString()}`);
    const deleted = typeof response.deleted_count === 'number' ? response.deleted_count : 0;
    return {
      deleted_count: deleted,
      tags: response.tags ?? tags,
      message:
        response.message ||
        `Deleted ${deleted} memor${deleted === 1 ? 'y' : 'ies'} matching tag(s) ${tags.join(', ')}`,
    };
  }
}

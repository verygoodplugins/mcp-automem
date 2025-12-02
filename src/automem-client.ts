import fetch from 'node-fetch';
import type {
  AutoMemConfig,
  MemoryRecord,
  RecallResult,
  HealthStatus,
  StoreMemoryArgs,
  RecallMemoryArgs,
  AssociateMemoryArgs,
  UpdateMemoryArgs,
  DeleteMemoryArgs,
  TagSearchArgs,
} from './types.js';

export class AutoMemClient {
  private config: AutoMemConfig;

  constructor(config: AutoMemConfig) {
    this.config = config;
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: any
  ): Promise<any> {
    const url = `${this.config.endpoint.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const options: any = {
      method,
      headers,
      timeout: 25000, // 25s timeout - Claude Desktop has ~30s MCP timeout
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error((data as any).message || (data as any).detail || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`AutoMem API error (${method} ${url}):`, error);
      throw error;
    }
  }

  async storeMemory(args: StoreMemoryArgs): Promise<{ memory_id: string; message: string }> {
    const body: MemoryRecord = {
      content: args.content,
      tags: args.tags || [],
      importance: args.importance,
      embedding: args.embedding,
      metadata: args.metadata,
      timestamp: args.timestamp,
    };

    const response = await this.makeRequest('POST', 'memory', body);
    return {
      memory_id: response.memory_id || response.id,
      message: response.message || 'Memory stored successfully',
    };
  }

  async recallMemory(args: RecallMemoryArgs): Promise<RecallResult> {
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

  async deleteMemory(args: DeleteMemoryArgs): Promise<{ memory_id: string; message: string }> {
    if (!args.memory_id) {
      throw new Error('memory_id is required');
    }

    const response = await this.makeRequest('DELETE', `memory/${args.memory_id}`);
    return {
      memory_id: response.memory_id || args.memory_id,
      message: response.message || 'Memory deleted successfully',
    };
  }

  async searchByTag(args: TagSearchArgs): Promise<RecallResult> {
    if (!args.tags || args.tags.length === 0) {
      throw new Error('At least one tag is required');
    }

    const params = new URLSearchParams();
    args.tags.forEach((tag) => params.append('tags', tag));
    if (args.limit) {
      params.set('limit', String(args.limit));
    }

    const response = await this.makeRequest('GET', `memory/by-tag?${params.toString()}`);
    return {
      results: (response.memories || []).map((memory: any) => ({
        id: memory.id,
        match_type: 'tag',
        final_score: memory.importance ?? 0,
        score_components: { importance: memory.importance ?? 0 },
        memory: {
          memory_id: memory.id,
          content: memory.content || '',
          tags: memory.tags || [],
          importance: memory.importance ?? 0,
          created_at: memory.timestamp || memory.created_at || '',
          updated_at: memory.updated_at || memory.timestamp || '',
          metadata: memory.metadata || {},
          type: memory.type,
          confidence: memory.confidence,
        },
      })),
      count: response.count || (response.memories ? response.memories.length : 0),
      tags: response.tags,
    };
  }
}

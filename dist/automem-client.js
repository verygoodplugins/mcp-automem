import fetch from 'node-fetch';
import { Agent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { CircuitBreaker } from './circuit-breaker.js';
const httpAgent = new Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
export class AutoMemClient {
    config;
    circuitBreaker;
    constructor(config) {
        this.config = config;
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            resetTimeout: 30000,
            successThreshold: 2,
        });
    }
    async makeRequest(method, path, body, retryCount = 0) {
        if (!this.circuitBreaker.canExecute()) {
            const stats = this.circuitBreaker.getStats();
            const secondsUntilRetry = Math.ceil((stats.lastFailureTime + 30000 - Date.now()) / 1000);
            throw new Error(`AutoMem service unavailable (circuit ${stats.state}). ` +
                `Last failure: ${new Date(stats.lastFailureTime).toISOString()}. ` +
                `Will retry after ${Math.max(secondsUntilRetry, 0)}s.`);
        }
        const url = `${this.config.endpoint.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }
        const options = {
            method,
            headers,
            timeout: 25000, // 25s timeout - Claude Desktop has ~30s MCP timeout
            agent: url.startsWith('https://') ? httpsAgent : httpAgent,
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
        }
        catch (error) {
            if (error instanceof Error && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.error(`[AutoMem] Network error, retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.makeRequest(method, path, body, retryCount + 1);
            }
            this.circuitBreaker.recordFailure();
            console.error(`AutoMem API error (${method} ${url}):`, error);
            throw error;
        }
        let data = null;
        try {
            // Some error responses may not be JSON; treat parse errors as non-retryable
            data = await response.json();
        }
        catch (parseError) {
            this.circuitBreaker.recordFailure();
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
            if (response.status >= 500) {
                this.circuitBreaker.recordFailure();
            }
            const error = new Error(data?.message || data?.detail || `HTTP ${response.status}`);
            console.error(`AutoMem API error (${method} ${url}):`, error);
            throw error;
        }
        this.circuitBreaker.recordSuccess();
        return data;
    }
    async storeMemory(args) {
        const body = {
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
    async recallMemory(args) {
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
        const queryString = params.toString();
        const path = queryString ? `recall?${queryString}` : 'recall';
        const response = await this.makeRequest('GET', path);
        return {
            results: (response.results || []).map((result) => ({
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
    async associateMemories(args) {
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
    async checkHealth() {
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
        }
        catch (error) {
            return {
                status: 'error',
                backend: 'automem',
                statistics: {},
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async updateMemory(args) {
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
    async deleteMemory(args) {
        if (!args.memory_id) {
            throw new Error('memory_id is required');
        }
        const response = await this.makeRequest('DELETE', `memory/${args.memory_id}`);
        return {
            memory_id: response.memory_id || args.memory_id,
            message: response.message || 'Memory deleted successfully',
        };
    }
    getCircuitState() {
        const stats = this.circuitBreaker.getStats();
        return {
            state: stats.state,
            failureCount: stats.failureCount,
            lastFailureTime: stats.lastFailureTime,
        };
    }
    resetCircuit() {
        this.circuitBreaker.reset();
    }
}
//# sourceMappingURL=automem-client.js.map
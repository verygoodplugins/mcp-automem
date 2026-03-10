import { AutoMemClient } from './automem-client.js';
import type {
  AssociateMemoryArgs,
  DeleteMemoryArgs,
  RecallMemoryArgs,
  StoreMemoryArgs,
  UpdateMemoryArgs,
} from './types.js';
import { AUTHORABLE_RELATION_TYPES } from './types.js';

type PluginConfig = {
  endpoint: string;
  apiKey?: string;
  autoRecall: boolean;
  autoRecallLimit: number;
  exposure: 'dm-only' | 'all' | 'off';
  defaultTags: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function mergeTags(defaultTags: string[], provided: string[] | undefined, injectIfMissingOnly = false): string[] | undefined {
  const nextProvided = Array.isArray(provided) ? provided.filter(Boolean) : [];
  if (injectIfMissingOnly && nextProvided.length > 0) {
    return nextProvided;
  }

  const merged = [...defaultTags, ...nextProvided].filter(Boolean);
  const deduped = [...new Set(merged)];
  return deduped.length > 0 ? deduped : undefined;
}

function parsePluginConfig(value: unknown): PluginConfig {
  const raw = isRecord(value) ? value : {};
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
  if (!endpoint) {
    throw new Error('AutoMem OpenClaw plugin requires config.endpoint');
  }

  const apiKey = typeof raw.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : undefined;
  const autoRecall = typeof raw.autoRecall === 'boolean' ? raw.autoRecall : true;
  const rawLimit =
    typeof raw.autoRecallLimit === 'number'
      ? raw.autoRecallLimit
      : typeof raw.autoRecallLimit === 'string'
        ? Number.parseInt(raw.autoRecallLimit, 10)
        : Number.NaN;
  const autoRecallLimit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 10) : 3;
  const exposure =
    raw.exposure === 'all' || raw.exposure === 'off' || raw.exposure === 'dm-only'
      ? raw.exposure
      : 'dm-only';

  return {
    endpoint,
    apiKey,
    autoRecall,
    autoRecallLimit,
    exposure,
    defaultTags: normalizeStringArray(raw.defaultTags),
  };
}

function shouldAutoRecall(exposure: PluginConfig['exposure'], sessionKey?: string): boolean {
  if (exposure === 'off') {
    return false;
  }

  if (exposure === 'all') {
    return true;
  }

  const normalized = String(sessionKey || '').trim().toLowerCase();
  if (!normalized || normalized === 'main') {
    return true;
  }

  if (normalized.startsWith('hook:')) {
    return false;
  }

  return ![':group:', ':channel:', ':room:', ':thread:'].some((marker) =>
    normalized.includes(marker)
  );
}

function formatRecallContext(result: { memory?: { content?: string; tags?: string[]; type?: string } }): string {
  const content = String(result.memory?.content || '').replace(/\s+/g, ' ').trim();
  const compact = content.length > 220 ? `${content.slice(0, 217)}...` : content;
  const tags = Array.isArray(result.memory?.tags) && result.memory.tags.length > 0
    ? ` [tags: ${result.memory.tags.slice(0, 4).join(', ')}]`
    : '';
  const type = result.memory?.type ? `[${result.memory.type}] ` : '';
  return `- ${type}${compact}${tags}`;
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

const emptyToolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const storeMemorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['content'],
  properties: {
    content: { type: 'string', description: 'Memory content to store.' },
    type: { type: 'string', description: 'Memory classification.' },
    confidence: { type: 'number' },
    id: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    importance: { type: 'number' },
    embedding: { type: 'array', items: { type: 'number' } },
    metadata: { type: 'object' },
    timestamp: { type: 'string' },
    t_valid: { type: 'string' },
    t_invalid: { type: 'string' },
    updated_at: { type: 'string' },
    last_accessed: { type: 'string' },
  },
};

const recallMemorySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    queries: { type: 'array', items: { type: 'string' } },
    embedding: { type: 'array', items: { type: 'number' } },
    limit: { type: 'number' },
    time_query: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    tag_mode: { type: 'string', enum: ['any', 'all'] },
    tag_match: { type: 'string', enum: ['exact', 'prefix'] },
    expand_relations: { type: 'boolean' },
    expand_entities: { type: 'boolean' },
    auto_decompose: { type: 'boolean' },
    expansion_limit: { type: 'number' },
    relation_limit: { type: 'number' },
    expand_min_importance: { type: 'number' },
    expand_min_strength: { type: 'number' },
    context: { type: 'string' },
    language: { type: 'string' },
    active_path: { type: 'string' },
    context_tags: { type: 'array', items: { type: 'string' } },
    context_types: { type: 'array', items: { type: 'string' } },
    priority_ids: { type: 'array', items: { type: 'string' } },
    per_query_limit: { type: 'number' },
    sort: { type: 'string' },
    format: { type: 'string' },
    offset: { type: 'number' },
  },
};

const updateMemorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memory_id'],
  properties: {
    memory_id: { type: 'string' },
    content: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    importance: { type: 'number' },
    metadata: { type: 'object' },
    timestamp: { type: 'string' },
    updated_at: { type: 'string' },
    last_accessed: { type: 'string' },
    type: { type: 'string' },
    confidence: { type: 'number' },
  },
};

const deleteMemorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memory_id'],
  properties: {
    memory_id: { type: 'string' },
  },
};

const associateMemorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memory1_id', 'memory2_id', 'type', 'strength'],
  properties: {
    memory1_id: { type: 'string' },
    memory2_id: { type: 'string' },
    type: { type: 'string', enum: [...AUTHORABLE_RELATION_TYPES] },
    strength: { type: 'number' },
  },
};

const openClawPlugin = {
  id: 'automem',
  name: 'AutoMem',
  description: 'Persistent AutoMem-backed graph memory for OpenClaw.',
  kind: 'memory',
  configSchema: {
    parse: parsePluginConfig,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['endpoint'],
      properties: {
        endpoint: { type: 'string', minLength: 1 },
        apiKey: { type: 'string' },
        autoRecall: { type: 'boolean', default: true },
        autoRecallLimit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
        exposure: { type: 'string', enum: ['dm-only', 'all', 'off'], default: 'dm-only' },
        defaultTags: { type: 'array', items: { type: 'string' } },
      },
    },
    uiHints: {
      endpoint: {
        label: 'Endpoint',
        help: 'Base URL for the AutoMem service.',
        placeholder: 'http://127.0.0.1:8001',
      },
      apiKey: {
        label: 'API Key',
        sensitive: true,
        help: 'Optional bearer token for authenticated AutoMem deployments.',
      },
      autoRecall: {
        label: 'Auto Recall',
        help: 'Recall memory before an agent turn starts.',
      },
      autoRecallLimit: {
        label: 'Auto Recall Limit',
      },
      exposure: {
        label: 'Exposure',
        help: 'Limit auto-recall to DMs/private sessions by default.',
      },
      defaultTags: {
        label: 'Default Tags',
        help: 'Applied to stored memories and default recall scope when tags are omitted.',
      },
    },
  },
  register(api: {
    pluginConfig?: unknown;
    logger: { warn: (message: string) => void };
    registerTool: (tool: {
      name: string;
      label: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (_toolCallId: string, params: unknown) => Promise<unknown>;
    }) => void;
    on: (
      hookName: 'before_agent_start',
      handler: (
        event: { prompt: string },
        ctx: { sessionKey?: string }
      ) => Promise<{ prependContext?: string } | void>
    ) => void;
  }) {
    const config = parsePluginConfig(api.pluginConfig);
    const client = new AutoMemClient({
      endpoint: config.endpoint,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    });

    api.registerTool({
      name: 'automem_store_memory',
      label: 'AutoMem Store Memory',
      description: 'Store a durable memory in AutoMem.',
      parameters: storeMemorySchema,
      async execute(_toolCallId, params) {
        const request = params as StoreMemoryArgs;
        const result = await client.storeMemory({
          ...request,
          tags: mergeTags(config.defaultTags, request.tags),
        });
        return jsonResult(result);
      },
    });

    api.registerTool({
      name: 'automem_recall_memory',
      label: 'AutoMem Recall Memory',
      description: 'Recall relevant memories from AutoMem.',
      parameters: recallMemorySchema,
      async execute(_toolCallId, params) {
        const request = params as RecallMemoryArgs;
        const result = await client.recallMemory({
          ...request,
          tags: mergeTags(config.defaultTags, request.tags, true),
        });
        return jsonResult(result);
      },
    });

    api.registerTool({
      name: 'automem_update_memory',
      label: 'AutoMem Update Memory',
      description: 'Update a stored AutoMem memory.',
      parameters: updateMemorySchema,
      async execute(_toolCallId, params) {
        const request = params as UpdateMemoryArgs;
        const result = await client.updateMemory({
          ...request,
          tags: mergeTags(config.defaultTags, request.tags),
        });
        return jsonResult(result);
      },
    });

    api.registerTool({
      name: 'automem_delete_memory',
      label: 'AutoMem Delete Memory',
      description: 'Delete a stored AutoMem memory by id.',
      parameters: deleteMemorySchema,
      async execute(_toolCallId, params) {
        const result = await client.deleteMemory(params as DeleteMemoryArgs);
        return jsonResult(result);
      },
    });

    api.registerTool({
      name: 'automem_associate_memories',
      label: 'AutoMem Associate Memories',
      description: 'Create a typed relationship between two memories.',
      parameters: associateMemorySchema,
      async execute(_toolCallId, params) {
        const result = await client.associateMemories(params as AssociateMemoryArgs);
        return jsonResult(result);
      },
    });

    api.registerTool({
      name: 'automem_check_health',
      label: 'AutoMem Check Health',
      description: 'Check the AutoMem service health.',
      parameters: emptyToolSchema,
      async execute() {
        const result = await client.checkHealth();
        return jsonResult(result);
      },
    });

    if (config.autoRecall) {
      api.on('before_agent_start', async (event, ctx) => {
        const prompt = String(event.prompt || '').trim();
        if (!prompt || !shouldAutoRecall(config.exposure, ctx.sessionKey)) {
          return;
        }

        try {
          const result = await client.recallMemory({
            query: prompt,
            limit: config.autoRecallLimit,
            tags: mergeTags(config.defaultTags, undefined),
          });

          if (!Array.isArray(result.results) || result.results.length === 0) {
            return;
          }

          const memoryContext = result.results
            .slice(0, config.autoRecallLimit)
            .map((entry) => formatRecallContext(entry))
            .join('\n');

          return {
            prependContext: `<relevant-memories>\nThe following AutoMem memories may be relevant to this turn:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (error) {
          api.logger.warn(`automem: auto-recall failed: ${String(error)}`);
        }
      });
    }
  },
};

export default openClawPlugin;

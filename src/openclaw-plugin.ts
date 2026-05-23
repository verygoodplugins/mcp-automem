import { AutoMemClient } from './automem-client.js';
import {
  type OpenClawRecallLikeResult,
  buildOpenClawStartupContext,
  dedupeOpenClawRecallResults,
  formatOpenClawRecallContext,
} from './openclaw-startup-profile.js';
import {
  AUTOMEM_POLICY_DEFAULTS,
  isSubstantivePrompt,
  looksLikeDebugPrompt,
  looksLikeExplicitRecallPrompt,
  renderOpenClawPolicyContext,
  resolveProjectGateTags,
} from './memory-policy/shared.js';
import type {
  AssociateMemoryArgs,
  BatchMemoryInput,
  DeleteMemoryArgs,
  RecallMemoryArgs,
  StoreMemoryArgs,
  UpdateMemoryArgs,
} from './types.js';
import { AUTHORABLE_RELATION_TYPES } from './types.js';

type PluginConfig = {
  endpoint?: string;
  apiKey?: string;
  autoRecall: boolean;
  preferenceRecallLimit: number;
  contextRecallLimit: number;
  debugRecallLimit: number;
  contextRecallWindowDays: number;
  exposure: 'dm-only' | 'all' | 'off';
  defaultTags: string[];
  startupProfile?: string;
};

type SessionState = {
  seenEntities: Set<string>;
};

const MAX_SESSION_STATES = 500;
const MAX_SEEN_ENTITIES_PER_SESSION = 200;
const sessionStates = new Map<string, SessionState>();
const COMMON_ENTITY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'automem',
  'do',
  'how',
  'i',
  'it',
  'jack',
  'tell',
  'the',
  'they',
  'we',
  'what',
  'who',
  'why',
  'you',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}

function mergeTags(
  defaultTags: string[],
  provided: string[] | undefined,
  injectIfMissingOnly = false
): string[] | undefined {
  const nextProvided = Array.isArray(provided) ? provided.filter(Boolean) : [];
  if (injectIfMissingOnly && nextProvided.length > 0) {
    return nextProvided;
  }

  const merged = [...defaultTags, ...nextProvided].filter(Boolean);
  const deduped = [...new Set(merged)];
  return deduped.length > 0 ? deduped : undefined;
}

function explicitTags(provided: string[] | undefined): string[] | undefined {
  const nextProvided = Array.isArray(provided) ? provided.filter(Boolean) : [];
  const deduped = [...new Set(nextProvided)];
  return deduped.length > 0 ? deduped : undefined;
}

function parseOptionalInteger(value: unknown, max: number): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.min(parsed, max);
}

function parsePluginConfig(value: unknown): PluginConfig {
  const raw = isRecord(value) ? value : {};
  const endpoint =
    typeof raw.endpoint === 'string' && raw.endpoint.trim() ? raw.endpoint.trim() : undefined;

  const apiKey =
    typeof raw.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : undefined;
  const autoRecall = typeof raw.autoRecall === 'boolean' ? raw.autoRecall : true;
  const legacyAutoRecallLimit = parseOptionalInteger(raw.autoRecallLimit, 50);
  const preferenceRecallLimit =
    parseOptionalInteger(raw.preferenceRecallLimit, 50) ??
    legacyAutoRecallLimit ??
    AUTOMEM_POLICY_DEFAULTS.preferenceRecallLimit;
  const contextRecallLimit =
    parseOptionalInteger(raw.contextRecallLimit, 50) ??
    legacyAutoRecallLimit ??
    AUTOMEM_POLICY_DEFAULTS.contextRecallLimit;
  const debugRecallLimit =
    parseOptionalInteger(raw.debugRecallLimit, 50) ??
    legacyAutoRecallLimit ??
    AUTOMEM_POLICY_DEFAULTS.debugRecallLimit;
  const contextRecallWindowDays =
    parseOptionalInteger(raw.contextRecallWindowDays, 365) ??
    AUTOMEM_POLICY_DEFAULTS.contextRecallWindowDays;
  const exposure =
    raw.exposure === 'all' || raw.exposure === 'off' || raw.exposure === 'dm-only'
      ? raw.exposure
      : 'dm-only';

  return {
    endpoint,
    apiKey,
    autoRecall,
    preferenceRecallLimit,
    contextRecallLimit,
    debugRecallLimit,
    contextRecallWindowDays,
    exposure,
    defaultTags: normalizeStringArray(raw.defaultTags),
    startupProfile:
      typeof raw.startupProfile === 'string' && raw.startupProfile.trim()
        ? raw.startupProfile.trim()
        : undefined,
  };
}

function shouldAutoRecall(exposure: PluginConfig['exposure'], sessionKey?: string): boolean {
  if (exposure === 'off') {
    return false;
  }

  if (exposure === 'all') {
    return true;
  }

  const normalized = String(sessionKey || '')
    .trim()
    .toLowerCase();
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

function configSkipsBootstrap(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const agents = isRecord(value.agents) ? value.agents : undefined;
  const defaults = isRecord(agents?.defaults) ? agents.defaults : undefined;
  return defaults?.skipBootstrap === true;
}

export function isLikelyStartupTurn(messages: unknown): boolean {
  return Array.isArray(messages) && messages.length <= 1;
}

function normalizeSessionKey(sessionKey?: string): string {
  const normalized = String(sessionKey || '').trim();
  return normalized || '__default__';
}

function getSessionState(sessionKey?: string): SessionState {
  const key = normalizeSessionKey(sessionKey);
  let state = sessionStates.get(key);
  if (state) {
    sessionStates.delete(key);
    sessionStates.set(key, state);
    return state;
  }
  state = { seenEntities: new Set<string>() };
  sessionStates.set(key, state);
  while (sessionStates.size > MAX_SESSION_STATES) {
    const oldest = sessionStates.keys().next().value;
    if (typeof oldest !== 'string') break;
    sessionStates.delete(oldest);
  }
  return state;
}

function addSeenEntity(state: SessionState, entity: string): void {
  if (state.seenEntities.has(entity)) {
    state.seenEntities.delete(entity);
  }
  state.seenEntities.add(entity);
  while (state.seenEntities.size > MAX_SEEN_ENTITIES_PER_SESSION) {
    const oldest = state.seenEntities.values().next().value;
    if (typeof oldest !== 'string') break;
    state.seenEntities.delete(oldest);
  }
}

export function resetOpenClawSessionStateForTests(): void {
  sessionStates.clear();
}

function extractPromptEntities(prompt: string): string[] {
  const source = String(prompt || '');
  const matches = new Set<string>();

  for (const match of source.matchAll(/"([^"\n]{2,80})"/g)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      matches.add(candidate);
    }
  }

  for (const match of source.matchAll(/\b[A-Z][a-z][A-Za-z0-9_-]{1,}\b/g)) {
    const candidate = match[0]?.trim();
    if (match.index === 0) {
      continue;
    }
    if (candidate && !COMMON_ENTITY_STOPWORDS.has(candidate.toLowerCase())) {
      matches.add(candidate);
    }
  }

  for (const match of source.matchAll(/\b[a-z0-9]+(?:[-_/][a-z0-9]+)+\b/gi)) {
    const candidate = match[0]?.trim();
    if (
      candidate &&
      candidate.length >= 4 &&
      !COMMON_ENTITY_STOPWORDS.has(candidate.toLowerCase())
    ) {
      matches.add(candidate);
    }
  }

  return [...matches];
}

function hasNewPromptEntities(prompt: string, sessionKey?: string): boolean {
  const state = getSessionState(sessionKey);
  const entities = extractPromptEntities(prompt);
  return entities.some((entity) => !state.seenEntities.has(entity.toLowerCase()));
}

function rememberPromptEntities(prompt: string, sessionKey?: string): void {
  const state = getSessionState(sessionKey);
  for (const entity of extractPromptEntities(prompt)) {
    addSeenEntity(state, entity.toLowerCase());
  }
}

function buildRelevantMemoriesSection(
  results: OpenClawRecallLikeResult[],
  maxEntries: number
): string | undefined {
  const uniqueResults = dedupeOpenClawRecallResults(results);
  if (uniqueResults.length === 0) {
    return undefined;
  }

  const memoryContext = uniqueResults
    .slice(0, maxEntries)
    .map((entry) => formatOpenClawRecallContext(entry))
    .join('\n');
  return `<relevant-memories>\nThe following AutoMem memories may be relevant to this turn:\n${memoryContext}\n</relevant-memories>`;
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
  properties: {
    content: { type: 'string', description: 'Single-mode (XOR with `memories`). Memory content to store.' },
    memories: {
      type: 'array',
      maxItems: 500,
      description:
        'Batch mode (XOR with `content`). Up to 500 memories per call. Per-item `id`/`embedding`/`t_valid`/`t_invalid` are not supported in batch mode.',
      items: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          importance: { type: 'number' },
          metadata: { type: 'object' },
          timestamp: { type: 'string' },
          type: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
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
    memory_id: { type: 'string', description: 'Mode 1: ID fetch. When set, ignores all other params.' },
    exhaustive: { type: 'boolean', description: 'Mode 2: tag enumeration. When true with `tags`, paginated exact-match listing.' },
    exclude_tags: { type: 'array', items: { type: 'string' }, description: 'Ranked-mode only. Tags to exclude.' },
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
  properties: {
    memory_id: { type: 'string', description: 'Single-delete mode (XOR with `tags`).' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Bulk-delete mode (XOR with `memory_id`). Deletes all memories tagged with ANY of these (exact, case-insensitive). No dry-run.',
    },
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
  configSchema: {
    parse: parsePluginConfig,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint: { type: 'string', minLength: 1 },
        apiKey: { type: 'string' },
        autoRecall: { type: 'boolean', default: true },
        autoRecallLimit: { type: 'integer', minimum: 1, maximum: 50 },
        preferenceRecallLimit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        contextRecallLimit: { type: 'integer', minimum: 1, maximum: 50, default: 30 },
        debugRecallLimit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        contextRecallWindowDays: { type: 'integer', minimum: 1, maximum: 365, default: 90 },
        exposure: { type: 'string', enum: ['dm-only', 'all', 'off'], default: 'dm-only' },
        defaultTags: { type: 'array', items: { type: 'string' } },
        startupProfile: { type: 'string' },
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
        label: 'Legacy Auto Recall Limit',
        help: 'Compatibility fallback for older installs. Prefer the per-phase recall settings below.',
      },
      preferenceRecallLimit: {
        label: 'Preference Recall Limit',
      },
      contextRecallLimit: {
        label: 'Context Recall Limit',
      },
      debugRecallLimit: {
        label: 'Debug Recall Limit',
      },
      contextRecallWindowDays: {
        label: 'Context Recall Window (days)',
      },
      exposure: {
        label: 'Exposure',
        help: 'Limit auto-recall to DMs/private sessions by default.',
      },
      defaultTags: {
        label: 'Default Tags',
        help: 'Used as the project gate for first-turn context recall when unambiguous, and merged into stored memories.',
      },
      startupProfile: {
        label: 'Startup Profile',
        help: 'Cached profile and personality cues hydrated from AutoMem for fast first-turn startup.',
      },
    },
  },
  register(api: {
    config?: unknown;
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
      hookName: 'before_prompt_build',
      handler: (
        event: { prompt: string; messages: unknown[] },
        ctx: { sessionKey?: string }
      ) => Promise<{ prependSystemContext?: string } | void>
    ) => void;
  }) {
    const config = parsePluginConfig(api.pluginConfig);
    if (!config.endpoint) {
      api.logger.warn(
        'automem: plugin loaded without config.endpoint; configure plugins.entries.automem.config.endpoint to enable tools.'
      );
      return;
    }

    const client = new AutoMemClient({
      endpoint: config.endpoint,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    });

    api.registerTool({
      name: 'automem_store_memory',
      label: 'AutoMem Store Memory',
      description:
        'Store a durable memory in AutoMem. Single-mode (set `content`) or batch mode (set `memories: [...]`, up to 500). Batch mode does not accept per-item id/embedding/t_valid/t_invalid.',
      parameters: storeMemorySchema,
      async execute(_toolCallId, params) {
        const request = params as StoreMemoryArgs;
        if (Array.isArray(request.memories)) {
          const mergedMemories = request.memories.map((item) => {
            const merged = mergeTags(config.defaultTags, item.tags);
            const next: BatchMemoryInput = { ...item };
            if (merged !== undefined) {
              next.tags = merged;
            } else {
              delete next.tags;
            }
            return next;
          });
          const result = await client.storeMemory({
            ...request,
            memories: mergedMemories,
          });
          return jsonResult(result);
        }
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
      description:
        'Recall memories in one of three modes. (1) ID fetch: pass `memory_id`. (2) Tag enumeration: pass `tags` + `exhaustive: true` for paginated exact-match listing. (3) Ranked retrieval (default): hybrid search across vector/keyword/tags/recency.',
      parameters: recallMemorySchema,
      async execute(_toolCallId, params) {
        const request = params as RecallMemoryArgs;
        const result = await client.recallMemory({
          ...request,
          tags: explicitTags(request.tags),
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
      description:
        'Delete a stored AutoMem memory. Single-mode (set `memory_id`) or bulk-by-tag (set `tags`). Bulk-by-tag has no dry-run; verify with `automem_recall_memory({ tags, exhaustive: true })` first.',
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
      api.on('before_prompt_build', async (event, ctx) => {
        const prompt = String(event.prompt || '').trim();
        const sections: string[] = [
          renderOpenClawPolicyContext({
            defaultTags: config.defaultTags,
            limits: {
              preferenceRecallLimit: config.preferenceRecallLimit,
              contextRecallLimit: config.contextRecallLimit,
              debugRecallLimit: config.debugRecallLimit,
              contextRecallWindowDays: config.contextRecallWindowDays,
            },
          }),
        ];
        const bootstrapSkipped = configSkipsBootstrap(api.config);
        const startupTurn = bootstrapSkipped && isLikelyStartupTurn(event.messages);
        const firstSubstantiveTurn =
          isLikelyStartupTurn(event.messages) && isSubstantivePrompt(prompt);
        const debugTurn = looksLikeDebugPrompt(prompt);
        const explicitRecallTurn = looksLikeExplicitRecallPrompt(prompt);
        const topicShiftRecallTurn =
          !firstSubstantiveTurn &&
          !startupTurn &&
          !debugTurn &&
          hasNewPromptEntities(prompt, ctx.sessionKey);

        if (startupTurn) {
          try {
            const startupResult = await client.recallMemory({
              query: 'user name timezone preferred name work style ongoing context',
              limit: Math.max(config.preferenceRecallLimit, 4),
              sort: 'time_desc',
              format: 'detailed',
            });
            sections.push(
              buildOpenClawStartupContext({
                startupProfile: config.startupProfile,
                startupResults: startupResult.results || [],
              })
            );
          } catch (error) {
            api.logger.warn(`automem: startup recall failed: ${String(error)}`);
            sections.push(
              buildOpenClawStartupContext({
                startupProfile: config.startupProfile,
                startupResults: [],
              })
            );
          }
        }

        if (!prompt || !shouldAutoRecall(config.exposure, ctx.sessionKey)) {
          return {
            prependSystemContext: sections.join('\n\n'),
          };
        }

        const recalledResults: OpenClawRecallLikeResult[] = [];
        const projectGateTags = resolveProjectGateTags(config.defaultTags);
        const maxContextEntries = Math.max(
          config.preferenceRecallLimit,
          config.contextRecallLimit,
          config.debugRecallLimit
        );

        const runRecall = async (label: string, args: RecallMemoryArgs) => {
          try {
            const result = await client.recallMemory(args);
            recalledResults.push(...(result.results || []));
          } catch (error) {
            api.logger.warn(`automem: ${label} recall failed: ${String(error)}`);
          }
        };

        if (firstSubstantiveTurn) {
          await runRecall('preference', {
            tags: ['preference'],
            limit: config.preferenceRecallLimit,
            sort: 'updated_desc',
            format: 'detailed',
          });
          await runRecall('context', {
            query: prompt,
            ...(projectGateTags ? { tags: projectGateTags } : {}),
            time_query: `last ${config.contextRecallWindowDays} days`,
            limit: config.contextRecallLimit,
            format: 'detailed',
          });
        }

        if (explicitRecallTurn || topicShiftRecallTurn) {
          await runRecall(explicitRecallTurn ? 'explicit-memory-probe' : 'topic-shift', {
            query: prompt,
            time_query: `last ${config.contextRecallWindowDays} days`,
            limit: config.contextRecallLimit,
            format: 'detailed',
          });
        }

        if (debugTurn) {
          await runRecall('debug', {
            query: prompt,
            tags: ['bugfix', 'solution'],
            limit: config.debugRecallLimit,
            format: 'detailed',
          });
        }

        const memorySection = buildRelevantMemoriesSection(recalledResults, maxContextEntries);
        if (memorySection) {
          sections.push(memorySection);
        }

        rememberPromptEntities(prompt, ctx.sessionKey);

        return {
          prependSystemContext: sections.join('\n\n'),
        };
      });
    }
  },
};

export default openClawPlugin;

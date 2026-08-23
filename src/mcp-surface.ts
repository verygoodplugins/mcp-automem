/**
 * The AutoMem MCP surface: tool definitions, server instructions, and the
 * CallTool dispatch, in one side-effect-free module.
 *
 * This exists so the stdio server and the remote (streamable HTTP / SSE)
 * bridge serve one identical surface instead of two hand-synced copies.
 * `server.json` publishes both transports as one server with one shared tool
 * array, and a manual sync has already drifted once.
 *
 * Nothing here may touch process state — no argv parsing, no dotenv, no
 * console rebinding. `src/index.ts` owns all of that; this module is imported
 * by both transports and must stay importable.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { AutoMemClient } from './automem-client.js';
import { buildRecallMemoryResponse } from './recall-memory.js';
import { AUTHORABLE_RELATION_TYPES, MEMORY_TYPES, RELATION_TYPE_METADATA } from './types.js';
import type {
  StoreMemoryArgs,
  RecallMemoryArgs,
  AssociateMemoryArgs,
  UpdateMemoryArgs,
  DeleteMemoryArgs,
} from './types.js';

const ASSOCIATION_PROPERTY_SCHEMAS = {
  context: {
    type: 'string',
    description: 'Relation-specific context for PREFERS_OVER or PART_OF associations.',
  },
  reason: {
    type: 'string',
    description:
      'Relation-specific reason for PREFERS_OVER, CONTRADICTS, INVALIDATED_BY, or EVOLVED_INTO associations.',
  },
  pattern_type: {
    type: 'string',
    description: 'Relation-specific pattern label for EXEMPLIFIES associations.',
  },
  confidence: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    description: 'Relation-specific confidence for EXEMPLIFIES, EVOLVED_INTO, or DERIVED_FROM.',
  },
  resolution: {
    type: 'string',
    description: 'Relation-specific resolution for CONTRADICTS associations.',
  },
  observations: {
    type: 'array',
    items: { type: 'string' },
    description: 'Relation-specific observations for REINFORCES associations.',
  },
  timestamp: {
    type: 'string',
    description: 'Relation-specific timestamp for INVALIDATED_BY associations.',
  },
  transformation: {
    type: 'string',
    description: 'Relation-specific transformation note for DERIVED_FROM associations.',
  },
  role: {
    type: 'string',
    description: 'Relation-specific role for PART_OF associations.',
  },
} as const;

function formatHealthComponent(value: unknown): string {
  if (value && typeof value === 'object' && 'status' in value) {
    const status = (value as { status?: unknown }).status;
    return typeof status === 'string' ? status : JSON.stringify(value);
  }
  return String(value);
}

export const AUTOMEM_INSTRUCTIONS =
  "AutoMem is the agent's persistent long-term memory (graph + vector). Use recall_memory to retrieve context (session start, before decisions, when debugging), store_memory to persist decisions, patterns, preferences, and fixes, and associate_memories to link related memories into the knowledge graph. Search for the remaining tools when needed: update_memory edits an existing memory's fields in place, delete_memory removes one memory by ID or bulk-deletes by tag, and check_database_health verifies FalkorDB/Qdrant connectivity.";

export const tools: Tool[] = [
  {
    name: 'store_memory',
    title: 'Store Memory',
    description: `Store memory in one of two modes — single-memory (set top-level \`content\`) or batch (set \`memories: [...]\` for up to 500).

**Mode 1 — Single (default):** pass top-level \`content\` plus any optional fields (tags, importance, metadata, type, confidence, embedding, t_valid, t_invalid, etc.).

**Mode 1b — Supersede/correct:** pass top-level \`content\` plus \`supersedes_memory_id\`. The server stores the replacement, marks the old memory invalid with \`t_invalid=now\`, merges supersede metadata, and associates old → new with \`INVALIDATED_BY\` (default) or \`EVOLVED_INTO\`.

**Mode 2 — Batch:** pass \`memories: [{ content, tags?, importance?, metadata?, timestamp?, type?, confidence? }, ...]\` to store up to 500 memories in one request. Faster for bulk ingestion (imports, benchmark seeding). Batch mode does NOT accept \`embedding\`, \`t_valid\`, or \`t_invalid\` per-item — use single mode for those.

**Content size guidelines (per item):**
- Target: 150-300 characters (one meaningful paragraph)
- Maximum: 500 characters (auto-summarized if exceeded)
- Hard limit: 2000 characters (rejected)
- Format: "Brief title. Context and details. Impact/outcome."

**When to use:**
- After making a decision: store the reasoning and outcome
- When discovering a pattern: store the pattern and where it applies
- After fixing a bug: store the root cause and solution
- When learning user preferences: store what they prefer and why
- For bulk ingestion (imports, seeding): use batch mode

**Examples:**
- store_memory({ content: "Chose PostgreSQL over MongoDB for user service. Need ACID for transactions.", tags: ["architecture", "database"], importance: 0.9 })
- store_memory({ content: "User prefers early returns over nested conditionals.", tags: ["code-style"], importance: 0.7 })
- store_memory({ content: "User now prefers SQLite for small local tools.", supersedes_memory_id: "old-id", supersede_reason: "Correction from user" })`,
    annotations: {
      title: 'Store Memory',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { 'anthropic/alwaysLoad': true },
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Single-memory mode (XOR with `memories`). The memory content to store. Be specific: include context, reasoning, and outcome.',
        },
        memories: {
          type: 'array',
          maxItems: 500,
          description:
            'Batch mode (XOR with `content`). Up to 500 memory objects to store in one call. Each item supports content (required), tags, importance, timestamp, type, confidence, metadata. Batch mode does NOT support `embedding`, `t_valid`, or `t_invalid` per-item — use single-memory mode for those.',
          items: {
            type: 'object',
            required: ['content'],
            properties: {
              content: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              importance: { type: 'number', minimum: 0, maximum: 1 },
              timestamp: { type: 'string' },
              type: { type: 'string', enum: [...MEMORY_TYPES] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              metadata: { type: 'object' },
            },
          },
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Single-memory mode. Tags to categorize the memory (e.g., ["project-name", "bug-fix", "auth"])',
        },
        importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Single-memory mode. Importance: 0.9+ critical decisions, 0.7-0.9 patterns/bugs, 0.5-0.7 minor notes',
        },
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Single-memory mode only. Optional embedding vector for semantic search (auto-generated if omitted). Not supported in batch mode.',
        },
        metadata: {
          type: 'object',
          description:
            'Single-memory mode. Optional structured metadata (e.g., { files_modified: ["auth.ts"], error_type: "timeout" })',
        },
        timestamp: {
          type: 'string',
          description: 'Single-memory mode. Optional ISO timestamp (defaults to now)',
        },
        type: {
          type: 'string',
          enum: [...MEMORY_TYPES],
          description: 'Single-memory mode. Memory type for classification',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Single-memory mode. Classification confidence (0-1, default 0.9 when type provided)',
        },
        t_valid: {
          type: 'string',
          description:
            'Single-memory mode only. ISO 8601 timestamp when the memory becomes valid. Not supported in batch mode.',
        },
        t_invalid: {
          type: 'string',
          description:
            'Single-memory mode only. ISO 8601 timestamp when the memory expires. Not supported in batch mode.',
        },
        updated_at: {
          type: 'string',
          description: 'Single-memory mode. ISO 8601 last-updated timestamp',
        },
        last_accessed: {
          type: 'string',
          description: 'Single-memory mode. ISO 8601 last-accessed timestamp',
        },
        supersedes_memory_id: {
          type: 'string',
          description:
            'Single-memory supersede mode. Existing memory ID that this new memory replaces or corrects.',
        },
        supersede_relation: {
          type: 'string',
          enum: ['INVALIDATED_BY', 'EVOLVED_INTO'],
          default: 'INVALIDATED_BY',
          description:
            'Single-memory supersede mode. Relationship to create from old memory to new memory.',
        },
        supersede_reason: {
          type: 'string',
          description:
            "Single-memory supersede mode. Optional reason stored on the old memory's metadata.",
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'Single-mode result: unique ID of the stored memory (use for associations)',
        },
        memory_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Batch-mode result: IDs of the stored memories.',
        },
        superseded_memory_id: {
          type: 'string',
          description: 'Supersede-mode result: ID of the old memory marked invalid.',
        },
        association_created: {
          type: 'boolean',
          description: 'Supersede-mode result: whether old → new association was created.',
        },
        stored: {
          type: 'integer',
          description: 'Batch-mode result: number of memories stored.',
        },
        qdrant: {
          type: 'string',
          description: 'Batch-mode result: Qdrant indexing summary from the server.',
        },
        enrichment: {
          type: 'string',
          description: 'Batch-mode result: enrichment status from the server.',
        },
        query_time_ms: {
          type: 'number',
          description: 'Batch-mode result: server-reported execution time in milliseconds.',
        },
        message: {
          type: 'string',
          description: 'Confirmation message',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'recall_memory',
    title: 'Recall Memory',
    description: `Recall memories from AutoMem in one of three modes. The mode is selected by which params you pass.

**Mode 1 — ID fetch:** pass \`memory_id\` to retrieve a single memory by ID. All other params are ignored. Routes to GET /memory/{id} and updates last_accessed.

**Mode 2 — Tag enumeration:** pass \`tags\` + \`exhaustive: true\` for paginated exact-match listing (NOT ranked retrieval). Use this for cleanup/audit workflows where ranked retrieval silently undercounts large tag sets. Pair with \`limit\` (≤200) and \`offset\`. Returns \`has_more\`/\`limit\`/\`offset\` page metadata. Tag matching is exact, case-insensitive, any-of mode — \`tag_match: "prefix"\` and \`tag_mode: "all"\` are rejected in this mode.

**Mode 3 — Ranked retrieval (default):** hybrid search across vector, keyword, tags, recency, and optional graph expansion. The primary tool for finding relevant context. By default, ranked recall requests current active memories only; set \`current_only: false\` for audits.

**When to use ranked (mode 3):**
- At conversation start: recall context about the current project/topic
- Before making decisions: check for past decisions on similar topics
- When debugging: search for similar past errors and their solutions
- For complex questions: use \`expand_entities\` for multi-hop reasoning

**When to use enumeration (mode 2):** when you need to know *how many* memories carry a tag, or to walk all of them for cleanup/migration. Ranked recall ignores low-importance hits — enumeration does not.

**Examples:**
- recall_memory({ query: "database architecture decisions", tags: ["my-project"], limit: 5 })
- recall_memory({ memory_id: "abc123" })  // Mode 1
- recall_memory({ tags: ["benchmark-test"], exhaustive: true, limit: 50 })  // Mode 2 (add offset for later pages)
- recall_memory({ query: "auth", exclude_tags: ["deprecated"] })  // Mode 3 with exclusion
- recall_memory({ query: "What is Sarah's sister's job?", expand_entities: true })  // Mode 3 multi-hop`,
    annotations: {
      title: 'Recall Memory',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { 'anthropic/alwaysLoad': true },
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description:
            'MODE: ID fetch. When set, fetches the single memory by ID and IGNORES all other params. Routes to GET /memory/{id}; updates last_accessed.',
        },
        exhaustive: {
          type: 'boolean',
          description:
            'MODE: tag enumeration. When true, requires non-empty `tags`. Routes to GET /memory/by-tag for paginated exact-match listing — NOT ranked retrieval. Use for cleanup/audit workflows where ranked recall undercounts. `limit` is clamped to 200. `tag_match: "prefix"` and `tag_mode: "all"` are rejected in this mode.',
        },
        exclude_tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ranked-mode only. Tags to exclude from results (any match excludes). Independent of `tag_match` — supports both exact and prefix matching internally on the server.',
        },
        query: {
          type: 'string',
          description:
            "Semantic search query (natural language). Describe what you're looking for.",
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple queries for broader recall. Results are deduplicated server-side.',
        },
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional embedding vector for direct similarity search',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          default: 5,
          description:
            'Max memories to return. Schema allows 1–200; in enumeration mode (`exhaustive: true`) the server honors up to 200, while ranked mode is typically clamped server-side to ~50. Default 5.',
        },
        time_query: {
          type: 'string',
          description:
            'Natural language time filter: "today", "yesterday", "last week", "last 30 days"',
        },
        start: {
          type: 'string',
          description: 'ISO timestamp lower bound (alternative to time_query)',
        },
        end: {
          type: 'string',
          description: 'ISO timestamp upper bound',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags. Use project name as first tag for scoping.',
        },
        tag_mode: {
          type: 'string',
          enum: ['any', 'all'],
          description: '"any" matches memories with any tag (default), "all" requires all tags',
        },
        tag_match: {
          type: 'string',
          enum: ['exact', 'prefix'],
          description: '"exact" for exact tag match (default), "prefix" for starts-with matching',
        },
        expand_entities: {
          type: 'boolean',
          description:
            'Enable multi-hop reasoning via entity expansion. Finds memories about people/places mentioned in seed results. Use for "What is X\'s sister\'s job?" type questions.',
        },
        expand_relations: {
          type: 'boolean',
          description: 'Follow graph relationships from seed results to find related memories.',
        },
        expand_respect_tags: {
          type: 'boolean',
          description:
            'Ranked-mode only. When true, graph/entity expansion stays within the original tag scope; when false, expansion may include related context outside the tags.',
        },
        auto_decompose: {
          type: 'boolean',
          description:
            'Auto-extract entities and topics from query to generate supplementary searches.',
        },
        expansion_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          default: 25,
          description: 'Max total expanded memories (default: 25)',
        },
        relation_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          default: 5,
          description: 'Max relations to follow per seed memory (default: 5)',
        },
        expand_min_importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Minimum importance score for expanded results. Filters out low-relevance memories during graph/entity expansion. Recommended: 0.3-0.5 for broad context, 0.6-0.8 for focused results. Seed results are never filtered, only expanded ones.',
        },
        expand_min_strength: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Minimum relation strength to follow during graph expansion. Only traverses edges above this threshold. Recommended: 0.3 for exploratory, 0.6+ for high-confidence connections only. Does not affect entity expansion.',
        },
        current_only: {
          type: 'boolean',
          default: true,
          description:
            'Ranked-mode only. When true, server suppresses archived, not-yet-valid, expired, invalidated, or superseded memories from active context.',
        },
        state_debug: {
          type: 'boolean',
          default: false,
          description:
            'Ranked-mode only. Include state-filter suppression/replacement IDs and reasons when current_only is true.',
        },
        state_mode: {
          type: 'string',
          enum: ['current', 'history'],
          description:
            'Ranked-mode only. `current` returns active memories; `history` allows superseded/invalidated memories for audit timelines. Prefer this over current_only for new clients.',
        },
        recency_bias: {
          type: 'string',
          enum: ['auto', 'on', 'off'],
          description:
            'Ranked-mode only. Controls service recency boosting: auto lets the service infer, on forces boosting, off disables it.',
        },
        scope_fallback: {
          type: 'boolean',
          description:
            'Ranked-mode only. Allow fallback outside the requested tag scope when scoped recall has weak evidence; diagnostics report tag_scope and outside_tag_scope.',
        },
        min_score: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Ranked-mode only. Minimum final score threshold before results are returned.',
        },
        adaptive_floor: {
          type: 'boolean',
          description:
            "Ranked-mode only. Enable the service's adaptive score floor when filtering weak matches.",
        },
        context: {
          type: 'string',
          description:
            'Context label (e.g., "coding-style", "architecture"). Boosts matching preferences.',
        },
        language: {
          type: 'string',
          description:
            'Programming language hint (e.g., "python", "typescript"). Prioritizes language-specific memories.',
        },
        active_path: {
          type: 'string',
          description: 'Current file path for language auto-detection (e.g., "src/auth.ts")',
        },
        context_tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Priority tags to boost in results (e.g., ["coding-style", "preferences"])',
        },
        context_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Priority memory types to boost (e.g., ["Style", "Preference"])',
        },
        priority_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific memory IDs to ensure are included in results',
        },
        per_query_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Per-query result limit when using queries[] (default: 5)',
        },
        sort: {
          type: 'string',
          enum: ['score', 'time_desc', 'time_asc', 'updated_desc', 'updated_asc'],
          description: 'Result ordering (use time_* for chronological recaps)',
        },
        format: {
          type: 'string',
          enum: ['text', 'items', 'detailed', 'json'],
          default: 'text',
          description:
            'Output format: text (default), items (one block per memory), detailed (adds type/confidence/metadata keys/relation stubs), json (raw per-memory fields incl. full content/metadata/relations; whole-response token budget still applies). text/items/detailed show a content preview (default 400 chars) and keep any stored summary as an additive field — fetch a full record via memory_id.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Result offset for pagination',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          description: 'Number of memories returned',
        },
        mode: {
          type: 'string',
          enum: ['ranked', 'enumeration', 'id_fetch'],
          description: 'Mode that produced the result.',
        },
        has_more: {
          type: 'boolean',
          description: 'Enumeration mode only: true if more pages exist past `offset + limit`.',
        },
        limit: {
          type: 'integer',
          description: 'Enumeration mode only: page size used for this response.',
        },
        offset: {
          type: 'integer',
          description: 'Enumeration mode only: offset used for this response.',
        },
        results: {
          type: 'array',
          description: 'Array of matching memories with scores',
          items: {
            type: 'object',
            properties: {
              memory_id: { type: 'string' },
              summary: {
                type: 'string',
                description:
                  'Stored 1-2 sentence summary when the server provides one. Additive in budgeted formats; does not replace content.',
              },
              content: {
                type: 'string',
                description: 'Memory content (preview-capped in budgeted formats).',
              },
              content_truncated: {
                type: 'boolean',
                description:
                  'True when content is a preview; fetch the full record via recall_memory({ memory_id }).',
              },
              content_chars: {
                type: 'integer',
                description: 'Original content length when content was previewed.',
              },
              tags: { type: 'array', items: { type: 'string' } },
              importance: { type: 'number' },
              final_score: { type: 'number' },
              match_type: { type: 'string' },
              created_at: { type: 'string' },
              updated_at: { type: 'string' },
              deduped_from: {
                type: 'array',
                items: { type: 'string' },
                description: 'Result IDs merged into this result during multi-query deduplication.',
              },
              outside_tag_scope: {
                type: 'boolean',
                description:
                  'True when scope_fallback admitted this result outside the requested tag scope.',
              },
              jit_enriched: {
                type: 'boolean',
                description: 'True when the service enriched the memory during recall.',
              },
              state_replaces: {
                type: 'string',
                description:
                  'ID of the suppressed memory this result replaced during current-state filtering.',
              },
            },
          },
        },
        truncation: {
          type: 'object',
          description:
            'Present when trailing results were dropped to fit the response budget: { applied, omitted_results, reason }.',
        },
        dedup_removed: {
          type: 'integer',
          description: 'Number of duplicate results removed (when using multiple queries)',
        },
        query: {
          type: 'string',
          description: 'Query text executed by ranked recall.',
        },
        sort: {
          type: 'string',
          description: 'Sort mode applied by the service.',
        },
        exclude_tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags excluded from ranked recall.',
        },
        state_filter: {
          type: 'object',
          description:
            'Current-state filtering diagnostics. Includes aggregate counts by default and detailed IDs/reasons only when state_debug=true.',
        },
        state_mode: {
          type: 'string',
          enum: ['current', 'history'],
          description: 'State mode applied by ranked recall.',
        },
        tag_scope: {
          type: 'object',
          description: 'Tag-scope diagnostics including whether scoped evidence was strong enough.',
        },
        scope_fallback: {
          type: 'boolean',
          description: 'True when recall allowed outside-scope fallback results.',
        },
        recency_bias: {
          type: 'string',
          enum: ['auto', 'on', 'off'],
          description: 'Recency bias mode applied by the service.',
        },
        score_filter: {
          type: 'object',
          description:
            'Score filtering diagnostics such as min_score, adaptive_floor, and filtered_count.',
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Query variants executed by the service.',
        },
        vector_search: {
          type: 'object',
          description: 'Vector-search diagnostics from the service.',
        },
        jit_enriched_count: {
          type: 'integer',
          description: 'Number of memories enriched inline during recall.',
        },
        query_time_ms: {
          type: 'number',
          description: 'Service recall latency in milliseconds.',
        },
        entities: {
          type: 'array',
          items: { type: 'object' },
          description: 'Entity identity diagnostics injected by the service.',
        },
      },
      required: ['count', 'results'],
    },
  },
  {
    name: 'associate_memories',
    title: 'Associate Memories',
    description: `Create typed relationships between memories. This builds a knowledge graph that improves recall by surfacing related context. Supports single-pair mode or batch mode with associations[] (max 500).

**When to use:**
- After storing a new memory: link it to related existing memories
- When a bug fix relates to an original feature implementation
- When a new decision updates or invalidates a previous one
- To connect patterns with their concrete examples

**Authorable relationship types:**
${Object.entries(RELATION_TYPE_METADATA)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

**Read-only/internal relations:**
- System/internal relations such as SIMILAR_TO, PRECEDED_BY, EXPLAINS, SHARES_THEME, PARALLEL_CONTEXT, and DISCOVERED may appear in recall results, but they are not valid inputs for associate_memories.

**Examples:**
- associate_memories({ memory1_id: "bug-fix-123", memory2_id: "feature-456", type: "RELATES_TO", strength: 0.9 })
- associate_memories({ memory1_id: "new-decision", memory2_id: "old-decision", type: "EVOLVED_INTO", strength: 0.8 })
- associate_memories({ associations: [{ memory1_id: "a", memory2_id: "b", type: "RELATES_TO", strength: 0.8 }] })`,
    annotations: {
      title: 'Associate Memories',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { 'anthropic/alwaysLoad': true },
    inputSchema: {
      type: 'object',
      properties: {
        memory1_id: {
          type: 'string',
          description: 'ID of the source memory (from store_memory response or recall results)',
        },
        memory2_id: {
          type: 'string',
          description: 'ID of the target memory to link to',
        },
        type: {
          type: 'string',
          enum: [...AUTHORABLE_RELATION_TYPES],
          description: 'Relationship type between the two memories',
        },
        strength: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Relationship strength: 0.9+ direct causation, 0.7-0.9 strong relation, 0.5-0.7 moderate',
        },
        ...ASSOCIATION_PROPERTY_SCHEMAS,
        associations: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          description:
            'Batch mode. Up to 500 associations. Do not combine with top-level memory1_id/memory2_id/type/strength.',
          items: {
            type: 'object',
            properties: {
              memory1_id: {
                type: 'string',
                description: 'ID of the source memory',
              },
              memory2_id: {
                type: 'string',
                description: 'ID of the target memory',
              },
              type: {
                type: 'string',
                enum: [...AUTHORABLE_RELATION_TYPES],
                description: 'Relationship type between the two memories',
              },
              strength: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Relationship strength from 0 to 1',
              },
              ...ASSOCIATION_PROPERTY_SCHEMAS,
            },
            required: ['memory1_id', 'memory2_id', 'type', 'strength'],
          },
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description:
            'Whether every requested association was created. False for partial batch responses.',
        },
        message: {
          type: 'string',
          description: 'Confirmation message',
        },
        created_count: {
          type: 'integer',
          description: 'Batch mode: number of associations created.',
        },
        failed_count: {
          type: 'integer',
          description: 'Batch mode: number of associations that failed.',
        },
        succeeded: {
          type: 'array',
          description: 'Batch mode: successful association records.',
          items: { type: 'object' },
        },
        failed: {
          type: 'array',
          description: 'Batch mode: failed association records with errors.',
          items: { type: 'object' },
        },
        summary: {
          type: 'string',
          description: 'Batch mode: service summary.',
        },
      },
      required: ['success', 'message'],
    },
  },
  {
    name: 'update_memory',
    title: 'Update Memory',
    description: `Update an existing memory's content, tags, importance, or metadata. Use this to correct or enhance memories rather than storing duplicates.

**When to use:**
- To correct inaccurate information in a memory
- To add tags that were forgotten
- To adjust importance based on new understanding
- To add metadata after the fact

**Examples:**
- update_memory({ memory_id: "abc123", importance: 0.95 })  // Increase importance
- update_memory({ memory_id: "abc123", tags: ["project-x", "critical", "auth"] })  // Add tags
- update_memory({ memory_id: "abc123", content: "Updated: PostgreSQL chosen for ACID + team expertise" })`,
    annotations: {
      title: 'Update Memory',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'ID of the memory to update (from store_memory or recall results)',
        },
        content: {
          type: 'string',
          description: 'New content (replaces existing)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags (replaces existing)',
        },
        importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'New importance score',
        },
        metadata: {
          type: 'object',
          description: 'New metadata (merged with existing)',
        },
        timestamp: {
          type: 'string',
          description: 'Override creation timestamp',
        },
        t_valid: {
          type: 'string',
          description: 'ISO 8601 timestamp when the memory becomes valid',
        },
        t_invalid: {
          type: 'string',
          description: 'ISO 8601 timestamp when the memory expires or was superseded',
        },
        updated_at: {
          type: 'string',
          description: 'Explicit update timestamp',
        },
        last_accessed: {
          type: 'string',
          description: 'Last access timestamp',
        },
        type: {
          type: 'string',
          enum: [...MEMORY_TYPES],
          description: 'Memory type classification',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence score for the memory',
        },
      },
      required: ['memory_id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'ID of the updated memory',
        },
        message: {
          type: 'string',
          description: 'Confirmation message',
        },
      },
      required: ['memory_id', 'message'],
    },
  },
  {
    name: 'delete_memory',
    title: 'Delete Memory',
    description: `Delete a memory by ID (\`memory_id\`) or bulk-delete by tag (\`tags\`). Use sparingly — consider \`update_memory\` instead.

**Mode 1 — Single (default):** pass \`memory_id\` to delete one memory and its embedding. Idempotent: re-running on the same ID is a no-op.

**Mode 2 — Bulk-by-tag:** pass \`tags: [...]\` to delete ALL memories tagged with ANY of these tags. Tag matching is exact (case-insensitive), any-of mode. There is NO dry-run. This can delete thousands of memories in one call. NOT idempotent in practice — re-running may catch new memories that were tagged the same way after the first call. Verify with \`recall_memory({ tags, exhaustive: true })\` first if uncertain.

**When to use:**
- Memory contains incorrect information that can't be corrected (Mode 1)
- Memory is a duplicate (Mode 1)
- Cleanup of benchmark/test data scoped by tag (Mode 2)
- Removing all memories under a deprecated tag namespace (Mode 2)

**Examples:**
- delete_memory({ memory_id: "abc123" })  // Mode 1
- delete_memory({ tags: ["benchmark-test"] })  // Mode 2, bulk by tag`,
    annotations: {
      title: 'Delete Memory',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description:
            'Single-delete mode (XOR with `tags`). ID of the memory to delete (from store_memory or recall results).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Bulk-delete mode (XOR with `memory_id`). Bulk-deletes ALL memories tagged with ANY of these tags. Exact match, case-insensitive. No dry-run.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'Single-delete result: ID of the deleted memory.',
        },
        deleted_count: {
          type: 'integer',
          description: 'Bulk-delete result: number of memories deleted.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Bulk-delete result: tags that were used for the bulk delete.',
        },
        message: {
          type: 'string',
          description: 'Confirmation message',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'check_database_health',
    title: 'Check Database Health',
    description: `Check the health status of the AutoMem service and its connected databases (FalkorDB graph + Qdrant vectors).

**When to use:**
- Before a session to verify the memory service is available
- When memory operations are failing unexpectedly
- To check storage statistics

**Example:**
- check_database_health({})`,
    annotations: {
      title: 'Check Database Health',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['healthy', 'degraded', 'error'],
          description:
            'Overall health status. degraded means the service is reachable but a backend or sync check needs attention.',
        },
        backend: {
          type: 'string',
          description: 'Backend type (automem)',
        },
        statistics: {
          type: 'object',
          description:
            'Database statistics and diagnostics, including memory/vector counts, sync_status, vector_dimensions, and enrichment state when provided.',
        },
        error: {
          type: 'string',
          description: 'Error message if status is error',
        },
      },
      required: ['status', 'backend'],
    },
  },
];

export interface AutoMemMcpServerOptions {
  /** Injected so each transport keeps its own timeout/retry policy. */
  client: AutoMemClient;
  /** serverInfo.name — distinct per transport so clients can tell them apart. */
  name: string;
  /** serverInfo.version — each transport reports its own package version. */
  version: string;
  /** Optional correlation id appended to error text. */
  requestIdProvider?: () => string | undefined;
}

export function createAutoMemMcpServer({
  client,
  name,
  version,
  requestIdProvider,
}: AutoMemMcpServerOptions): Server {
  const server = new Server(
    { name, version },
    {
      capabilities: { tools: {} },
      instructions: AUTOMEM_INSTRUCTIONS,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'store_memory': {
          const storeArgs = args as unknown as StoreMemoryArgs;

          // Content size governance applies to single-store mode only. In batch mode the client
          // only checks that each item's `content` is non-empty (see batchStore in automem-client.ts);
          // the AutoMem service enforces its own hard/soft limits and auto-summarizes on the way in.
          const SOFT_LIMIT = 500;
          const HARD_LIMIT = 2000;
          const isBatchMode = Array.isArray(storeArgs.memories);
          const contentLength = isBatchMode ? 0 : storeArgs.content?.length || 0;
          let sizeWarning = '';

          if (!isBatchMode) {
            // Hard limit: reject oversized content outright (single mode only)
            if (contentLength > HARD_LIMIT) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ Memory rejected: Content length (${contentLength} chars) exceeds hard limit (${HARD_LIMIT} chars).\n\nPlease split into smaller, focused memories or summarize the content before storing.`,
                  },
                ],
                structuredContent: {
                  error: 'content_too_large',
                  content_length: contentLength,
                  hard_limit: HARD_LIMIT,
                  message: `Content exceeds maximum allowed length of ${HARD_LIMIT} characters`,
                },
                isError: true,
              };
            }

            // Soft limit: warn that backend may auto-summarize
            if (contentLength > SOFT_LIMIT) {
              sizeWarning = `\n📝 Content length (${contentLength} chars) exceeds recommended size (${SOFT_LIMIT}). Backend may auto-summarize.`;
            }
          }

          const result = await client.storeMemory(storeArgs);

          if (isBatchMode) {
            const stored = result.stored ?? result.memory_ids?.length ?? 0;
            const ids = result.memory_ids ?? [];
            const idPreview =
              ids.length > 10
                ? `${ids.slice(0, 10).join(', ')}, …(+${ids.length - 10})`
                : ids.join(', ');
            const output = {
              stored,
              memory_ids: ids,
              message: result.message,
              ...(result.qdrant ? { qdrant: result.qdrant } : {}),
              ...(result.enrichment ? { enrichment: result.enrichment } : {}),
              ...(typeof result.query_time_ms === 'number'
                ? { query_time_ms: result.query_time_ms }
                : {}),
            };
            return {
              content: [
                {
                  type: 'text',
                  text: `Stored ${stored} memories.${idPreview ? `\nIDs: ${idPreview}` : ''}\nMessage: ${result.message}`,
                },
              ],
              structuredContent: output,
            };
          }

          // Single-store mode response
          let responseText = `Memory stored successfully!\n\nMemory ID: ${result.memory_id}`;
          if (result.superseded_memory_id) {
            responseText += `\nSuperseded memory ID: ${result.superseded_memory_id}`;
          }
          if (typeof result.association_created === 'boolean') {
            responseText += `\nAssociation created: ${result.association_created ? 'yes' : 'no'}`;
          }
          if (result.message) {
            responseText += `\nMessage: ${result.message}`;
          }

          // Include summarization info if present
          const summarized = (result as any).summarized;
          const originalLength = (result as any).original_length;
          const summarizedLength = (result as any).summarized_length;
          if (summarized) {
            responseText += `\n📝 Auto-summarized: ${originalLength} → ${summarizedLength} chars`;
          } else if (sizeWarning) {
            responseText += sizeWarning;
          }

          const output = {
            memory_id: result.memory_id,
            message: result.message,
            ...(result.superseded_memory_id && {
              superseded_memory_id: result.superseded_memory_id,
            }),
            ...(typeof result.association_created === 'boolean' && {
              association_created: result.association_created,
            }),
            ...(summarized && {
              summarized,
              original_length: originalLength,
              summarized_length: summarizedLength,
            }),
            ...(contentLength > SOFT_LIMIT && {
              content_length: contentLength,
              size_warning: true,
            }),
          };

          return {
            content: [
              {
                type: 'text',
                text: responseText,
              },
            ],
            structuredContent: output,
          };
        }

        case 'recall_memory': {
          return buildRecallMemoryResponse(client, args as unknown as RecallMemoryArgs);
        }

        case 'associate_memories': {
          const associateArgs = args as unknown as AssociateMemoryArgs;
          const result = await client.associateMemories(associateArgs);
          const output = {
            success: result.success,
            message: result.message,
            created_count: result.created_count,
            failed_count: result.failed_count,
            succeeded: result.succeeded,
            failed: result.failed,
            summary: result.summary,
          };
          const batchSuffix =
            typeof result.created_count === 'number' || typeof result.failed_count === 'number'
              ? `\n\nCreated: ${result.created_count ?? 0}\nFailed: ${result.failed_count ?? 0}`
              : '';
          return {
            content: [
              {
                type: 'text',
                text: `${result.success ? 'Association created successfully!' : 'Association completed with failures.'}\n\nMessage: ${result.message}${batchSuffix}`,
              },
            ],
            structuredContent: output,
          };
        }

        case 'update_memory': {
          const updateArgs = args as unknown as UpdateMemoryArgs;
          const result = await client.updateMemory(updateArgs);
          const output = {
            memory_id: result.memory_id,
            message: `Memory ${result.memory_id} updated successfully!`,
          };
          return {
            content: [
              {
                type: 'text',
                text: `Memory ${result.memory_id} updated successfully!`,
              },
            ],
            structuredContent: output,
          };
        }

        case 'delete_memory': {
          const deleteArgs = args as unknown as DeleteMemoryArgs;
          const result = await client.deleteMemory(deleteArgs);

          if (typeof result.deleted_count === 'number') {
            // Bulk-delete-by-tag mode
            const tags = result.tags ?? deleteArgs.tags ?? [];
            const output = {
              deleted_count: result.deleted_count,
              tags,
              message: result.message,
            };
            return {
              content: [
                {
                  type: 'text',
                  text: `Bulk delete complete: removed ${result.deleted_count} memor${result.deleted_count === 1 ? 'y' : 'ies'} matching tag(s) ${tags.join(', ')}.`,
                },
              ],
              structuredContent: output,
            };
          }

          const output = {
            memory_id: result.memory_id,
            message: `Memory ${result.memory_id} deleted successfully!`,
          };
          return {
            content: [
              {
                type: 'text',
                text: `Memory ${result.memory_id} deleted successfully!`,
              },
            ],
            structuredContent: output,
          };
        }

        case 'check_database_health': {
          const health = await client.checkHealth();
          const statusEmoji =
            health.status === 'healthy' ? '✅' : health.status === 'degraded' ? '⚠️' : '❌';

          let statsText = '';
          if (health.statistics.falkordb) {
            statsText += `\nFalkorDB: ${formatHealthComponent(health.statistics.falkordb)}`;
          }
          if (health.statistics.qdrant) {
            statsText += `\nQdrant: ${formatHealthComponent(health.statistics.qdrant)}`;
          }
          if (health.statistics.graph) {
            statsText += `\nGraph: ${health.statistics.graph}`;
          }
          if (typeof health.statistics.memory_count === 'number') {
            statsText += `\nMemory count: ${health.statistics.memory_count}`;
          }
          if (typeof health.statistics.vector_count === 'number') {
            statsText += `\nVector count: ${health.statistics.vector_count}`;
          }
          if (health.statistics.sync_status) {
            statsText += `\nSync status: ${health.statistics.sync_status}`;
          }
          if (health.statistics.enrichment?.status) {
            statsText += `\nEnrichment: ${health.statistics.enrichment.status}`;
          }
          if (health.statistics.timestamp) {
            statsText += `\nTimestamp: ${health.statistics.timestamp}`;
          }

          const errorText = health.error ? `\nError: ${health.error}` : '';

          const output = {
            status: health.status,
            backend: health.backend,
            statistics: health.statistics,
            error: health.error,
          };

          return {
            content: [
              {
                type: 'text',
                text: `${statusEmoji} AutoMem Health Status\n\nStatus: ${health.status}\nBackend: ${health.backend}${statsText}${errorText}`,
              },
            ],
            structuredContent: output,
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      // Transports that can correlate a failure to a request log supply an id;
      // stdio supplies none and the suffix is omitted. Same code path either way.
      const requestId = requestIdProvider?.();
      const suffix = requestId ? ` (request_id: ${requestId})` : '';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}${suffix}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

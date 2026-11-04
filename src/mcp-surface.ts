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
    description: 'PREFERS_OVER or PART_OF only.',
  },
  reason: {
    type: 'string',
    description: 'PREFERS_OVER, CONTRADICTS, INVALIDATED_BY or EVOLVED_INTO only.',
  },
  pattern_type: {
    type: 'string',
    description: 'EXEMPLIFIES only: pattern label.',
  },
  confidence: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    description: 'EXEMPLIFIES, EVOLVED_INTO or DERIVED_FROM only.',
  },
  resolution: {
    type: 'string',
    description: 'CONTRADICTS only.',
  },
  observations: {
    type: 'array',
    items: { type: 'string' },
    description: 'REINFORCES only.',
  },
  timestamp: {
    type: 'string',
    description: 'INVALIDATED_BY only.',
  },
  transformation: {
    type: 'string',
    description: 'DERIVED_FROM only.',
  },
  role: {
    type: 'string',
    description: 'PART_OF only.',
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
- store_memory({ content: "User now prefers SQLite for small local tools.", supersedes_memory_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91", supersede_reason: "Correction from user" })`,
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
            'Single mode (XOR with `memories`). Include context, reasoning, and outcome.',
        },
        memories: {
          type: 'array',
          maxItems: 500,
          description:
            'Batch mode (XOR with `content`). Other top-level fields apply to single mode only; items take no `embedding`, `t_valid` or `t_invalid`.',
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
          description: 'e.g. ["bugfix", "auth", "<project-slug>"]',
        },
        importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: '0.9+ critical decisions, 0.7-0.9 patterns/bugs, 0.5-0.7 minor notes',
        },
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Auto-generated if omitted. Not in batch mode.',
        },
        metadata: {
          type: 'object',
          description: 'Structured details, e.g. { files_modified: ["auth.ts"] }',
        },
        timestamp: {
          type: 'string',
          description: 'ISO 8601; defaults to now.',
        },
        type: {
          type: 'string',
          enum: [...MEMORY_TYPES],
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Type confidence; defaults to 0.9 when `type` is set.',
        },
        t_valid: {
          type: 'string',
          description: 'ISO 8601 start of validity. Not in batch mode.',
        },
        t_invalid: {
          type: 'string',
          description: 'ISO 8601 expiry. Not in batch mode.',
        },
        updated_at: { type: 'string', description: 'ISO 8601' },
        last_accessed: { type: 'string', description: 'ISO 8601' },
        supersedes_memory_id: {
          type: 'string',
          description: 'Supersede mode: ID of the memory this one replaces or corrects.',
        },
        supersede_relation: {
          type: 'string',
          enum: ['INVALIDATED_BY', 'EVOLVED_INTO'],
          default: 'INVALIDATED_BY',
          description: 'Supersede mode: relation from old to new.',
        },
        supersede_reason: {
          type: 'string',
          description: "Supersede mode: reason stored on the old memory's metadata.",
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'Single mode: ID of the stored memory.',
        },
        memory_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Batch mode.',
        },
        superseded_memory_id: {
          type: 'string',
          description: 'Supersede mode: the old memory, now invalid.',
        },
        association_created: {
          type: 'boolean',
          description: 'Supersede mode.',
        },
        stored: {
          type: 'integer',
          description: 'Batch mode.',
        },
        qdrant: {
          type: 'string',
          description: 'Batch mode.',
        },
        enrichment: {
          type: 'string',
          description: 'Batch mode.',
        },
        query_time_ms: {
          type: 'number',
          description: 'Batch mode.',
        },
        message: { type: 'string' },
      },
      required: ['message'],
    },
  },
  {
    name: 'recall_memory',
    title: 'Recall Memory',
    description: `Recall memories from AutoMem in one of three modes. The mode is selected by which params you pass.

**Mode 1 — ID fetch:** pass \`memory_id\` to retrieve a single memory by ID. All other params are ignored. Routes to GET /memory/{id} and updates last_accessed.

**Mode 2 — Tag enumeration:** pass \`tags\` + \`exhaustive: true\` for paginated exact-match listing (NOT ranked retrieval). Use this for cleanup/audit workflows where ranked retrieval silently undercounts large tag sets. Pair with \`limit\` (≤200) and \`offset\`. Returns \`has_more\`/\`limit\`/\`offset\` page metadata; next page at \`next_offset\`. Tag matching is exact, case-insensitive, any-of mode — \`tag_match: "prefix"\` and \`tag_mode: "all"\` are rejected in this mode.

**Mode 3 — Ranked retrieval (default):** hybrid search across vector, keyword, tags, recency, and optional graph expansion. The primary tool for finding relevant context. By default, ranked recall requests current active memories only; set \`current_only: false\` for audits.

**When to use ranked (mode 3):**
- At conversation start: recall context about the current project/topic
- Before making decisions: check for past decisions on similar topics
- When debugging: search for similar past errors and their solutions
- For complex questions: use \`expand_entities\` for multi-hop reasoning

**When to use enumeration (mode 2):** when you need to know *how many* memories carry a tag, or to walk all of them for cleanup/migration. Ranked recall ignores low-importance hits — enumeration does not.

**Examples:**
- recall_memory({ query: "database architecture decisions", tags: ["my-project"], limit: 5 })
- recall_memory({ memory_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91" })  // Mode 1
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
          description: 'ID fetch mode: returns this one memory and ignores every other param.',
        },
        exhaustive: {
          type: 'boolean',
          description:
            'Tag enumeration mode: requires `tags`; exact any-of match, `limit` ≤200, pages with `offset`. Rejects `tag_match: "prefix"` and `tag_mode: "all"`.',
        },
        exclude_tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ranked-mode only. Any match excludes.',
        },
        query: {
          type: 'string',
          description: 'Natural-language search query.',
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Several queries; results are deduplicated.',
        },
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Vector for direct similarity search.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description:
            'Defaults to 5 in ranked mode and 20 in enumeration mode. Ranked is clamped to ~50 server-side.',
        },
        time_query: {
          type: 'string',
          description: 'e.g. "today", "last week", "last 30 days"',
        },
        start: {
          type: 'string',
          description: 'ISO lower bound (alternative to time_query)',
        },
        end: {
          type: 'string',
          description: 'ISO upper bound',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags, e.g. the project slug.',
        },
        tag_mode: {
          type: 'string',
          enum: ['any', 'all'],
          description: 'Default "any".',
        },
        tag_match: {
          type: 'string',
          enum: ['exact', 'prefix'],
          description:
            '"prefix" (ranked default) also matches child tags split at ":" or "/" (`auth` matches `auth:login`); it does not match across hyphens. "exact" matches whole tags. Enumeration mode is always exact.',
        },
        expand_entities: {
          type: 'boolean',
          description: 'Multi-hop: also recall memories about entities in the seed results.',
        },
        expand_relations: {
          type: 'boolean',
          description: 'Follow graph relations from seed results.',
        },
        expand_respect_tags: {
          type: 'boolean',
          description: 'Ranked-mode only. Keep graph/entity expansion inside the tag scope.',
        },
        auto_decompose: {
          type: 'boolean',
          description: 'Add searches for entities and topics extracted from the query.',
        },
        expansion_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          default: 25,
          description: 'Max expanded memories in total.',
        },
        relation_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          default: 5,
          description: 'Max relations followed per seed.',
        },
        expand_min_importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Drop expanded results below this importance; seeds are never filtered.',
        },
        expand_min_strength: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Follow only relations at least this strong. Not used by entity expansion.',
        },
        current_only: {
          type: 'boolean',
          default: true,
          description:
            'Ranked-mode only. Hide archived, not-yet-valid, expired, invalidated or superseded memories.',
        },
        state_debug: {
          type: 'boolean',
          default: false,
          description: 'Ranked-mode only. Add suppression IDs and reasons to `state_filter`.',
        },
        state_mode: {
          type: 'string',
          enum: ['current', 'history'],
          description:
            'Ranked-mode only. "history" includes superseded/invalidated memories. Prefer over current_only.',
        },
        recency_bias: {
          type: 'string',
          enum: ['auto', 'on', 'off'],
          description: 'Ranked-mode only. "auto" lets the service decide.',
        },
        scope_fallback: {
          type: 'boolean',
          description:
            'Ranked-mode only. Fill from outside the tag scope when scoped evidence is weak.',
        },
        min_score: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Ranked-mode only. Minimum final score.',
        },
        adaptive_floor: {
          type: 'boolean',
          description: "Ranked-mode only. Apply the service's adaptive score floor.",
        },
        context: {
          type: 'string',
          description: 'Context label; boosts matching preferences.',
        },
        language: {
          type: 'string',
          description: 'Programming language; boosts language-specific memories.',
        },
        active_path: {
          type: 'string',
          description: 'Current file path, for language detection.',
        },
        context_tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to boost.',
        },
        context_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Memory types to boost.',
        },
        priority_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Memory IDs to always include.',
        },
        per_query_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Per-query limit with `queries` (default 5).',
        },
        sort: {
          type: 'string',
          enum: ['score', 'time_desc', 'time_asc', 'updated_desc', 'updated_asc'],
          description: 'time_* for chronological recaps',
        },
        format: {
          type: 'string',
          enum: ['text', 'items', 'detailed', 'json'],
          default: 'text',
          description:
            'text, items (one block per memory) and detailed (adds type, confidence, metadata keys, relation stubs) show a 400-char content preview; fetch the full record by memory_id. json returns full fields. Every format stays within the response token budget.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description:
            'Enumeration mode only (`exhaustive: true`). Ranked recall rejects it; raise `limit` instead.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        mode: { type: 'string', enum: ['ranked', 'enumeration', 'id_fetch'] },
        has_more: {
          type: 'boolean',
          description: 'Enumeration: more records exist; continue at `next_offset`.',
        },
        limit: {
          type: 'integer',
          description:
            'Enumeration: page size. A budget-trimmed page shrinks `count` and `limit` to what was returned, so `offset + limit` still starts the next page.',
        },
        offset: { type: 'integer', description: 'Enumeration.' },
        next_offset: {
          type: 'integer',
          description: 'Enumeration, while `has_more`: the next page offset.',
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              memory_id: { type: 'string' },
              summary: { type: 'string', description: 'Stored summary; additive to content.' },
              content: { type: 'string', description: 'A preview outside json and ID fetch.' },
              content_truncated: {
                type: 'boolean',
                description: 'Content is a preview; fetch the full record by memory_id.',
              },
              content_chars: { type: 'integer', description: 'Full length when previewed.' },
              tags: { type: 'array', items: { type: 'string' } },
              importance: { type: 'number' },
              final_score: { type: 'number' },
              match_type: { type: 'string' },
              created_at: { type: 'string' },
              updated_at: { type: 'string' },
              t_valid: { type: 'string', description: 'json and ID fetch only.' },
              t_invalid: {
                type: 'string',
                description: 'json and ID fetch only; set when superseded.',
              },
              archived: { type: 'boolean', description: 'json and ID fetch only.' },
              deduped_from: {
                type: 'array',
                items: { type: 'string' },
                description: 'IDs merged into this result by multi-query dedup.',
              },
              outside_tag_scope: { type: 'boolean', description: 'Admitted by scope_fallback.' },
              jit_enriched: { type: 'boolean' },
              state_replaces: {
                type: 'string',
                description: 'ID of the suppressed memory this result replaced.',
              },
            },
          },
        },
        truncation: {
          type: 'object',
          description:
            'Present when the response budget cut anything: applied, omitted_results, reason, omitted_fields (diagnostics dropped), compacted_results (json results shown compact).',
        },
        dedup_removed: { type: 'integer' },
        query: { type: 'string' },
        sort: { type: 'string' },
        exclude_tags: { type: 'array', items: { type: 'string' } },
        state_filter: {
          type: 'object',
          description: 'Counts; IDs and reasons only with state_debug.',
        },
        state_mode: { type: 'string', enum: ['current', 'history'] },
        tag_scope: { type: 'object' },
        scope_fallback: { type: 'boolean' },
        recency_bias: { type: 'string', enum: ['auto', 'on', 'off'] },
        score_filter: { type: 'object' },
        queries: { type: 'array', items: { type: 'string' } },
        vector_search: { type: 'object' },
        jit_enriched_count: { type: 'integer' },
        query_time_ms: { type: 'number' },
        entities: { type: 'array', items: { type: 'object' } },
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
- associate_memories({ memory1_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91", memory2_id: "3c9e7b2a-1f4d-4a8e-9b6c-5d2e8f1a7c34", type: "RELATES_TO", strength: 0.9 })  // bug fix → feature
- associate_memories({ memory1_id: "3c9e7b2a-1f4d-4a8e-9b6c-5d2e8f1a7c34", memory2_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91", type: "EVOLVED_INTO", strength: 0.8 })  // old decision → new
- associate_memories({ associations: [{ memory1_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91", memory2_id: "3c9e7b2a-1f4d-4a8e-9b6c-5d2e8f1a7c34", type: "RELATES_TO", strength: 0.8 }] })`,
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
          description: 'Source memory ID',
        },
        memory2_id: {
          type: 'string',
          description: 'Target memory ID',
        },
        type: {
          type: 'string',
          enum: [...AUTHORABLE_RELATION_TYPES],
        },
        strength: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: '0.9+ direct causation, 0.7-0.9 strong, 0.5-0.7 moderate',
        },
        ...ASSOCIATION_PROPERTY_SCHEMAS,
        associations: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          description:
            'Batch mode. Do not combine with top-level memory1_id/memory2_id/type/strength.',
          items: {
            type: 'object',
            properties: {
              memory1_id: { type: 'string' },
              memory2_id: { type: 'string' },
              type: { type: 'string', enum: [...AUTHORABLE_RELATION_TYPES] },
              strength: { type: 'number', minimum: 0, maximum: 1 },
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
          description: 'False when any batch item failed.',
        },
        message: { type: 'string' },
        created_count: {
          type: 'integer',
          description: 'Batch mode.',
        },
        failed_count: {
          type: 'integer',
          description: 'Batch mode.',
        },
        succeeded: {
          type: 'array',
          description: 'Batch mode.',
          items: { type: 'object' },
        },
        failed: {
          type: 'array',
          description: 'Batch mode.',
          items: { type: 'object' },
        },
        summary: {
          type: 'string',
          description: 'Batch mode.',
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
- update_memory({ memory_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91", importance: 0.95 })  // Increase importance
- update_memory({ memory_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91", tags: ["project-x", "critical", "auth"] })  // Add tags
- update_memory({ memory_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91", content: "Updated: PostgreSQL chosen for ACID + team expertise" })`,
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
          description: 'ID of the memory to update',
        },
        content: {
          type: 'string',
          description: 'Replaces existing',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replaces existing',
        },
        importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        metadata: {
          type: 'object',
          description:
            'Replaces the stored metadata object. To change one key, fetch the memory first and send the full object. Omit metadata to preserve it.',
        },
        timestamp: {
          type: 'string',
          description: 'Overrides creation time',
        },
        t_valid: {
          type: 'string',
          description: 'ISO 8601 start of validity',
        },
        t_invalid: {
          type: 'string',
          description: 'ISO 8601 expiry or supersede time',
        },
        updated_at: { type: 'string', description: 'ISO 8601' },
        last_accessed: { type: 'string', description: 'ISO 8601' },
        type: {
          type: 'string',
          enum: [...MEMORY_TYPES],
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['memory_id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string' },
        message: { type: 'string' },
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
- delete_memory({ memory_id: "8f3a2c1e-5b7d-4e9a-a1c3-2d4f6b8e0a91" })  // Mode 1
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
          description: 'Single mode (XOR with `tags`).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Bulk mode (XOR with `memory_id`): deletes ALL memories with ANY of these tags. Exact, case-insensitive. No dry-run.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'Single mode.',
        },
        deleted_count: {
          type: 'integer',
          description: 'Bulk mode.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Bulk mode.',
        },
        message: { type: 'string' },
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
          description: 'degraded: reachable, but a backend or sync check needs attention.',
        },
        backend: { type: 'string' },
        statistics: {
          type: 'object',
          description:
            'Memory/vector counts, sync_status, vector_dimensions and enrichment state, when provided.',
        },
        error: {
          type: 'string',
          description: 'Set when status is error',
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
          // Awaited so a rejection reaches the catch below and returns an isError
          // result; a bare return would surface as a JSON-RPC internal error.
          return await buildRecallMemoryResponse(client, args as unknown as RecallMemoryArgs);
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

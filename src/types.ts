// Public authorable relationship types for associate_memories.
// Internal/system relations may still appear in recall results returned by AutoMem.

/**
 * Authorable relation type metadata. Single source of truth for both
 * the enum values and human-readable descriptions used in tool schemas.
 */
export const RELATION_TYPE_METADATA = {
  RELATES_TO: 'General relationship (default)',
  LEADS_TO: 'Causal relationship (A caused B)',
  OCCURRED_BEFORE: 'Temporal ordering',
  PREFERS_OVER: 'Chosen alternative',
  EXEMPLIFIES: 'Concrete example of a pattern',
  CONTRADICTS: 'Conflicts with another memory',
  REINFORCES: 'Strengthens another memory\'s validity',
  INVALIDATED_BY: 'Superseded by another memory',
  EVOLVED_INTO: 'Updated version of a concept',
  DERIVED_FROM: 'Implementation of a decision/pattern',
  PART_OF: 'Component of a larger effort',
} as const;

export const AUTHORABLE_RELATION_TYPES = Object.keys(RELATION_TYPE_METADATA) as ReadonlyArray<keyof typeof RELATION_TYPE_METADATA>;

/**
 * @deprecated Use AUTHORABLE_RELATION_TYPES.
 * Kept as a compatibility alias for public authorable relation types.
 */
export const RELATION_TYPES = AUTHORABLE_RELATION_TYPES;

export const MEMORY_TYPES = [
  'Decision', 'Pattern', 'Preference', 'Style', 'Habit', 'Insight', 'Context',
] as const;

export type AuthorableRelationType = (typeof AUTHORABLE_RELATION_TYPES)[number];
/** @deprecated Use AuthorableRelationType. */
export type RelationType = AuthorableRelationType;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface AutoMemConfig {
  endpoint: string;
  apiKey?: string;
}

export interface MemoryRecord {
  content: string;
  type?: MemoryType;
  confidence?: number;
  id?: string;
  tags?: string[];
  importance?: number;
  embedding?: number[];
  metadata?: Record<string, any>;
  timestamp?: string;
  t_valid?: string;
  t_invalid?: string;
  updated_at?: string;
  last_accessed?: string;
}

export interface StoredMemory {
  memory_id: string;
  content: string;
  tags: string[];
  importance: number;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, any>;
  type?: MemoryType;
  confidence?: number;
}

export interface RecallResult {
  results: Array<{
    id: string;
    match_type: string;
    match_score?: number;
    relation_score?: number;
    final_score: number;
    score_components: Record<string, number>;
    source?: string;
    relations?: Array<Record<string, any>>;
    related_to?: Array<Record<string, any>>;
    memory: StoredMemory & Record<string, any>;
    deduped_from?: string[];
    expanded_from_entity?: string;
  }>;
  count: number;
  dedup_removed?: number;
  keywords?: string[];
  time_window?: { start?: string | null; end?: string | null };
  tags?: string[];
  tag_mode?: 'any' | 'all';
  tag_match?: 'exact' | 'prefix';
  expansion?: {
    enabled: boolean;
    seed_count: number;
    expanded_count: number;
    relation_limit: number;
    expansion_limit: number;
  };
  entity_expansion?: {
    enabled: boolean;
    expanded_count: number;
    entities_found: string[];
  };
  context_priority?: {
    language?: string;
    context?: string;
    priority_tags?: string[];
    priority_types?: string[];
    injected?: boolean;
  };
}

export interface HealthStatus {
  status: 'healthy' | 'error';
  backend: string;
  statistics: {
    falkordb?: string;
    qdrant?: string;
    graph?: string;
    timestamp?: string;
  };
  error?: string;
}

export interface StoreMemoryArgs {
  content: string;
  type?: MemoryType;
  confidence?: number;
  id?: string;
  tags?: string[];
  importance?: number;
  embedding?: number[];
  metadata?: Record<string, any>;
  timestamp?: string;
  t_valid?: string;
  t_invalid?: string;
  updated_at?: string;
  last_accessed?: string;
}

export interface RecallMemoryArgs {
  query?: string;
  queries?: string[];
  embedding?: number[];
  limit?: number;
  time_query?: string;
  start?: string;
  end?: string;
  tags?: string[];
  tag_mode?: 'any' | 'all';
  tag_match?: 'exact' | 'prefix';
  // Graph expansion
  expand_relations?: boolean;
  expand_entities?: boolean;
  auto_decompose?: boolean;
  expansion_limit?: number;
  relation_limit?: number;
  // Expansion filtering (reduces noise in expanded results)
  expand_min_importance?: number;
  expand_min_strength?: number;
  // Context hints for smarter recall
  context?: string;
  language?: string;
  active_path?: string;
  context_tags?: string[];
  context_types?: string[];
  priority_ids?: string[];
  // Pagination and output control
  per_query_limit?: number;
  sort?: 'score' | 'time_desc' | 'time_asc' | 'updated_desc' | 'updated_asc';
  format?: 'text' | 'items' | 'detailed' | 'json';
  offset?: number;
}

export interface AssociateMemoryArgs {
  memory1_id: string;
  memory2_id: string;
  type: AuthorableRelationType;
  strength: number;
}

export interface UpdateMemoryArgs {
  memory_id: string;
  content?: string;
  tags?: string[];
  importance?: number;
  metadata?: Record<string, any>;
  timestamp?: string;
  updated_at?: string;
  last_accessed?: string;
  type?: MemoryType;
  confidence?: number;
}

export interface DeleteMemoryArgs {
  memory_id: string;
}

export interface TagSearchArgs {
  tags: string[];
  limit?: number;
}

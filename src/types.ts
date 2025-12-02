export interface AutoMemConfig {
  endpoint: string;
  apiKey?: string;
}

export interface MemoryRecord {
  content: string;
  tags?: string[];
  importance?: number;
  embedding?: number[];
  metadata?: Record<string, any>;
  timestamp?: string;
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
  type?: string;
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
  tags?: string[];
  importance?: number;
  embedding?: number[];
  metadata?: Record<string, any>;
  timestamp?: string;
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
  expand_relations?: boolean;
  expansion_limit?: number;
  relation_limit?: number;
}

export interface AssociateMemoryArgs {
  memory1_id: string;
  memory2_id: string;
  type: 'RELATES_TO' | 'LEADS_TO' | 'OCCURRED_BEFORE';
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
  type?: string;
  confidence?: number;
}

export interface DeleteMemoryArgs {
  memory_id: string;
}

export interface TagSearchArgs {
  tags: string[];
  limit?: number;
}

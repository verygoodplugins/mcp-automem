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
    final_score: number;
    score_components: Record<string, number>;
    memory: StoredMemory & Record<string, any>;
  }>;
  count: number;
  keywords?: string[];
  time_window?: { start?: string | null; end?: string | null };
  tags?: string[];
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
  embedding?: number[];
  limit?: number;
  time_query?: string;
  start?: string;
  end?: string;
  tags?: string[];
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

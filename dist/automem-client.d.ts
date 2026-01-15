import type { AutoMemConfig, RecallResult, HealthStatus, StoreMemoryArgs, RecallMemoryArgs, AssociateMemoryArgs, UpdateMemoryArgs, DeleteMemoryArgs } from './types.js';
export declare class AutoMemClient {
    private config;
    private circuitBreaker;
    constructor(config: AutoMemConfig);
    private makeRequest;
    storeMemory(args: StoreMemoryArgs): Promise<{
        memory_id: string;
        message: string;
    }>;
    recallMemory(args: RecallMemoryArgs): Promise<RecallResult>;
    associateMemories(args: AssociateMemoryArgs): Promise<{
        success: boolean;
        message: string;
    }>;
    checkHealth(): Promise<HealthStatus>;
    updateMemory(args: UpdateMemoryArgs): Promise<{
        memory_id: string;
        message: string;
    }>;
    deleteMemory(args: DeleteMemoryArgs): Promise<{
        memory_id: string;
        message: string;
    }>;
    getCircuitState(): {
        state: string;
        failureCount: number;
        lastFailureTime: number;
    };
    resetCircuit(): void;
}
//# sourceMappingURL=automem-client.d.ts.map
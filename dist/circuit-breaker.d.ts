/**
 * Circuit breaker states for managing service availability
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
/**
 * Configuration options for the circuit breaker
 */
export interface CircuitBreakerOptions {
    /** Number of failures before opening circuit (default: 5) */
    failureThreshold?: number;
    /** Time in ms to wait before attempting recovery (default: 30000) */
    resetTimeout?: number;
    /** Number of successful calls to close circuit from half-open (default: 2) */
    successThreshold?: number;
}
/**
 * Circuit breaker implementation for protecting against cascading failures.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is down, requests fail fast
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({ failureThreshold: 3 });
 *
 * async function callService() {
 *   if (!breaker.canExecute()) {
 *     throw new Error('Service unavailable (circuit open)');
 *   }
 *   try {
 *     const result = await fetch(url);
 *     breaker.recordSuccess();
 *     return result;
 *   } catch (error) {
 *     breaker.recordFailure();
 *     throw error;
 *   }
 * }
 * ```
 */
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private successCount;
    private lastFailureTime;
    private readonly failureThreshold;
    private readonly resetTimeout;
    private readonly successThreshold;
    constructor(options?: CircuitBreakerOptions);
    /**
     * Check if the circuit allows execution.
     * Handles state transitions from OPEN to HALF_OPEN when reset timeout expires.
     */
    canExecute(): boolean;
    /**
     * Record a successful call. May transition circuit from HALF_OPEN to CLOSED.
     */
    recordSuccess(): void;
    /**
     * Record a failed call. May transition circuit from CLOSED/HALF_OPEN to OPEN.
     */
    recordFailure(): void;
    /**
     * Get current circuit state for monitoring/debugging
     */
    getState(): CircuitState;
    /**
     * Get circuit statistics for monitoring
     */
    getStats(): {
        state: CircuitState;
        failureCount: number;
        successCount: number;
        lastFailureTime: number;
    };
    /**
     * Force reset the circuit breaker to CLOSED state
     */
    reset(): void;
}
//# sourceMappingURL=circuit-breaker.d.ts.map
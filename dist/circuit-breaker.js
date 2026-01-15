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
export class CircuitBreaker {
    state = 'CLOSED';
    failureCount = 0;
    successCount = 0;
    lastFailureTime = 0;
    failureThreshold;
    resetTimeout;
    successThreshold;
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.resetTimeout = options.resetTimeout ?? 30000;
        this.successThreshold = options.successThreshold ?? 2;
    }
    /**
     * Check if the circuit allows execution.
     * Handles state transitions from OPEN to HALF_OPEN when reset timeout expires.
     */
    canExecute() {
        if (this.state === 'CLOSED') {
            return true;
        }
        if (this.state === 'OPEN') {
            const now = Date.now();
            if (now - this.lastFailureTime >= this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.successCount = 0;
                return true;
            }
            return false;
        }
        // HALF_OPEN: allow limited requests to test recovery
        return true;
    }
    /**
     * Record a successful call. May transition circuit from HALF_OPEN to CLOSED.
     */
    recordSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.state = 'CLOSED';
                this.failureCount = 0;
                this.successCount = 0;
            }
        }
        else if (this.state === 'CLOSED') {
            // Reset failure count on success
            this.failureCount = 0;
        }
    }
    /**
     * Record a failed call. May transition circuit from CLOSED/HALF_OPEN to OPEN.
     */
    recordFailure() {
        this.lastFailureTime = Date.now();
        if (this.state === 'HALF_OPEN') {
            // Any failure in half-open immediately opens the circuit
            this.state = 'OPEN';
            this.failureCount = this.failureThreshold;
        }
        else if (this.state === 'CLOSED') {
            this.failureCount++;
            if (this.failureCount >= this.failureThreshold) {
                this.state = 'OPEN';
            }
        }
    }
    /**
     * Get current circuit state for monitoring/debugging
     */
    getState() {
        return this.state;
    }
    /**
     * Get circuit statistics for monitoring
     */
    getStats() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
        };
    }
    /**
     * Force reset the circuit breaker to CLOSED state
     */
    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = 0;
    }
}
//# sourceMappingURL=circuit-breaker.js.map
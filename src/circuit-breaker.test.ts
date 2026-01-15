import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      successThreshold: 2,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should allow execution in CLOSED state', () => {
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('failure handling', () => {
    it('should remain CLOSED below failure threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.canExecute()).toBe(true);
    });

    it('should transition to OPEN at failure threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should not allow execution when OPEN', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.canExecute()).toBe(false);
    });

    it('should reset failure count on success', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();
      expect(breaker.getStats().failureCount).toBe(0);
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('CLOSED'); // Still closed, count reset
    });
  });

  describe('recovery (HALF_OPEN state)', () => {
    it('should transition to HALF_OPEN after reset timeout', () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');

      // Advance time past reset timeout
      vi.advanceTimersByTime(1001);

      // Check if we can execute (triggers transition)
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe('HALF_OPEN');
    });

    it('should transition to CLOSED after success threshold in HALF_OPEN', () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Wait for reset timeout
      vi.advanceTimersByTime(1001);
      breaker.canExecute(); // Trigger transition to HALF_OPEN

      // Record successes
      breaker.recordSuccess();
      expect(breaker.getState()).toBe('HALF_OPEN'); // Still half-open
      breaker.recordSuccess();
      expect(breaker.getState()).toBe('CLOSED'); // Now closed
    });

    it('should transition back to OPEN on failure in HALF_OPEN', () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Wait for reset timeout
      vi.advanceTimersByTime(1001);
      breaker.canExecute(); // Trigger transition to HALF_OPEN
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Any failure immediately opens the circuit
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('stats and monitoring', () => {
    it('should track failure count', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStats().failureCount).toBe(2);
    });

    it('should track last failure time', () => {
      const now = Date.now();
      vi.setSystemTime(now);
      breaker.recordFailure();
      expect(breaker.getStats().lastFailureTime).toBe(now);
    });

    it('should track success count in HALF_OPEN', () => {
      // Open then wait
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      vi.advanceTimersByTime(1001);
      breaker.canExecute();

      breaker.recordSuccess();
      expect(breaker.getStats().successCount).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      // Create some state
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Reset
      breaker.reset();

      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getStats().failureCount).toBe(0);
      expect(breaker.getStats().successCount).toBe(0);
      expect(breaker.getStats().lastFailureTime).toBe(0);
    });
  });

  describe('default options', () => {
    it('should use default values when no options provided', () => {
      const defaultBreaker = new CircuitBreaker();

      // Default failure threshold is 5
      for (let i = 0; i < 4; i++) {
        defaultBreaker.recordFailure();
      }
      expect(defaultBreaker.getState()).toBe('CLOSED');
      defaultBreaker.recordFailure();
      expect(defaultBreaker.getState()).toBe('OPEN');
    });
  });
});

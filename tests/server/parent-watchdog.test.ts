/**
 * Unit tests for the parent-liveness watchdog. These import from `src/`
 * directly (not `dist/`), so they exercise the watchdog logic without
 * spawning a server or rebuilding.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_PARENT_WATCHDOG_MS,
  parentReparented,
  parseWatchdogIntervalMs,
  startParentWatchdog,
} from '../../src/lifecycle.js';

describe('parentReparented', () => {
  it('is false while the captured pid is still our parent', () => {
    expect(parentReparented(process.ppid)).toBe(false);
  });

  it('is true once the captured pid no longer matches our parent', () => {
    // process.ppid is a real pid; any other value means we were reparented.
    expect(parentReparented(process.ppid + 1)).toBe(true);
  });
});

describe('parseWatchdogIntervalMs', () => {
  it('falls back to the 30s default when unset', () => {
    expect(parseWatchdogIntervalMs(undefined)).toBe(DEFAULT_PARENT_WATCHDOG_MS);
  });

  it('falls back to the default for non-numeric, zero, or negative values (never disables)', () => {
    // The watchdog is load-bearing — no env value may silently turn it off.
    expect(parseWatchdogIntervalMs('abc')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
    expect(parseWatchdogIntervalMs('')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
    expect(parseWatchdogIntervalMs('0')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
    expect(parseWatchdogIntervalMs('-1')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
  });

  it('floors tiny positive values so a typo cannot spin the CPU', () => {
    // Without the floor, setInterval(fn, 5) (or -1) becomes a ~1ms hot poll.
    expect(parseWatchdogIntervalMs('5')).toBe(100);
  });

  it('honours a sane positive interval (e.g. the 250ms the integration test uses)', () => {
    expect(parseWatchdogIntervalMs('250')).toBe(250);
  });
});

describe('startParentWatchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never fires while the parent stays alive', () => {
    vi.useFakeTimers();
    const onDead = vi.fn();
    const handle = startParentWatchdog(1234, 100, onDead, () => false);
    vi.advanceTimersByTime(1000); // 10 ticks
    expect(onDead).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('fires onDead exactly once after the parent is gone', () => {
    vi.useFakeTimers();
    const onDead = vi.fn();
    const handle = startParentWatchdog(1234, 100, onDead, () => true);
    vi.advanceTimersByTime(1000); // 10 ticks — must not fire repeatedly
    expect(onDead).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('returns an unref-able interval handle (never pins the event loop)', () => {
    vi.useFakeTimers();
    const handle = startParentWatchdog(1234, 100, () => {}, () => false);
    expect(typeof (handle as unknown as { unref?: unknown }).unref).toBe('function');
    clearInterval(handle);
  });
});

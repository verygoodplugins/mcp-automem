/**
 * Parent-liveness watchdog for the stdio MCP server.
 *
 * The load-bearing fix for the orphaned-process leak. When an intermediate
 * wrapper (npx → npm exec → node bin → server) keeps the server's stdin
 * write-end open, a dead client never delivers EOF, so the leaf sits in the
 * event loop forever (~108 MB each; 155 leaked → ~18 GB observed). stdin
 * 'end'/'close', transport close, and signals all miss this case. The
 * watchdog catches it by noticing the original parent is gone.
 *
 * Kept in its own module (no side effects on import) so it can be unit-tested
 * without spawning the whole server — `src/index.ts` runs `main()` at import.
 */

export type ParentLivenessProbe = (parentPid: number) => boolean;

/** Poll interval (ms) used when the env override is unset or invalid. */
export const DEFAULT_PARENT_WATCHDOG_MS = 30_000;

/**
 * Floor (ms) for the poll interval. Guards against a hostile/typo'd env value:
 * `Number("-1")` is truthy and would otherwise reach `setInterval(fn, -1)`,
 * which Node clamps to 1 ms — a CPU-spinning poll. Small enough to keep the
 * test ticks fast (the integration test uses 250 ms).
 */
const MIN_PARENT_WATCHDOG_MS = 100;

/**
 * Parse `AUTOMEM_PARENT_WATCHDOG_MS` into a safe poll interval.
 *
 * Any non-finite, zero, or negative value falls back to the 30 s default. The
 * watchdog is load-bearing, so there is intentionally NO "disable" value — an
 * unparseable knob must never silently turn orphan protection off. A positive
 * value is honoured but floored at {@link MIN_PARENT_WATCHDOG_MS} so a tiny or
 * negative input can't spin the CPU.
 */
export function parseWatchdogIntervalMs(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PARENT_WATCHDOG_MS;
  return Math.max(n, MIN_PARENT_WATCHDOG_MS);
}

/**
 * Default probe: the server has been reparented away from its original parent.
 *
 * `process.ppid` is dynamic on modern Node (re-read on each access), so once
 * the original parent dies and the leaf is reparented (to launchd/pid 1 or a
 * subreaper) `process.ppid` no longer equals the pid captured at startup.
 * Comparing identities — rather than `process.kill(parentPid, 0)` — is immune
 * to PID reuse: a recycled pid can't masquerade as the original parent.
 *
 * POSIX only: this relies on the kernel reparenting an orphan (to pid 1 or a
 * subreaper) when its parent dies. Windows does not reparent orphans, so
 * `process.ppid` never changes there and this probe never fires — the watchdog
 * is a no-op on win32. Orphan mitigation on Windows would need a different
 * mechanism (e.g. a job object or a stdin heartbeat).
 */
export function parentReparented(parentPid: number): boolean {
  return process.ppid !== parentPid;
}

/**
 * Poll for the original parent's death and invoke `onDead` exactly once.
 *
 * The interval is `unref()`d so the watchdog never, by itself, keeps the
 * event loop alive — a clean stdin EOF must still let the process exit
 * promptly.
 *
 * @param parentPid    pid captured synchronously at startup (`process.ppid`)
 * @param intervalMs   poll interval in milliseconds
 * @param onDead       called at most once, when the parent is detected gone
 * @param isParentGone probe override (for tests); defaults to the reparent check
 * @returns the interval handle (already unref'd) so callers can clear it
 */
export function startParentWatchdog(
  parentPid: number,
  intervalMs: number,
  onDead: () => void,
  isParentGone: ParentLivenessProbe = parentReparented
): NodeJS.Timeout {
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    if (isParentGone(parentPid)) {
      fired = true;
      onDead();
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

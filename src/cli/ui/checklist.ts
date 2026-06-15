import { makeTheme } from './theme.js';

// A live apply checklist: on a TTY each step flips ○ pending → ◐ running → ✓ done
// (or ✗ failed) by redrawing the block in place (same cursor technique as the
// splash). On a non-TTY it degrades to one printed line per completed step, so
// piped / CI output stays clean and ordered.

export type ChecklistStep = { key: string; label: string };
type Status = 'pending' | 'running' | 'done' | 'fail';

export type Checklist = {
  start(key: string): void;
  done(key: string, label?: string): void;
  fail(key: string, label?: string): void;
  // Clean up the animation + restore the cursor (call before printing an error,
  // since a mid-run failure leaves later steps pending).
  stop(): void;
};

const RUNNING_FRAMES = ['◐', '◓', '◑', '◒'];

export function startChecklist(
  steps: ChecklistStep[],
  stream: NodeJS.WriteStream = process.stdout
): Checklist {
  const theme = makeTheme(stream);
  const live = stream.isTTY === true;
  const state = new Map<string, { label: string; status: Status }>(
    steps.map((s) => [s.key, { label: s.label, status: 'pending' as Status }])
  );
  let spinFrame = 0;

  const icon = (status: Status): string => {
    switch (status) {
      case 'done':
        return theme.style.gold(theme.symbol.check);
      case 'fail':
        return theme.style.red(theme.symbol.cross);
      case 'running':
        return theme.style.gold(RUNNING_FRAMES[spinFrame % RUNNING_FRAMES.length]);
      case 'pending':
        return theme.style.dim('○');
    }
  };

  const lineFor = (key: string): string => {
    const s = state.get(key)!;
    const label = s.status === 'pending' ? theme.style.dim(s.label) : s.label;
    return `  ${icon(s.status)} ${label}`;
  };

  let drawn = false;
  let spinner: ReturnType<typeof setInterval> | undefined;

  const redraw = () => {
    if (drawn) stream.write(`\x1b[${steps.length}A`);
    for (const s of steps) stream.write(`\x1b[2K${lineFor(s.key)}\n`);
    drawn = true;
  };

  if (live) {
    stream.write('\x1b[?25l'); // hide cursor while the block animates
    redraw();
    // Animate the running glyph so an in-flight step doesn't look frozen.
    spinner = setInterval(() => {
      spinFrame += 1;
      if ([...state.values()].some((s) => s.status === 'running')) redraw();
    }, 90);
  }

  const finishIfDone = () => {
    if (!live) return;
    if ([...state.values()].every((s) => s.status === 'done' || s.status === 'fail')) {
      if (spinner) clearInterval(spinner);
      redraw();
      stream.write('\x1b[?25h'); // restore cursor
    }
  };

  const set = (key: string, status: Status, label?: string) => {
    const s = state.get(key);
    if (!s) return;
    s.status = status;
    if (label) s.label = label;
    if (live) {
      redraw();
      finishIfDone();
    } else if (status === 'done') {
      stream.write(`  ${theme.style.gold(theme.symbol.check)} ${s.label}\n`);
    } else if (status === 'fail') {
      stream.write(`  ${theme.style.red(theme.symbol.cross)} ${s.label}\n`);
    }
  };

  const stop = () => {
    if (!live) return;
    if (spinner) clearInterval(spinner);
    redraw();
    stream.write('\x1b[?25h'); // restore cursor
  };

  return {
    start: (key) => set(key, 'running'),
    done: (key, label) => set(key, 'done', label),
    fail: (key, label) => set(key, 'fail', label),
    stop,
  };
}

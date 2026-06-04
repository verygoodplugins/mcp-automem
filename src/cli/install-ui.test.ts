import { describe, expect, it } from 'vitest';
import {
  gradientLine,
  renderInstallerSplash,
  renderMascot,
  shouldUseInstallerAnimation,
} from './install-ui.js';

function stripAnsi(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\u001b' && value[index + 1] === '[') {
      index += 2;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      continue;
    }
    result += value[index];
  }
  return result;
}

describe('installer mascot UI', () => {
  it('renders the floppy shutter as an 8-cell progress bar', () => {
    const mascot = renderMascot({ pct: 50, state: 'working', color: false });

    expect(mascot).toContain('▐████░░░░▌');
    expect(mascot).toContain('◓    ◓');
    expect(mascot.split('\n')).toHaveLength(5);
  });

  it('clamps mascot progress and switches face states', () => {
    expect(renderMascot({ pct: -20, state: 'error', color: false })).toContain('▐░░░░░░░░▌');
    expect(renderMascot({ pct: 150, state: 'done', color: false })).toContain('▐████████▌');
    expect(renderMascot({ pct: 150, state: 'done', color: false })).toContain('●    ●');
    expect(renderMascot({ pct: 10, state: 'error', color: false })).toContain('×    ×');
  });

  it('does not animate in agent or non-TTY contexts', () => {
    expect(
      shouldUseInstallerAnimation({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: {},
        args: [],
      })
    ).toBe(true);

    expect(
      shouldUseInstallerAnimation({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: { CI: '1' },
        args: [],
      })
    ).toBe(false);

    expect(
      shouldUseInstallerAnimation({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: { NO_COLOR: '1' },
        args: [],
      })
    ).toBe(true);

    expect(
      shouldUseInstallerAnimation({
        stdinIsTTY: true,
        stdoutIsTTY: false,
        env: {},
        args: [],
      })
    ).toBe(false);

    expect(
      shouldUseInstallerAnimation({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: {},
        args: ['--mode', 'agent'],
      })
    ).toBe(false);
  });

  it('keeps the splash static and parseable when color is disabled', () => {
    const splash = renderInstallerSplash({ color: false, mascotState: 'idle' });

    expect(splash).toContain('AutoMem');
    expect(splash).toContain("Your agents' memory. Everywhere.");
    expect(splash).toContain('▐████████▌');
    expect(splash).not.toContain('\u001b[');
  });

  it('can colorize the wordmark without changing visible text', () => {
    const colored = gradientLine('AutoMem', true);

    expect(colored).toContain('\u001b[38;2;');
    expect(stripAnsi(colored)).toBe('AutoMem');
  });
});

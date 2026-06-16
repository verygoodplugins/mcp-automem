import { describe, expect, it } from 'vitest';
import {
  makeTheme,
  padEndVisible,
  repeatVisible,
  stripAnsi,
  visibleLength,
} from './theme.js';
import { bulletList, keyValueRows, statusMark } from './table.js';
import { badge, noteBox, sectionTitle } from './messages.js';
import { renderSuccessCard, renderSuccessOutro } from './brand.js';
import { escapeCliText, formatJson, joinCliList, truncateCliText } from './output.js';
import { animationEnabled, revealHeroLine, revealLines } from './animate.js';
import { startChecklist } from './checklist.js';
import { startSpinner } from './tasks.js';
import { WORDMARK_WIDTH, centerBlock, centerLine } from '../install-ui.js';

const stream = process.stdout;

describe('ui/theme', () => {
  it('emits no ANSI when color is never, and ANSI when always', () => {
    const plain = makeTheme(stream, { color: 'never', symbols: 'ascii' });
    expect(plain.color).toBe(false);
    expect(plain.style.gold('hi')).toBe('hi');
    expect(plain.style.inverseGold('hi')).toBe('[hi]');

    const colored = makeTheme(stream, { color: 'always', symbols: 'unicode' });
    expect(colored.style.gold('hi')).toContain('\x1b[');
    expect(stripAnsi(colored.style.gold('hi'))).toBe('hi');
  });

  it('switches symbol sets between unicode and ascii', () => {
    expect(makeTheme(stream, { symbols: 'unicode' }).symbol.check).toBe('✓');
    expect(makeTheme(stream, { symbols: 'ascii' }).symbol.check).toBe('+');
    expect(makeTheme(stream, { symbols: 'ascii' }).symbol.arrow).toBe('->');
  });

  it('auto mode never colors a non-TTY even when FORCE_COLOR is set', () => {
    const prev = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';
    try {
      const notty = { isTTY: false } as unknown as NodeJS.WriteStream;
      expect(makeTheme(notty, {}).color).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prev;
    }
  });

  it('measures and pads by visible width, ignoring ANSI', () => {
    const colored = makeTheme(stream, { color: 'always' }).style.gold('abc');
    expect(visibleLength(colored)).toBe(3);
    expect(visibleLength(padEndVisible(colored, 6))).toBe(6);
    expect(repeatVisible('-', 4)).toBe('----');
    expect(repeatVisible('-', -2)).toBe('');
  });
});

describe('ui/table', () => {
  const theme = makeTheme(stream, { color: 'never', symbols: 'ascii' });

  it('renders aligned key/value rows with status marks', () => {
    const rendered = keyValueRows(
      [
        { label: 'mode', value: 'existing', status: 'ok' },
        { label: 'endpoint', value: 'https://x', status: 'warn' },
      ],
      theme
    );
    expect(rendered).toContain('mode');
    expect(rendered).toContain('existing');
    expect(rendered).toContain('https://x');
    expect(rendered.split('\n')).toHaveLength(2);
  });

  it('marks status with ascii glyphs in plain mode', () => {
    expect(statusMark(theme, 'ok')).toBe('+');
    expect(statusMark(theme, 'error')).toBe('x');
    expect(statusMark(theme, 'warn')).toBe('!');
    expect(statusMark(theme, 'muted')).toBe('-');
  });

  it('returns empty string for no rows', () => {
    expect(keyValueRows([], theme)).toBe('');
    expect(bulletList(['a', 'b'], theme)).toContain('a');
  });
});

describe('ui/messages', () => {
  const theme = makeTheme(stream, { color: 'never', symbols: 'ascii' });

  it('renders badges and section titles', () => {
    expect(badge('verify', theme, 'dim')).toBe('[verify]');
    expect(badge('automem', theme)).toBe('[automem]'); // inverseGold falls back to brackets
    expect(sectionTitle('Stages', theme)).toContain('Stages');
  });

  it('frames a note box with rules', () => {
    const box = noteBox('Title', ['line one'], stream);
    expect(box).toContain('Title');
    expect(box).toContain('line one');
  });
});

describe('ui/output', () => {
  it('escapes and truncates control-laden text', () => {
    expect(escapeCliText('a\nb\t')).toBe('a\\nb\\t');
    expect(truncateCliText('abcdef', 5)).toBe('ab...');
    expect(joinCliList([], { empty: 'none' })).toBe('none');
    expect(joinCliList(['a', 'b', 'c'], { maxItems: 2 })).toBe('a, b, +1 more');
  });

  it('formats json defensively', () => {
    expect(formatJson({ a: 1 })).toContain('"a": 1');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatJson(circular)).toBe('null');
  });
});

describe('ui/brand', () => {
  it('renders a branded success outro with the title and next steps', () => {
    const outro = renderSuccessOutro('AutoMem is installed', ['endpoint  https://x'], stream);
    expect(outro).toContain('AutoMem is installed');
    expect(outro).toContain('endpoint  https://x');
  });

  it('renderSuccessCard falls back to a clean outro without color/unicode (CI/pipe)', () => {
    const card = renderSuccessCard('AutoMem is installed', ['endpoint  https://x'], stream);
    expect(card).toContain('AutoMem is installed');
    expect(card).toContain('endpoint  https://x');
    // non-TTY fallback must not emit a box border or cursor escapes
    expect(card).not.toContain('╭');
  });
});

describe('ui/checklist', () => {
  it('degrades pending/running glyphs to ASCII when unicode is off', () => {
    const prev = process.env.AUTOMEM_ASCII;
    process.env.AUTOMEM_ASCII = '1';
    try {
      let out = '';
      const fake = { write: (s: string) => { out += s; }, isTTY: true, columns: 80 } as unknown as NodeJS.WriteStream;
      const list = startChecklist([{ key: 'a', label: 'Step A' }], fake);
      list.stop();
      expect(out).toContain('o'); // ascii pending glyph
      expect(out).not.toContain('○'); // never the unicode circle
      expect(out).not.toContain('◐'); // never the unicode spinner
    } finally {
      if (prev === undefined) delete process.env.AUTOMEM_ASCII;
      else process.env.AUTOMEM_ASCII = prev;
    }
  });

  it('prints one clean line per completed step on a non-TTY (no cursor escapes)', () => {
    let out = '';
    const fake = { write: (s: string) => { out += s; }, isTTY: false } as unknown as NodeJS.WriteStream;
    const list = startChecklist(
      [{ key: 'a', label: 'Verify endpoint' }, { key: 'b', label: 'Write .env' }],
      fake
    );
    list.start('a');
    list.done('a', 'Endpoint verified');
    list.start('b');
    list.done('b');
    list.stop();
    expect(out).toContain('Endpoint verified');
    expect(out).toContain('Write .env');
    expect(out).not.toContain('\x1b[?25l'); // no hide-cursor / redraw region on a non-TTY
    expect(out).not.toContain('\x1b[2K'); // no clear-line redraws
  });
});

describe('ui/tasks', () => {
  it('uses ASCII spinner frames when unicode is off', () => {
    const prev = process.env.AUTOMEM_ASCII;
    process.env.AUTOMEM_ASCII = '1';
    try {
      let out = '';
      const fake = { write: (s: string) => { out += s; }, isTTY: true, columns: 80 } as unknown as NodeJS.WriteStream;
      const sp = startSpinner('Working', fake);
      sp.stop('Done');
      expect(out).not.toContain('◐'); // never a unicode frame
      expect(/[-\\|/]/.test(out)).toBe(true); // an ascii frame was rendered
    } finally {
      if (prev === undefined) delete process.env.AUTOMEM_ASCII;
      else process.env.AUTOMEM_ASCII = prev;
    }
  });
});

describe('ui/animate', () => {
  it('writes everything at once (with a trailing newline) when disabled', async () => {
    let out = '';
    const fake = { write: (s: string) => { out += s; }, isTTY: false } as unknown as NodeJS.WriteStream;
    await revealLines('a\nb\nc', { stream: fake });
    expect(out).toBe('a\nb\nc\n');
  });

  it('gates animation on a TTY and a clean env', () => {
    const tty = { isTTY: true } as unknown as NodeJS.WriteStream;
    const notty = { isTTY: false } as unknown as NodeJS.WriteStream;
    expect(animationEnabled(notty, {})).toBe(false);
    expect(animationEnabled(tty, { CI: '1' })).toBe(false);
    expect(animationEnabled(tty, { NO_COLOR: '1' })).toBe(false);
    expect(animationEnabled(tty, { AUTOMEM_NO_ANIM: '1' })).toBe(false);
    expect(animationEnabled(tty, {})).toBe(true);
  });

  it('typed reveal types prose but snaps box/rule lines in whole', async () => {
    let out = '';
    const fake = { write: (s: string) => { out += s; }, isTTY: true } as unknown as NodeJS.WriteStream;
    await revealLines('Hello there friend\n╭───╮\n│ x │\n╰───╯', {
      stream: fake,
      enabled: true,
      typed: true,
      wordDelayMs: 0,
      lineBeatMs: 0,
      structuralBeatMs: 0,
    });
    // every word is present, in order, and the box is intact line-by-line
    expect(out).toContain('Hello there friend');
    expect(out).toContain('╭───╮');
    expect(out).toContain('│ x │');
    expect(out).toContain('╰───╯');
  });

  it('revealHeroLine prints once on a non-TTY (no cursor hide)', async () => {
    let out = '';
    const fake = { write: (s: string) => { out += s; }, isTTY: false } as unknown as NodeJS.WriteStream;
    await revealHeroLine('Set up your memory', { stream: fake });
    expect(out).toContain('Set up your memory');
    expect(out).not.toContain('\x1b[?25l');
  });
});

describe('install-ui/centering', () => {
  it('centers a single line under the wordmark width (ANSI-safe)', () => {
    const centered = centerLine('AutoMem');
    expect(centered.endsWith('AutoMem')).toBe(true);
    expect(stripAnsi(centered).length).toBeGreaterThan('AutoMem'.length);
    // colored input centers by visible width, not byte length
    const colored = makeTheme(stream, { color: 'always' }).style.gold('AutoMem');
    expect(stripAnsi(centerLine(colored)).trimStart()).toBe('AutoMem');
  });

  it('shifts a multi-line block by a uniform pad, preserving internal layout', () => {
    const block = '╭──╮\n│xy│\n╰──╯';
    const centered = centerBlock(block, WORDMARK_WIDTH);
    const pads = centered.split('\n').map((line) => line.length - line.trimStart().length);
    expect(new Set(pads).size).toBe(1); // same indent on every row
    expect(pads[0]).toBeGreaterThan(0);
  });
});

// Progressive reveal so the review/outro builds in instead of dumping all at
// once. Strictly cosmetic: on a non-TTY, or with NO_COLOR / CI / AUTOMEM_NO_ANIM
// set, it prints everything instantly so piped output, tests, and CI logs are
// unchanged. The `typed` mode mirrors AutoVault's word-by-word cadence — prose
// lines type in a word at a time; box/rule lines snap in whole so borders never
// render half-drawn.

import { makeTheme, stripAnsi, type Theme } from './theme.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function animationEnabled(
  stream: NodeJS.WriteStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (stream.isTTY !== true) return false;
  if (env.NO_COLOR || env.CI || env.AUTOMEM_NO_ANIM) return false;
  return true;
}

// A line is "structural" — printed whole rather than typed — when it carries
// box-drawing/rule glyphs, is blank, or has no letters/digits to type. This
// keeps boxes, tables, and section rules from ever appearing half-built.
function isStructuralLine(line: string): boolean {
  const visible = stripAnsi(line);
  if (visible.trim().length === 0) return true;
  if (/[─│╭╮╰╯┌┐└┘━═┃║┄┈]/u.test(visible)) return true;
  if (!/[A-Za-z0-9]/.test(visible)) return true;
  return false;
}

// Type one prose line a word at a time, preserving its original indentation and
// spacing (whitespace runs are written but not paused on).
async function typeLine(
  stream: NodeJS.WriteStream,
  line: string,
  wordDelayMs: number
): Promise<void> {
  for (const token of line.split(/(\s+)/)) {
    if (token.length === 0) continue;
    stream.write(token);
    if (token.trim().length > 0 && wordDelayMs > 0) await sleep(wordDelayMs);
  }
  stream.write('\n');
}

export type RevealOptions = {
  stream?: NodeJS.WriteStream;
  enabled?: boolean;
  /** Line-by-line (non-typed) cadence, ms between whole lines. */
  delayMs?: number;
  /** Type prose word-by-word; snap structural lines in whole. */
  typed?: boolean;
  wordDelayMs?: number;
  lineBeatMs?: number;
  structuralBeatMs?: number;
};

export async function revealLines(text: string, options: RevealOptions = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const enabled = options.enabled ?? animationEnabled(stream);
  if (!enabled) {
    stream.write(text.endsWith('\n') ? text : `${text}\n`);
    return;
  }

  const lines = text.split('\n');

  if (options.typed) {
    const wordDelayMs = options.wordDelayMs ?? 30;
    const lineBeatMs = options.lineBeatMs ?? 45;
    const structuralBeatMs = options.structuralBeatMs ?? 60;
    for (const line of lines) {
      if (isStructuralLine(line)) {
        stream.write(`${line}\n`);
        if (structuralBeatMs > 0) await sleep(structuralBeatMs);
      } else {
        await typeLine(stream, line, wordDelayMs);
        if (lineBeatMs > 0) await sleep(lineBeatMs);
      }
    }
    return;
  }

  const delayMs = options.delayMs ?? 14;
  for (const line of lines) {
    stream.write(`${line}\n`);
    if (delayMs > 0) await sleep(delayMs);
  }
}

// A single hero line typed word-by-word at AutoVault's signature cadence
// (160ms lead, then 120–180ms per word). Redrawn in place so it reads as one
// line being typed. Falls back to a single styled write off-TTY.
export async function revealHeroLine(
  text: string,
  options: { stream?: NodeJS.WriteStream; enabled?: boolean; style?: (text: string) => string } = {}
): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const enabled = options.enabled ?? animationEnabled(stream);
  const theme: Theme = makeTheme(stream);
  const style = options.style ?? ((value: string) => theme.style.gold(value));

  if (!enabled) {
    stream.write(`  ${style(text)}\n`);
    return;
  }

  const words = text.split(/\s+/).filter(Boolean);
  stream.write('\x1b[?25l');
  try {
    let acc = '';
    for (let i = 0; i < words.length; i += 1) {
      acc = acc ? `${acc} ${words[i]}` : words[i];
      stream.write(`\r\x1b[2K  ${style(acc)}`);
      await sleep(i === 0 ? 160 : 120 + (i % 3) * 30);
    }
    stream.write('\n');
  } finally {
    stream.write('\x1b[?25h');
  }
}

import { visibleLength } from './ui/theme.js';

export type MascotState = 'idle' | 'blink' | 'working' | 'done' | 'sleeping' | 'error';

type Face = {
  eyes: string;
  mouth: string;
};

type MascotOptions = {
  pct?: number;
  state?: MascotState;
  color?: boolean;
  sparkleFrame?: number;
};

type AnimationOptions = {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  args: string[];
};

const RESET = '\x1b[0m';

const COLORS = {
  gold: [255, 210, 63],
  goldBright: [255, 233, 168],
  amber: [244, 169, 60],
  shutterEmpty: [58, 58, 71],
  frame: [110, 106, 120],
  text: [232, 230, 223],
  muted: [125, 124, 133],
} as const;

const FACES: Record<MascotState, Face> = {
  idle: { eyes: '●    ●', mouth: '‿' },
  blink: { eyes: '‾    ‾', mouth: '‿' },
  working: { eyes: '◓    ◓', mouth: '▱' },
  done: { eyes: '●    ●', mouth: '‿' },
  sleeping: { eyes: '‾    ‾', mouth: '‿' },
  error: { eyes: '×    ×', mouth: '︵' },
};

export const WORDMARK = String.raw`
     ___        __        __  ___
    /   | __  _/ /_____  /  |/  /__  ____ ___
   / /| |/ / / / __/ __ \/ /|_/ / _ \/ __ \`__ \
  / ___ / /_/ / /_/ /_/ / /  / /  __/ / / / / /
 /_/  |_\__,_/\__/\____/_/  /_/\___/_/ /_/ /_/
`.trimEnd();

// Visible width of the widest wordmark row — the centering target so the mascot
// and footer sit centered under the graphic instead of hugging the left edge.
export const WORDMARK_WIDTH = Math.max(...WORDMARK.split('\n').map((line) => line.length));

// Shift a whole block right by a uniform pad so it centers under `width` while
// preserving its internal alignment. Measures by visible width (ANSI-safe).
export function centerBlock(text: string, width: number = WORDMARK_WIDTH): string {
  const lines = text.split('\n');
  const blockWidth = Math.max(0, ...lines.map((line) => visibleLength(line)));
  const pad = Math.max(0, Math.round((width - blockWidth) / 2));
  if (pad === 0) return text;
  const prefix = ' '.repeat(pad);
  return lines.map((line) => (visibleLength(line) === 0 ? line : `${prefix}${line}`)).join('\n');
}

// Center a single line under `width` (ANSI-safe).
export function centerLine(line: string, width: number = WORDMARK_WIDTH): string {
  const pad = Math.max(0, Math.round((width - visibleLength(line)) / 2));
  return pad === 0 ? line : `${' '.repeat(pad)}${line}`;
}

function rgb(color: readonly [number, number, number], value: string, enabled: boolean): string {
  if (!enabled || value.length === 0) return value;
  return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${value}${RESET}`;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

export function gradientLine(
  text: string,
  color = true,
  stops = ['#FFE9A8', '#FFD23F', '#F4A93C'],
  offset = 0
): string {
  if (!color || text.length === 0) return text;
  const colors = stops.map(hexToRgb);
  const chars = [...text];

  return `${chars
    .map((char, index) => {
      const t = chars.length < 2 ? 0 : ((index + offset) % chars.length) / (chars.length - 1);
      const segment = t * (colors.length - 1);
      const lower = Math.min(Math.floor(segment), colors.length - 2);
      const mix = segment - lower;
      const [r, g, b] = [0, 1, 2].map((channel) =>
        lerp(colors[lower][channel], colors[lower + 1][channel], mix)
      );
      return `\x1b[38;2;${r};${g};${b}m${char}`;
    })
    .join('')}${RESET}`;
}

export function renderWordmark(color = true, offset = 0): string {
  return WORDMARK.split('\n')
    .map((line) => gradientLine(line, color, ['#FFE9A8', '#FFD23F', '#F4A93C'], offset))
    .join('\n');
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

export function renderMascot(options: MascotOptions = {}): string {
  const state = options.state ?? 'idle';
  const color = options.color ?? true;
  const pct = state === 'idle' || state === 'blink' || state === 'sleeping' ? 100 : clampPct(options.pct ?? 100);
  const fill = Math.round((8 * pct) / 100);
  const shutter = `${rgb(COLORS.gold, '█'.repeat(fill), color)}${rgb(
    COLORS.shutterEmpty,
    '░'.repeat(8 - fill),
    color
  )}`;
  const face = FACES[state] ?? FACES.idle;
  const frameColor = state === 'error' ? COLORS.amber : COLORS.frame;
  const sparkles = state === 'done' ? sparklePair(options.sparkleFrame ?? 0, color) : ['  ', '  '];

  return [
    `${sparkles[0]}${rgb(frameColor, '╭────────────────╮', color)}`,
    `  ${rgb(frameColor, '│  ▐', color)}${shutter}${rgb(frameColor, '▌ ', color)}${rgb(
      COLORS.gold,
      '▣',
      color
    )}${rgb(frameColor, '  │', color)}`,
    `  ${rgb(frameColor, '│     ', color)}${rgb(COLORS.text, face.eyes, color)}${rgb(frameColor, '     │', color)}`,
    `  ${rgb(frameColor, '│       ', color)}${rgb(COLORS.gold, face.mouth, color)}${rgb(frameColor, '        │', color)}`,
    `${sparkles[1]}${rgb(frameColor, '╰────────────────╯', color)}`,
  ].join('\n');
}

function sparklePair(frame: number, color: boolean): [string, string] {
  const glyphs = ['✦ ', '✧ ', '⋆ ', '· '];
  return [
    rgb(COLORS.goldBright, glyphs[frame % glyphs.length], color),
    rgb(COLORS.goldBright, glyphs[(frame + 2) % glyphs.length], color),
  ];
}

export function renderInstallerSplash(options: {
  color?: boolean;
  mascotState?: MascotState;
  pct?: number;
  wordmarkOffset?: number;
  sparkleFrame?: number;
} = {}): string {
  const color = options.color ?? true;
  const mascot = renderMascot({
    pct: options.pct,
    state: options.mascotState ?? 'idle',
    color,
    sparkleFrame: options.sparkleFrame,
  });
  return [
    renderWordmark(color, options.wordmarkOffset ?? 0),
    '',
    centerBlock(mascot),
    '',
    centerLine(rgb(COLORS.gold, 'AutoMem', color)),
    centerLine(
      `${rgb(COLORS.text, "Your agents' memory. Everywhere.", color)} ${rgb(COLORS.goldBright, '✦', color)}`
    ),
    centerLine(rgb(COLORS.muted, 'guided local, hosted, and existing-endpoint setup', color)),
  ].join('\n');
}

export function shouldUseInstallerAnimation(options: AnimationOptions): boolean {
  if (!options.stdinIsTTY || !options.stdoutIsTTY) return false;
  if (options.env.CI || options.env.CODEX || options.env.CLAUDE_CODE) return false;
  const modeIndex = options.args.indexOf('--mode');
  if (modeIndex >= 0 && options.args[modeIndex + 1] === 'agent') return false;
  if (options.args.includes('--mode=agent')) return false;
  return true;
}

export async function playInstallerSplash(options: {
  enabled: boolean;
  output?: NodeJS.WriteStream;
  frameDelayMs?: number;
  frames?: number;
  color?: boolean;
}): Promise<void> {
  const output = options.output ?? process.stdout;
  const frames = options.frames ?? 5;
  const frameDelayMs = options.frameDelayMs ?? 120;
  const color = options.color ?? true;

  if (!options.enabled) return;

  let previousLineCount = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const isLast = frame === frames - 1;
    const mascotState: MascotState = !isLast && frame % 4 === 2 ? 'blink' : 'idle';
    const nextFrame = renderInstallerSplash({
      color,
      mascotState,
      wordmarkOffset: frame,
    });
    if (previousLineCount > 0) {
      output.write(`\x1b[${previousLineCount}A`);
      for (let line = 0; line < previousLineCount; line += 1) {
        output.write('\x1b[2K\r');
        if (line < previousLineCount - 1) output.write('\x1b[1B');
      }
      output.write(`\x1b[${previousLineCount - 1}A`);
    }
    output.write(`${nextFrame}\n`);
    previousLineCount = nextFrame.split('\n').length;
    if (!isLast) {
      await new Promise((resolve) => {
        setTimeout(resolve, frameDelayMs);
      });
    }
  }
}

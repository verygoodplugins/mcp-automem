// AutoMem CLI theme: color/symbol/width detection + a small style/symbol kit.
// Ported from the AutoVault setup UI and rebranded to the AutoMem gold palette.
// Everything degrades deterministically: no TTY → no color, no unicode; NO_COLOR
// and AUTOMEM_ASCII force the plain path so redirected output and CI stay clean.

export const GOLD = '#ffd23f';
export const GOLD_BRIGHT = '#ffe9a8';
export const AMBER = '#f4a93c';
export const GREEN = '#78c878';
export const WARN = '#e8a866';
export const BAD = '#d97171';
export const BLUE = '#5a9dd6';

export type ColorMode = 'auto' | 'always' | 'never';
export type SymbolMode = 'auto' | 'unicode' | 'ascii';

export type ThemeOptions = {
  color?: ColorMode;
  symbols?: SymbolMode;
  width?: number;
};

export type Theme = {
  color: boolean;
  unicode: boolean;
  width: number;
  style: {
    bold(text: string): string;
    dim(text: string): string;
    red(text: string): string;
    green(text: string): string;
    yellow(text: string): string;
    blue(text: string): string;
    magenta(text: string): string;
    gold(text: string): string;
    goldBright(text: string): string;
    inverseGold(text: string): string;
  };
  symbol: {
    check: string;
    cross: string;
    warn: string;
    info: string;
    bullet: string;
    arrow: string;
    line: string;
  };
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[38;2;217;113;113m',
  green: '\x1b[38;2;120;200;120m',
  yellow: '\x1b[38;2;232;168;102m',
  blue: '\x1b[38;2;90;157;214m',
  magenta: '\x1b[38;2;180;138;214m',
  gold: '\x1b[38;2;255;210;63m',
  goldBright: '\x1b[38;2;255;233;168m',
  goldBg: '\x1b[48;2;255;210;63m',
  black: '\x1b[30m',
};

export function streamWidth(stream: NodeJS.WriteStream = process.stdout): number {
  return Math.max(40, Math.min(stream.columns ?? 80, 120));
}

function shouldColor(stream: NodeJS.WriteStream, mode: ColorMode): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  if (process.env.NO_COLOR) return false;
  // In auto mode, no TTY → no color (deterministic, clean piped/CI output).
  // Callers that genuinely want color in a pipe pass color: 'always'.
  return stream.isTTY === true;
}

function shouldUseUnicode(stream: NodeJS.WriteStream, mode: SymbolMode): boolean {
  if (mode === 'unicode') return true;
  if (mode === 'ascii') return false;
  if (stream.isTTY !== true) return false;
  if (process.env.AUTOMEM_ASCII === '1') return false;
  if (process.env.TERM === 'dumb') return false;
  return process.platform !== 'win32' || Boolean(process.env.WT_SESSION);
}

function wrap(enabled: boolean, open: string): (text: string) => string {
  return (text) => (enabled && text.length > 0 ? `${open}${text}${ANSI.reset}` : text);
}

export function makeTheme(
  stream: NodeJS.WriteStream = process.stdout,
  options: ThemeOptions = {}
): Theme {
  const color = shouldColor(stream, options.color ?? 'auto');
  const unicode = shouldUseUnicode(stream, options.symbols ?? 'auto');
  return {
    color,
    unicode,
    width: options.width ?? streamWidth(stream),
    style: {
      bold: wrap(color, ANSI.bold),
      dim: wrap(color, ANSI.dim),
      red: wrap(color, ANSI.red),
      green: wrap(color, ANSI.green),
      yellow: wrap(color, ANSI.yellow),
      blue: wrap(color, ANSI.blue),
      magenta: wrap(color, ANSI.magenta),
      gold: wrap(color, ANSI.gold),
      goldBright: wrap(color, ANSI.goldBright),
      inverseGold: (text) =>
        color && text.length > 0
          ? `${ANSI.goldBg}${ANSI.black}${text}${ANSI.reset}`
          : `[${text.trim()}]`,
    },
    symbol: {
      check: unicode ? '✓' : '+',
      cross: unicode ? '✗' : 'x',
      warn: unicode ? '▲' : '!',
      info: unicode ? '●' : '*',
      bullet: unicode ? '•' : '-',
      arrow: unicode ? '→' : '->',
      line: unicode ? '─' : '-',
    },
  };
}

export function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

export function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

export function padEndVisible(value: string, target: number): string {
  const length = visibleLength(value);
  if (length >= target) return value;
  return `${value}${' '.repeat(target - length)}`;
}

export function repeatVisible(char: string, count: number): string {
  return Array.from({ length: Math.max(0, count) }, () => char).join('');
}

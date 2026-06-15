import { makeTheme, repeatVisible, type Theme } from './theme.js';

export type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  ok(message: string): void;
  raw(text: string): void;
};

export function badge(label: string, theme: Theme, tone: 'gold' | 'dim' | 'warn' = 'gold'): string {
  if (tone === 'warn') return theme.style.yellow(`[${label}]`);
  if (tone === 'dim') return theme.style.dim(`[${label}]`);
  return theme.style.inverseGold(` ${label} `);
}

export function sectionTitle(title: string, theme: Theme): string {
  const lineLength = Math.max(12, Math.min(theme.width - title.length - 4, 44));
  return `${theme.style.bold(title)} ${theme.style.dim(repeatVisible(theme.symbol.line, lineLength))}`;
}

export function makeLogger(stream: NodeJS.WriteStream = process.stdout): Logger {
  const theme = makeTheme(stream);
  return {
    info: (message) => stream.write(`${theme.style.dim(theme.symbol.arrow)} ${message}\n`),
    warn: (message) => stream.write(`${theme.style.yellow(theme.symbol.warn)} ${message}\n`),
    // Diagnostics go to stderr so human stdout and --json both stay clean.
    error: (message) => process.stderr.write(`${theme.style.red(theme.symbol.cross)} ${message}\n`),
    ok: (message) => stream.write(`${theme.style.gold(theme.symbol.check)} ${message}\n`),
    raw: (text) => stream.write(text),
  };
}

export function noteBox(
  title: string,
  lines: string[],
  stream: NodeJS.WriteStream = process.stdout
): string {
  const theme = makeTheme(stream);
  const width = Math.min(theme.width, 78);
  const rule = repeatVisible(theme.symbol.line, Math.max(12, width - 4));
  const body = lines.map((line) => `  ${line}`).join('\n');
  return `${theme.style.gold(rule)}\n${theme.style.bold(title)}\n${body}\n${theme.style.gold(rule)}\n`;
}

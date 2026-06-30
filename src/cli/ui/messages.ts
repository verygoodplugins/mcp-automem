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
  // Diagnostics go to stderr so human stdout and --json both stay clean. Style
  // them with a stderr-derived theme — its TTY/color capabilities can differ from
  // stdout (e.g. one is redirected), so reusing the stdout theme could leak ANSI
  // into a pipe or drop color unexpectedly.
  const errStream = process.stderr;
  const errTheme = errStream === stream ? theme : makeTheme(errStream);
  return {
    info: (message) => stream.write(`${theme.style.dim(theme.symbol.arrow)} ${message}\n`),
    warn: (message) => stream.write(`${theme.style.yellow(theme.symbol.warn)} ${message}\n`),
    error: (message) => errStream.write(`${errTheme.style.red(errTheme.symbol.cross)} ${message}\n`),
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

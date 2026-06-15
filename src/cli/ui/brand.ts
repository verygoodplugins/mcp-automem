import { badge } from './messages.js';
import { makeTheme, padEndVisible, repeatVisible, visibleLength, type Theme } from './theme.js';
import { centerBlock, centerLine, renderMascot, renderWordmark } from '../install-ui.js';

const TAGLINE = "your agents' memory, everywhere";

// A small "working" mascot shown when the apply phase begins. Color-only — on a
// plain/non-color stream it returns nothing so it never clutters piped output.
export function renderWorkingMascot(stream: NodeJS.WriteStream = process.stdout): string {
  const theme = makeTheme(stream);
  if (!theme.color) return '';
  return `\n${renderMascot({ state: 'working', color: theme.color, pct: 66 })}\n`;
}

// Static (non-animated) brand header for the review/plan surface. Wide terminals
// get the gradient wordmark + idle mascot; narrow ones collapse to a single
// badge line. The animated splash (playInstallerSplash) is separate and only
// fires on an interactive TTY.
export function renderBrandHeader(
  stream: NodeJS.WriteStream = process.stdout,
  options: { compact?: boolean } = {}
): string {
  const theme = makeTheme(stream);
  if (options.compact || theme.width < 60 || !theme.color) {
    return `${badge('automem', theme)} ${theme.style.bold('AutoMem')} ${theme.style.dim(TAGLINE)}\n`;
  }
  return [
    '',
    renderWordmark(theme.color),
    '',
    centerBlock(renderMascot({ state: 'idle', color: theme.color })),
    '',
    centerLine(`${theme.style.gold('AutoMem')}  ${theme.style.dim(TAGLINE)}`),
    '',
  ].join('\n');
}

export function renderSuccessOutro(
  title: string,
  lines: string[],
  stream: NodeJS.WriteStream = process.stdout
): string {
  const theme = makeTheme(stream);
  const rule = theme.style.gold(repeatVisible(theme.symbol.line, Math.min(theme.width, 68)));
  return [
    '',
    rule,
    `${theme.style.gold(theme.symbol.check)} ${theme.style.bold(title)}`,
    ...lines.map((line) => `  ${line}`),
    rule,
    '',
  ].join('\n');
}

// A rounded gold card for the finish: the "done" mascot, then a boxed summary of
// the endpoint + next steps. Falls back to the rule-based outro when the terminal
// can't do unicode/color (CI, pipes, dumb terminals) so those stay clean.
export function renderSuccessCard(
  title: string,
  lines: string[],
  stream: NodeJS.WriteStream = process.stdout
): string {
  const theme = makeTheme(stream);
  if (!theme.unicode || !theme.color) {
    return renderSuccessOutro(title, lines, stream);
  }

  const content = [
    `${theme.style.gold(theme.symbol.check)} ${theme.style.bold(title)}`,
    ...lines.map((line) => theme.style.dim(line)),
  ];
  const innerWidth = Math.min(
    theme.width - 4,
    Math.max(24, ...content.map((line) => visibleLength(line)))
  );
  const top = theme.style.gold(`╭${repeatVisible('─', innerWidth + 2)}╮`);
  const bottom = theme.style.gold(`╰${repeatVisible('─', innerWidth + 2)}╯`);
  const rows = content.map(
    (line) => `${theme.style.gold('│')} ${padEndVisible(line, innerWidth)} ${theme.style.gold('│')}`
  );
  return [
    '',
    renderMascot({ state: 'done', color: theme.color, sparkleFrame: 0 }),
    '',
    top,
    ...rows,
    bottom,
    '',
  ].join('\n');
}

export type { Theme };

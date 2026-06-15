import { badge } from './messages.js';
import { makeTheme, repeatVisible, type Theme } from './theme.js';
import { renderMascot, renderWordmark } from '../install-ui.js';

const TAGLINE = "your agents' memory, everywhere";

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
    renderMascot({ state: 'idle', color: theme.color }),
    '',
    `  ${theme.style.gold('AutoMem')}  ${theme.style.dim(TAGLINE)}`,
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

export type { Theme };

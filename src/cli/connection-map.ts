import type { AgentClient } from './clients.js';
import { makeTheme, type Theme } from './ui/theme.js';

const NAMES: Record<AgentClient, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  grok: 'Grok Build',
};

/**
 * A picture of how the pieces connect, drawn from what this run actually set
 * up: connected tools → AutoMem → where the memories live, with the phone link
 * only when it exists. Plain text, so it survives pipes and CI logs.
 */
export function renderConnectionMap(params: {
  clients: AgentClient[];
  endpoint: string;
  local: boolean;
  theme?: Theme;
}): string {
  const theme = params.theme ?? makeTheme(process.stdout);
  const [down, bar, join, dash] = theme.unicode ? ['▼', '│', ' · ', '—'] : ['v', '|', ', ', '-'];
  const tools = params.clients.length
    ? params.clients.map((c) => NAMES[c]).join(join)
    : 'no AI tool yet';
  const where = params.local ? 'in Docker on this computer' : 'on your host';
  const store = `FalkorDB (how things relate) + Qdrant (what is similar) ${dash} ${where}`;
  const pad = '  ';
  const lines = [
    theme.style.bold('How it all connects'),
    '',
    `${pad}${tools}`,
    `${pad}  ${theme.style.dim(`${bar} MCP`)}`,
    `${pad}  ${down}`,
    `${pad}AutoMem  ${theme.style.dim(params.endpoint)}`,
    `${pad}  ${theme.style.dim(bar)}`,
    `${pad}  ${down}`,
    `${pad}${store}`,
  ];
  return lines.join('\n');
}

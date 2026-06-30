import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AGENT_CLIENTS, type AgentClient } from '../../src/cli/install.js';

/**
 * Documentation drift guard.
 *
 * "Which integrations we support" has a single source of truth in code:
 * `AGENT_CLIENTS` in src/cli/install.ts — the agents the guided installer
 * configures. The README historically hand-maintained several separate
 * integration lists that drifted out of sync (e.g. Hermes and OpenClaw were
 * shipped and installer-supported, but missing from the compatibility table).
 *
 * This test fails CI when an installer-supported client is not reflected in
 * the README compatibility table or the INSTALLATION guide, so adding an
 * integration without documenting it can no longer be merged.
 *
 * Scope is deliberately the deterministic, code-derived `AGENT_CLIENTS` set
 * and the structured compatibility table. The looser headline prose — which
 * also markets non-installer platforms like ChatGPT and ElevenLabs — is not
 * gated here; folding every surface into one generated block is the planned
 * source-of-truth follow-up.
 */

const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

// The display name each installer client is documented under. Typing this as
// Record<AgentClient, string> forces every new AGENT_CLIENTS entry to declare a
// docs name here (compile error otherwise), which in turn makes the assertions
// below require the new integration to be documented before it can ship.
const DISPLAY_NAMES: Record<AgentClient, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
};

/** Extract a markdown section: its heading line through (excluding) the next heading. */
function section(markdown: string, headingContains: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (line) => /^#{2,4}\s/.test(line) && line.includes(headingContains),
  );
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,4}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('integration docs coverage', () => {
  const readme = repoFile('README.md');
  const installation = repoFile('INSTALLATION.md');
  const compatibilityTable = section(readme, 'Works Everywhere You Code');

  it('locates the README compatibility table', () => {
    // Guards against a heading rename silently disabling the row checks below.
    expect(
      compatibilityTable,
      'Could not find the README "Works Everywhere You Code" compatibility table',
    ).not.toBe('');
  });

  it.each(AGENT_CLIENTS)(
    'lists installer client "%s" in the README compatibility table',
    (client) => {
      const name = DISPLAY_NAMES[client];
      expect(
        compatibilityTable.includes(name),
        `README compatibility table is missing "${name}" (AGENT_CLIENTS includes '${client}'). ` +
          'Add a row for it in README.md.',
      ).toBe(true);
    },
  );

  it.each(AGENT_CLIENTS)(
    'documents installer client "%s" in INSTALLATION.md',
    (client) => {
      const name = DISPLAY_NAMES[client];
      expect(
        installation.includes(name),
        `INSTALLATION.md does not mention "${name}" (AGENT_CLIENTS includes '${client}').`,
      ).toBe(true);
    },
  );
});

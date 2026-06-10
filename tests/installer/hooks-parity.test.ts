/**
 * Parity guard between templates/claude-code/settings.json and
 * plugins/automem/hooks/hooks.json.
 *
 * Two invariants:
 * 1. Neither shipped hook config references the retired session-memory.sh —
 *    it was removed from the default Stop matcher because its per-session
 *    rollups are low-signal noise, and the installer now actively strips it
 *    from existing installs (RETIRED_HOOK_KEYS).
 * 2. Every shipped hook command yields a managed dedup key. Anything that
 *    escapes the managed-key net also escapes installer dedup, migration,
 *    and uninstall — a rename that breaks the key surfaces here instead of
 *    as a double-firing hook on user machines.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { hookDedupKeys } from '../../src/cli/claude-code.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

const CONFIGS = [
  ['templates/claude-code/settings.json', 'templates settings.json'],
  ['plugins/automem/hooks/hooks.json', 'plugin hooks.json'],
] as const;

type HookEntry = { command: string };
type HookGroup = { matcher?: string; hooks?: HookEntry[] };
type HookConfig = { hooks?: Record<string, HookGroup[]> };

function shippedCommands(configPath: string): string[] {
  const config = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, configPath), 'utf8')
  ) as HookConfig;
  const commands: string[] = [];
  for (const groups of Object.values(config.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        commands.push(hook.command);
      }
    }
  }
  return commands;
}

describe.each(CONFIGS)('%s', (configPath) => {
  const commands = shippedCommands(configPath);

  it('does not reference the retired session-memory.sh', () => {
    expect(commands.join('\n')).not.toContain('session-memory.sh');
  });

  it.each(commands)('command yields a managed dedup key: %s', (command) => {
    const keys = hookDedupKeys({ command });
    expect(keys.some((key) => key.startsWith('managed:'))).toBe(true);
  });
});

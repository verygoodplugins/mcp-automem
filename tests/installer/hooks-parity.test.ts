/**
 * Parity guard between templates/claude-code/settings.json and
 * plugins/automem/hooks/hooks.json.
 *
 * Two invariants:
 * 1. Neither shipped hook config references retired machinery — the
 *    session-memory.sh Stop hook (#130) or the queue pipeline
 *    (queue-cleanup.sh + the npx queue drainer, retired when the capture
 *    hooks that fed the queue were removed). The installer actively strips
 *    all of these from existing installs (RETIRED_HOOK_KEYS).
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

  it('does not reference the retired queue machinery', () => {
    const joined = commands.join('\n');
    expect(joined).not.toContain('queue-cleanup.sh');
    expect(joined).not.toMatch(/mcp-automem\s+queue/);
  });

  it.each(commands)('command yields a managed dedup key: %s', (command) => {
    const keys = hookDedupKeys({ command });
    expect(keys.some((key) => key.startsWith('managed:'))).toBe(true);
  });
});

describe('plugin hook commands', () => {
  // Shell-form commands quote ${CLAUDE_PLUGIN_ROOT} per the plugin docs so
  // cache paths with spaces survive; strip quotes before path inspection.
  const commands = shippedCommands('plugins/automem/hooks/hooks.json').map((command) =>
    command.replace(/"/g, '')
  );

  it.each(commands.filter((command) => command.startsWith('${CLAUDE_PLUGIN_ROOT}/')))(
    'direct plugin command points at an executable packaged script: %s',
    (command) => {
      const relativeScript = command.replace('${CLAUDE_PLUGIN_ROOT}/', 'plugins/automem/');
      const mode = fs.statSync(path.join(REPO_ROOT, relativeScript)).mode;
      expect(mode & 0o111, `${relativeScript} is invoked directly and must be executable`).not.toBe(0);
    }
  );

  it('every plugin hook command is exercised by the exec-bit check above', () => {
    // If a future command stops matching the ${CLAUDE_PLUGIN_ROOT}/ prefix
    // (e.g. a wrapper form), the filter would silently skip it.
    expect(
      commands.every((command) => command.startsWith('${CLAUDE_PLUGIN_ROOT}/'))
    ).toBe(true);
  });
});

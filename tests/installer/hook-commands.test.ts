/**
 * Regression guard for #108 — hook commands shipped in our templates must
 * survive the platform's native command-line execution model. Claude Code
 * launches hooks via Node's child_process (`/bin/sh -c` on POSIX,
 * `cmd.exe /d /s /c` on Windows). On Windows there is no shell to parse the
 * `VAR=value command` prefix, so any command using that syntax must wrap the
 * whole thing in `bash -c '…'` to re-introduce a real shell.
 *
 * The mechanical capture hooks (the only env-prefixed commands we ever
 * shipped) were retired in favor of the LLM-judged automem-stop-nudge.sh, so
 * the shipped configs must now carry NO env-prefixed commands at all. The
 * wrap guard stays so any future env-prefixed command must come through it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SETTINGS_PATH = path.join(REPO_ROOT, 'templates/claude-code/settings.json');
const PLUGIN_HOOKS_PATH = path.join(REPO_ROOT, 'plugins/automem/hooks/hooks.json');

interface HookEntry {
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}
interface HookConfig {
  hooks: Record<string, HookGroup[]>;
}

function extractCommands(config: HookConfig): string[] {
  const all: string[] = [];
  for (const section of Object.values(config.hooks ?? {})) {
    for (const group of section ?? []) {
      for (const entry of group.hooks ?? []) {
        all.push(entry.command);
      }
    }
  }
  return all;
}

describe('shipped hook commands run via the platform exec model (#108)', () => {
  const templateSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as HookConfig;
  const pluginHooks = JSON.parse(fs.readFileSync(PLUGIN_HOOKS_PATH, 'utf8')) as HookConfig;
  const allCommands = [...extractCommands(templateSettings), ...extractCommands(pluginHooks)];

  it('ships no retired CLAUDE_HOOK_TYPE capture commands', () => {
    // Mechanical build/test/deploy capture is retired; the installer strips
    // these from existing installs via RETIRED_HOOK_KEYS.
    expect(allCommands.filter((c) => /CLAUDE_HOOK_TYPE=/.test(c))).toHaveLength(0);
    expect(allCommands.join('\n')).not.toMatch(/capture-(build-result|test-pattern|deployment)/);
  });

  it('wraps any env-prefixed command in `bash -c` (#108 guard for future additions)', () => {
    for (const cmd of allCommands) {
      if (/^[A-Z_]+=\S/.test(cmd)) {
        expect(cmd, `unwrapped env-prefix breaks Windows exec: ${cmd}`).toMatch(/^bash -c '/);
      }
    }
  });
});

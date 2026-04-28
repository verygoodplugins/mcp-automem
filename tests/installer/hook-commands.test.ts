/**
 * Regression guard for #108 — hook commands shipped in our templates must
 * survive the platform's native command-line execution model. Claude Code
 * launches hooks via Node's child_process (`/bin/sh -c` on POSIX,
 * `cmd.exe /d /s /c` on Windows). On Windows there is no shell to parse the
 * `VAR=value command` prefix, so any command using that syntax must wrap the
 * whole thing in `bash -c '…'` to re-introduce a real shell.
 *
 * This test extracts every command from settings.json / hooks.json that
 * carries an env-var prefix, stages a stub for the script it references, and
 * runs it via execSync. On POSIX it always passes; on `windows-latest` CI it
 * fails loudly if the wrapper regresses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SETTINGS_PATH = path.join(REPO_ROOT, 'templates/claude-code/settings.json');
const PLUGIN_HOOKS_PATH = path.join(REPO_ROOT, 'plugins/automem/hooks/hooks.json');

const STUB_SCRIPT_NAMES = [
  'capture-build-result.sh',
  'capture-test-pattern.sh',
  'capture-deployment.sh',
  'session-memory.sh',
];

interface HookEntry {
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}
interface HookConfig {
  hooks: {
    PostToolUse?: HookGroup[];
    Stop?: HookGroup[];
    SessionStart?: HookGroup[];
  };
}

function extractEnvPrefixedCommands(config: HookConfig): string[] {
  const all: string[] = [];
  for (const section of [config.hooks.PostToolUse, config.hooks.Stop, config.hooks.SessionStart]) {
    for (const group of section ?? []) {
      for (const entry of group.hooks ?? []) {
        all.push(entry.command);
      }
    }
  }
  return all.filter((c) => /CLAUDE_HOOK_TYPE=/.test(c));
}

describe('shipped hook commands run via the platform exec model (#108)', () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-automem-hookcmd-'));
    // Templates reference $HOME/.claude/hooks/*.sh; plugin references
    // ${CLAUDE_PLUGIN_ROOT}/scripts/*.sh which we map to tmpHome/.claude/scripts.
    const hooksDir = path.join(tmpHome, '.claude', 'hooks');
    const scriptsDir = path.join(tmpHome, '.claude', 'scripts');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });

    const stub =
      '#!/usr/bin/env bash\necho "${0##*/} CLAUDE_HOOK_TYPE=${CLAUDE_HOOK_TYPE:-MISSING}"\nexit 0\n';
    for (const name of STUB_SCRIPT_NAMES) {
      for (const dir of [hooksDir, scriptsDir]) {
        const p = path.join(dir, name);
        fs.writeFileSync(p, stub);
        fs.chmodSync(p, 0o755);
      }
    }

    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const templateSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as HookConfig;
  const pluginHooks = JSON.parse(fs.readFileSync(PLUGIN_HOOKS_PATH, 'utf8')) as HookConfig;

  const templateCmds = extractEnvPrefixedCommands(templateSettings);
  const pluginCmds = extractEnvPrefixedCommands(pluginHooks);

  it('finds the four template hook commands that carry CLAUDE_HOOK_TYPE', () => {
    expect(templateCmds).toHaveLength(4);
  });

  it('finds the plugin hook command that carries CLAUDE_HOOK_TYPE', () => {
    expect(pluginCmds).toHaveLength(1);
  });

  // Cross-platform structural guard: on POSIX, execSync uses /bin/sh which
  // happily parses the `VAR=value command` prefix, so a regression that drops
  // the bash wrapper would still pass the exec tests above on Linux/macOS.
  // This assertion fails on every platform if anyone removes the wrap.
  it.each([...templateCmds, ...pluginCmds])(
    'env-prefixed command is wrapped in `bash -c` (#108): %s',
    (cmd) => {
      expect(cmd).toMatch(/^bash -c '/);
    }
  );

  it.each(templateCmds)('template command executes cleanly: %s', (cmd) => {
    const out = execSync(cmd, { encoding: 'utf8', env: process.env });
    expect(out).toMatch(/CLAUDE_HOOK_TYPE=(build|test_run|deploy|session_end)/);
    expect(out).not.toMatch(/MISSING/);
  });

  it.each(pluginCmds)('plugin command executes cleanly: %s', (cmd) => {
    // Plugin hooks reference scripts via ${CLAUDE_PLUGIN_ROOT}; in the runtime
    // Claude Code provides this. Here we resolve it to the same hooks dir we
    // staged in beforeAll, since the stub script names match.
    const resolved = cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, path.join(tmpHome, '.claude'));
    const out = execSync(resolved, { encoding: 'utf8', env: process.env });
    expect(out).toMatch(/CLAUDE_HOOK_TYPE=session_end/);
    expect(out).not.toMatch(/MISSING/);
  });
});

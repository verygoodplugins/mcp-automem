/**
 * Installer permission hygiene (src/cli/claude-code.ts).
 *
 * The settings template historically shipped a personal-dev-environment
 * snapshot: Edit/Write, 19 Bash(*) grants, deny/ask blocks, and an env
 * setting. Only the six mcp__memory__* permissions were ever documented as
 * AutoMem-owned, and the pure-bash hooks run outside the permission system —
 * they need no Bash grants at all.
 *
 * The template is now minimal, and re-running the installer strips exactly
 * the four hook-era grants that existed solely for the retired Python/jq
 * hook machinery (#102). Generic dev grants (Bash(git:*), Edit, ...) cannot
 * be attributed to AutoMem vs the user, so they are user-owned: never
 * touched.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyClaudeCodePluginPermissions,
  applyClaudeCodeSetup,
  CLAUDE_CODE_MCP_PERMISSIONS,
  CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS,
  CLAUDE_CODE_PLUGIN_TOOL_PREFIX,
} from '../../src/cli/claude-code.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

const MCP_PERMISSIONS = [
  'mcp__memory__store_memory',
  'mcp__memory__recall_memory',
  'mcp__memory__associate_memories',
  'mcp__memory__update_memory',
  'mcp__memory__delete_memory',
  'mcp__memory__check_database_health',
];

// Pinned independently of the implementation's constant: the contract for
// which permission grants a re-run may remove from a user's settings.
const RETIRED_PERMISSIONS = ['Bash(python3:*)', 'Bash(python:*)', 'Bash(py:*)', 'Bash(jq:*)'];

interface SettingsShape {
  env?: Record<string, string>;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
  hooks?: Record<string, unknown[]>;
}

describe('installer permission hygiene', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-settings-perms-'));
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  const settingsPath = () => path.join(targetDir, 'settings.json');
  const readSettings = (): SettingsShape =>
    JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as SettingsShape;

  it('fresh install grants exactly the six MCP permissions and nothing else', async () => {
    await applyClaudeCodeSetup({ targetDir, quiet: true });

    const settings = readSettings();
    expect([...(settings.permissions?.allow ?? [])].sort()).toEqual([...MCP_PERMISSIONS].sort());
    // No opinionated extras: no env setting, no deny/ask blocks.
    expect(settings.env).toBeUndefined();
    expect(settings.permissions?.deny).toBeUndefined();
    expect(settings.permissions?.ask).toBeUndefined();
    // Default profile is silent at session end: no Stop hook registration.
    expect(Object.keys(settings.hooks ?? {}).sort()).toEqual(['PostToolUse', 'SessionStart']);
  });

  it('nudged profile opts back into the Stop storage nudge', async () => {
    await applyClaudeCodeSetup({ targetDir, quiet: true, profile: 'nudged' });

    const settings = readSettings();
    expect(Object.keys(settings.hooks ?? {}).sort()).toEqual([
      'PostToolUse',
      'SessionStart',
      'Stop',
    ]);
  });

  it('re-run strips exactly the four hook-era grants and preserves user-owned config', async () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify(
        {
          env: { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: 'true' },
          permissions: {
            allow: [...RETIRED_PERMISSIONS, 'Bash(git:*)', 'Edit', 'mcp__other__tool'],
            deny: ['Bash(sudo:*)'],
            ask: ['Bash(git push:*)'],
          },
        },
        null,
        2
      )
    );

    const messages: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      messages.push(args.join(' '));
    });
    try {
      await applyClaudeCodeSetup({ targetDir });
    } finally {
      logSpy.mockRestore();
    }

    const settings = readSettings();
    const allow = settings.permissions?.allow ?? [];
    for (const retired of RETIRED_PERMISSIONS) {
      expect(allow, `${retired} should be stripped`).not.toContain(retired);
    }
    // User-owned grants and blocks survive untouched.
    expect(allow).toContain('Bash(git:*)');
    expect(allow).toContain('Edit');
    expect(allow).toContain('mcp__other__tool');
    for (const perm of MCP_PERMISSIONS) {
      expect(allow).toContain(perm);
    }
    expect(settings.permissions?.deny).toEqual(['Bash(sudo:*)']);
    expect(settings.permissions?.ask).toEqual(['Bash(git push:*)']);
    expect(settings.env).toEqual({ CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: 'true' });

    expect(messages.join('\n')).toContain('migrated: removed retired hook-era permissions');
  });

  it('does not log a permission migration when nothing retired was present', async () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ permissions: { allow: ['Bash(git:*)'] } }, null, 2)
    );

    const messages: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      messages.push(args.join(' '));
    });
    try {
      await applyClaudeCodeSetup({ targetDir });
    } finally {
      logSpy.mockRestore();
    }

    expect(messages.join('\n')).not.toContain('retired hook-era permissions');
  });

  it('dry-run leaves the settings file byte-identical', async () => {
    const seeded = JSON.stringify(
      { permissions: { allow: [...RETIRED_PERMISSIONS, 'Bash(git:*)'] } },
      null,
      2
    );
    fs.writeFileSync(settingsPath(), seeded);

    await applyClaudeCodeSetup({ targetDir, dryRun: true, quiet: true });

    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(seeded);
  });
});

// Plugin mode (`claude plugin install`) ships the MCP server under the plugin
// namespace, so nothing pre-approves its tools unless the installer writes
// allow rules. Only the allow block is written: the plugin bundles its own
// hooks, so the settings-mode hooks must never land here (the SessionStart
// prompt would fire twice).
describe('Claude Code plugin tool pre-approval', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-plugin-perms-'));
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  const settingsPath = () => path.join(targetDir, 'settings.json');
  const readSettings = (): SettingsShape =>
    JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as SettingsShape;
  const backups = () => fs.readdirSync(targetDir).filter((name) => name.includes('.bak'));

  it('plugin permissions: two runs add the five rules once and keep user content', () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify(
        {
          permissions: { allow: ['Bash(git:*)'], deny: ['Read(./.env)'] },
          hooks: {
            Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash /opt/user.sh' }] }],
          },
        },
        null,
        2
      )
    );

    const first = applyClaudeCodePluginPermissions({ targetDir, quiet: true });
    const afterFirst = fs.readFileSync(settingsPath(), 'utf8');
    const second = applyClaudeCodePluginPermissions({ targetDir, quiet: true });

    const settings = readSettings();
    expect(settings.permissions?.allow).toEqual([
      'Bash(git:*)',
      ...CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS,
    ]);
    expect(settings.permissions?.deny).toEqual(['Read(./.env)']);
    expect(settings.hooks?.Stop).toHaveLength(1);
    expect(settings.hooks?.SessionStart).toBeUndefined();
    expect(first).toEqual({ settingsPath: settingsPath(), changed: true });
    expect(second).toEqual({ settingsPath: settingsPath(), changed: false });
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(afterFirst);
    expect(backups()).toHaveLength(1);
  });

  it('plugin permissions only add: retired grants and every other key survive', () => {
    // Plugin mode never granted the hook-era Bash rules, so they may be the
    // user's own: the plugin path must add its five rules and remove nothing.
    const seeded = {
      permissions: {
        allow: ['Bash(jq:*)', 'Bash(python3:*)', 'Bash(git:*)'],
        deny: ['Read(./.env)'],
      },
      someUnknownKey: { nested: [1, 'two'], flag: true },
    };
    fs.writeFileSync(settingsPath(), JSON.stringify(seeded, null, 2));

    const result = applyClaudeCodePluginPermissions({ targetDir, quiet: true });

    const settings = readSettings() as SettingsShape & { someUnknownKey?: unknown };
    expect(result.changed).toBe(true);
    expect(settings.permissions?.allow).toEqual([
      'Bash(jq:*)',
      'Bash(python3:*)',
      'Bash(git:*)',
      ...CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS,
    ]);
    expect(settings.permissions?.deny).toEqual(seeded.permissions.deny);
    expect(settings.someUnknownKey).toEqual(seeded.someUnknownKey);
    expect(Object.keys(settings).sort()).toEqual(['permissions', 'someUnknownKey']);
    expect(Object.keys(settings.permissions ?? {}).sort()).toEqual(['allow', 'deny']);
  });

  it('plugin permissions on a fresh home write only the allow block', () => {
    const result = applyClaudeCodePluginPermissions({ targetDir, quiet: true });

    expect(result.changed).toBe(true);
    expect(readSettings()).toEqual({
      permissions: { allow: [...CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS] },
    });
    expect(fs.existsSync(path.join(targetDir, 'hooks'))).toBe(false);
    expect(backups()).toEqual([]);
  });

  it('plugin permissions leave an already-approved file alone even when formatted differently', () => {
    // `claude plugin install` rewrites settings.json in its own formatting right
    // after the installer runs; a re-run must not churn the file or add a backup.
    const seeded = JSON.stringify(
      {
        enabledPlugins: { 'automem@x': true },
        permissions: { allow: [...CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS] },
      },
      null,
      4
    );
    fs.writeFileSync(settingsPath(), seeded);

    const result = applyClaudeCodePluginPermissions({ targetDir, quiet: true });

    expect(result.changed).toBe(false);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(seeded);
    expect(backups()).toEqual([]);
  });

  it('plugin permissions dry-run leaves settings.json byte-identical', () => {
    const seeded = JSON.stringify({ permissions: { allow: ['Bash(git:*)'] } }, null, 2);
    fs.writeFileSync(settingsPath(), seeded);

    const result = applyClaudeCodePluginPermissions({ targetDir, dryRun: true, quiet: true });

    expect(result).toEqual({ settingsPath: settingsPath(), changed: false });
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(seeded);
    expect(backups()).toEqual([]);
  });

  it('plugin permissions dry-run on a fresh home creates nothing', () => {
    const freshDir = path.join(targetDir, 'missing', '.claude');

    const result = applyClaudeCodePluginPermissions({
      targetDir: freshDir,
      dryRun: true,
      quiet: true,
    });

    expect(result.changed).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(false);
  });

  it('plugin permissions refuse to overwrite invalid JSON', () => {
    fs.writeFileSync(settingsPath(), '{ not json');

    expect(() => applyClaudeCodePluginPermissions({ targetDir, quiet: true })).toThrow();
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ not json');
    expect(backups()).toEqual([]);
  });

  it('plugin permissions keep file contents out of the parse error', () => {
    // settings.json env blocks often hold tokens; a V8 parse error can quote
    // the surrounding text, so the thrown message must name only the path.
    fs.writeFileSync(settingsPath(), '{ "env": { "TOKEN": "sk-secret-value" }, oops }');

    let thrown: unknown;
    try {
      applyClaudeCodePluginPermissions({ targetDir, quiet: true });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(settingsPath());
    expect((thrown as Error).message).not.toContain('sk-secret-value');
  });

  it('permission constants match the shipped plugin and template', () => {
    const template = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'templates/claude-code/settings.json'), 'utf8')
    ) as SettingsShape;
    const pluginJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'plugins/automem/.claude-plugin/plugin.json'), 'utf8')
    ) as { name: string };
    const mcpJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'plugins/automem/.mcp.json'), 'utf8')
    ) as { mcpServers: Record<string, unknown> };
    const skillMd = fs.readFileSync(
      path.join(REPO_ROOT, 'plugins/automem/skills/memory-management/SKILL.md'),
      'utf8'
    );

    expect(template.permissions?.allow).toEqual([...CLAUDE_CODE_MCP_PERMISSIONS]);
    expect(CLAUDE_CODE_PLUGIN_TOOL_PREFIX).toBe(
      `mcp__plugin_${pluginJson.name}_${Object.keys(mcpJson.mcpServers)[0]}__`
    );
    expect(CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS).toHaveLength(5);
    expect(CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS).not.toContain(
      'mcp__plugin_automem_memory__delete_memory'
    );
    for (const rule of CLAUDE_CODE_PLUGIN_MCP_PERMISSIONS) {
      expect(rule.startsWith(CLAUDE_CODE_PLUGIN_TOOL_PREFIX)).toBe(true);
      expect(skillMd).toContain(rule);
    }
  });
});

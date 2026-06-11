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
import { applyClaudeCodeSetup } from '../../src/cli/claude-code.js';

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
const RETIRED_PERMISSIONS = [
  'Bash(python3:*)',
  'Bash(python:*)',
  'Bash(py:*)',
  'Bash(jq:*)',
];

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
    expect([...(settings.permissions?.allow ?? [])].sort()).toEqual(
      [...MCP_PERMISSIONS].sort()
    );
    // No opinionated extras: no env setting, no deny/ask blocks.
    expect(settings.env).toBeUndefined();
    expect(settings.permissions?.deny).toBeUndefined();
    expect(settings.permissions?.ask).toBeUndefined();
    // The three hooks still register.
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
            allow: [
              ...RETIRED_PERMISSIONS,
              'Bash(git:*)',
              'Edit',
              'mcp__other__tool',
            ],
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

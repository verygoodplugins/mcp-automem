/**
 * Installer retired-file cleanup (src/cli/claude-code.ts).
 *
 * Earlier migrations (#130, the capture-hook retirement) stripped settings
 * entries but left the now-orphaned script files sitting inert in
 * ~/.claude/hooks and ~/.claude/scripts. The installer now deletes retired
 * files on re-run — they are installer-owned (overwritten on every install),
 * so removing them is the same ownership claim installing them was.
 *
 * smart-notify.sh is deliberately NOT retired: it was never stripped from
 * user settings, so a user-registered copy must keep working untouched.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyClaudeCodeSetup } from '../../src/cli/claude-code.js';

// Pinned independently of the implementation's constant: this is the
// contract for which files a re-run may delete from a user's ~/.claude.
const RETIRED = [
  'hooks/capture-build-result.sh',
  'hooks/capture-test-pattern.sh',
  'hooks/capture-deployment.sh',
  'hooks/session-memory.sh',
  'scripts/queue-cleanup.sh',
  'scripts/process-session-memory.py',
  'scripts/python-command.sh',
  'scripts/memory-filters.json',
];

describe('installer retired-file cleanup', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-retired-files-'));
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  function seedRetiredFiles(): void {
    for (const rel of RETIRED) {
      const abs = path.join(targetDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, '# legacy artifact\n');
    }
    // A foreign user file sharing the hooks dir must never be touched.
    fs.writeFileSync(path.join(targetDir, 'hooks', 'awtrix-event.js'), '// user file\n');
    // smart-notify.sh is user-owned now; the installer must leave it alone.
    fs.writeFileSync(path.join(targetDir, 'scripts', 'smart-notify.sh'), '#!/bin/bash\n');
  }

  it('removes retired files on install, logs each, and keeps foreign files', async () => {
    seedRetiredFiles();
    const messages: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      messages.push(args.join(' '));
    });
    try {
      await applyClaudeCodeSetup({ targetDir });
    } finally {
      logSpy.mockRestore();
    }

    for (const rel of RETIRED) {
      expect(fs.existsSync(path.join(targetDir, rel)), `${rel} should be deleted`).toBe(false);
    }
    expect(fs.existsSync(path.join(targetDir, 'hooks', 'awtrix-event.js'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'scripts', 'smart-notify.sh'))).toBe(true);

    // The replacement architecture is installed alongside the cleanup.
    expect(fs.existsSync(path.join(targetDir, 'hooks', 'automem-session-start.sh'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'hooks', 'automem-stop-nudge.sh'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'hooks', 'automem-track-store.sh'))).toBe(true);

    const joined = messages.join('\n');
    expect(joined).toContain('session-memory.sh');
    expect(joined).toContain('queue-cleanup.sh');
  });

  it('reports but does not delete retired files under --dry-run', async () => {
    seedRetiredFiles();
    await applyClaudeCodeSetup({ targetDir, dryRun: true, quiet: true });
    for (const rel of RETIRED) {
      expect(fs.existsSync(path.join(targetDir, rel)), `${rel} should survive dry-run`).toBe(true);
    }
  });

  it('installs no legacy scripts and registers only the nudge on Stop for a fresh dir', async () => {
    await applyClaudeCodeSetup({ targetDir, quiet: true });

    expect(fs.existsSync(path.join(targetDir, 'hooks', 'session-memory.sh'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'scripts', 'queue-cleanup.sh'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'scripts', 'python-command.sh'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'scripts', 'process-session-memory.py'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'scripts', 'memory-filters.json'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'scripts', 'smart-notify.sh'))).toBe(false);

    const settings = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8')
    ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const stopCommands = settings.hooks.Stop.flatMap((entry) =>
      entry.hooks.map((h) => h.command)
    );
    expect(stopCommands).toEqual(['bash "$HOME/.claude/hooks/automem-stop-nudge.sh"']);
  });
});

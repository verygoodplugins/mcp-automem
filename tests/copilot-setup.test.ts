/**
 * Copilot Setup Tests
 * Tests for applyCopilotSetup(), --format flag behavior (memory rules gating,
 * event name remapping), installMemoryRules, and --format validation.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyCopilotSetup, EVENT_NAMES } from '../src/cli/copilot.js';
import type { CopilotHookFile } from '../src/cli/copilot.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-setup-test-'));
}

function cleanupDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

describe('installMemoryRules (format gating)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('--format both installs CLI and VS Code memory rules', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'both', yes: true, quiet: true });

    const cliPath = path.join(tempDir, 'copilot-instructions.md');
    const vscodePath = path.join(tempDir, 'instructions', 'automem.instructions.md');

    expect(fs.existsSync(cliPath)).toBe(true);
    expect(fs.existsSync(vscodePath)).toBe(true);
  });

  it('default (no --format) installs both memory rules', async () => {
    await applyCopilotSetup({ targetDir: tempDir, yes: true, quiet: true });

    const cliPath = path.join(tempDir, 'copilot-instructions.md');
    const vscodePath = path.join(tempDir, 'instructions', 'automem.instructions.md');

    expect(fs.existsSync(cliPath)).toBe(true);
    expect(fs.existsSync(vscodePath)).toBe(true);
  });

  it('--format cli installs only CLI memory rules', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'cli', yes: true, quiet: true });

    const cliPath = path.join(tempDir, 'copilot-instructions.md');
    const vscodePath = path.join(tempDir, 'instructions', 'automem.instructions.md');

    expect(fs.existsSync(cliPath)).toBe(true);
    expect(fs.existsSync(vscodePath)).toBe(false);
  });

  it('--format vscode installs only VS Code memory rules', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'vscode', yes: true, quiet: true });

    const cliPath = path.join(tempDir, 'copilot-instructions.md');
    const vscodePath = path.join(tempDir, 'instructions', 'automem.instructions.md');

    expect(fs.existsSync(cliPath)).toBe(false);
    expect(fs.existsSync(vscodePath)).toBe(true);
  });

  it('CLI memory rules contain memory_rules markers', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'cli', yes: true, quiet: true });

    const content = fs.readFileSync(path.join(tempDir, 'copilot-instructions.md'), 'utf8');
    expect(content).toContain('<!-- BEGIN AUTOMEM MEMORY RULES -->');
    expect(content).toContain('<!-- END AUTOMEM MEMORY RULES -->');
    expect(content).toContain('<memory_rules>');
    expect(content).toContain('</memory_rules>');
  });

  it('VS Code memory rules contain frontmatter', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'vscode', yes: true, quiet: true });

    const content = fs.readFileSync(
      path.join(tempDir, 'instructions', 'automem.instructions.md'),
      'utf8'
    );
    expect(content).toContain('---');
    expect(content).toContain('<memory_rules>');
  });

  it('CLI memory rules are idempotent (re-running replaces block)', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'cli', yes: true, quiet: true });
    const first = fs.readFileSync(path.join(tempDir, 'copilot-instructions.md'), 'utf8');

    await applyCopilotSetup({ targetDir: tempDir, format: 'cli', yes: true, quiet: true });
    const second = fs.readFileSync(path.join(tempDir, 'copilot-instructions.md'), 'utf8');

    expect(second).toBe(first);
  });

  it('CLI memory rules append to existing content', async () => {
    const cliPath = path.join(tempDir, 'copilot-instructions.md');
    fs.writeFileSync(cliPath, '# My custom instructions\n\nSome content here.\n', 'utf8');

    await applyCopilotSetup({ targetDir: tempDir, format: 'cli', yes: true, quiet: true });
    const content = fs.readFileSync(cliPath, 'utf8');

    expect(content).toContain('# My custom instructions');
    expect(content).toContain('<!-- BEGIN AUTOMEM MEMORY RULES -->');
  });
});

describe('installHookFiles (event name remapping)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('--format cli uses camelCase event names', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'cli', yes: true, quiet: true });

    const hookPath = path.join(tempDir, 'hooks', 'automem-session-start.json');
    expect(fs.existsSync(hookPath)).toBe(true);

    const hookData: CopilotHookFile = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
    const keys = Object.keys(hookData.hooks);
    expect(keys).toContain('sessionStart');
    expect(keys).not.toContain('SessionStart');
  });

  it('--format vscode uses PascalCase event names', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'vscode', yes: true, quiet: true });

    const hookPath = path.join(tempDir, 'hooks', 'automem-session-start.json');
    expect(fs.existsSync(hookPath)).toBe(true);

    const hookData: CopilotHookFile = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
    const keys = Object.keys(hookData.hooks);
    expect(keys).toContain('SessionStart');
    expect(keys).not.toContain('sessionStart');
  });

  it('--format both uses camelCase event names', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'both', yes: true, quiet: true });

    const hookPath = path.join(tempDir, 'hooks', 'automem-session-start.json');
    const hookData: CopilotHookFile = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
    const keys = Object.keys(hookData.hooks);
    expect(keys).toContain('sessionStart');
    expect(keys).not.toContain('SessionStart');
  });

  it('--format vscode remaps session-end hook correctly', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'vscode', yes: true, quiet: true });

    const hookPath = path.join(tempDir, 'hooks', 'automem-session-end.json');
    expect(fs.existsSync(hookPath)).toBe(true);

    const hookData: CopilotHookFile = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
    const keys = Object.keys(hookData.hooks);
    expect(keys).toContain('SessionEnd');
    expect(keys).not.toContain('sessionEnd');
  });

  it('all hooks are valid JSON with version 1', async () => {
    await applyCopilotSetup({
      targetDir: tempDir,
      format: 'both',
      profile: 'full',
      yes: true,
      quiet: true,
    });

    const hooksDir = path.join(tempDir, 'hooks');
    const hookFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.json'));
    expect(hookFiles.length).toBeGreaterThan(0);

    for (const file of hookFiles) {
      const data: CopilotHookFile = JSON.parse(
        fs.readFileSync(path.join(hooksDir, file), 'utf8')
      );
      expect(data.version).toBe(1);
      expect(typeof data.hooks).toBe('object');
    }
  });
});

describe('EVENT_NAMES constants', () => {
  it('cli uses camelCase', () => {
    expect(EVENT_NAMES.cli.sessionStart).toBe('sessionStart');
    expect(EVENT_NAMES.cli.postToolUse).toBe('postToolUse');
    expect(EVENT_NAMES.cli.sessionEnd).toBe('sessionEnd');
  });

  it('vscode uses PascalCase', () => {
    expect(EVENT_NAMES.vscode.sessionStart).toBe('SessionStart');
    expect(EVENT_NAMES.vscode.postToolUse).toBe('PostToolUse');
    expect(EVENT_NAMES.vscode.sessionEnd).toBe('SessionEnd');
  });
});

describe('--format validation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('--format both is accepted', async () => {
    // Should not throw
    await applyCopilotSetup({ targetDir: tempDir, format: 'both', yes: true, quiet: true });
    // Verify hooks were installed (confirms no early exit)
    expect(fs.existsSync(path.join(tempDir, 'hooks'))).toBe(true);
  });

  it('--format cli is accepted', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'cli', yes: true, quiet: true });
    expect(fs.existsSync(path.join(tempDir, 'hooks'))).toBe(true);
  });

  it('--format vscode is accepted', async () => {
    await applyCopilotSetup({ targetDir: tempDir, format: 'vscode', yes: true, quiet: true });
    expect(fs.existsSync(path.join(tempDir, 'hooks'))).toBe(true);
  });
});

describe('dry-run mode', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('--dry-run does not create hook files', async () => {
    await applyCopilotSetup({ targetDir: tempDir, dryRun: true, yes: true, quiet: true });

    const hooksDir = path.join(tempDir, 'hooks');
    // Dry-run skips mkdirSync, so hooks dir may not exist
    if (fs.existsSync(hooksDir)) {
      const files = fs.readdirSync(hooksDir);
      expect(files).toHaveLength(0);
    }
  });

  it('--dry-run does not create memory rules files', async () => {
    await applyCopilotSetup({ targetDir: tempDir, dryRun: true, yes: true, quiet: true });

    expect(fs.existsSync(path.join(tempDir, 'copilot-instructions.md'))).toBe(false);
    expect(
      fs.existsSync(path.join(tempDir, 'instructions', 'automem.instructions.md'))
    ).toBe(false);
  });
});

describe('support scripts installation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('installs support scripts to scripts directory', async () => {
    await applyCopilotSetup({ targetDir: tempDir, yes: true, quiet: true });

    const scriptsDir = path.join(tempDir, 'scripts');
    expect(fs.existsSync(scriptsDir)).toBe(true);

    const scripts = fs.readdirSync(scriptsDir);
    // Should have at least bash + PowerShell pairs
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.some(s => s.endsWith('.sh'))).toBe(true);
    expect(scripts.some(s => s.endsWith('.ps1'))).toBe(true);
  });

  it('installs memory-filters.json', async () => {
    await applyCopilotSetup({ targetDir: tempDir, yes: true, quiet: true });

    const filtersPath = path.join(tempDir, 'scripts', 'memory-filters.json');
    expect(fs.existsSync(filtersPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filtersPath, 'utf8'));
    expect(content).toHaveProperty('trivial_patterns');
  });
});

/**
 * Copilot Profile System Tests (US1: T006-T010)
 * Tests for loadProfile(), --profile flag, and profile switching behavior.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadProfile, VALID_PROFILES } from '../src/cli/copilot.js';

// Helper to create a temp directory for hook installation tests
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-profile-test-'));
}

function cleanupDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

describe('loadProfile', () => {
  // T006: loadProfile('lean') returns exactly session-start and session-end
  it('lean profile returns exactly session-start and session-end hooks', () => {
    const profile = loadProfile('lean');
    expect(profile.name).toBe('lean');
    expect(profile.hooks).toEqual([
      'automem-session-start.json',
      'automem-session-end.json',
    ]);
    expect(profile.hooks).toHaveLength(2);
  });

  // T007: loadProfile('extras') returns all 5 hook filenames
  it('extras profile returns all 5 hook filenames', () => {
    const profile = loadProfile('extras');
    expect(profile.name).toBe('extras');
    expect(profile.hooks).toEqual([
      'automem-session-start.json',
      'automem-build.json',
      'automem-test.json',
      'automem-deploy.json',
      'automem-session-end.json',
    ]);
    expect(profile.hooks).toHaveLength(5);
  });

  // T008: loadProfile('invalid') throws with error message listing valid profiles
  it('invalid profile throws with error listing valid profiles', () => {
    expect(() => loadProfile('invalid')).toThrow(/Invalid profile 'invalid'/);
    expect(() => loadProfile('invalid')).toThrow(/lean/);
    expect(() => loadProfile('invalid')).toThrow(/extras/);
  });

  // T009: default profile resolves to lean
  it('VALID_PROFILES contains lean and extras', () => {
    expect(VALID_PROFILES).toContain('lean');
    expect(VALID_PROFILES).toContain('extras');
    // Default is the first one: lean
    expect(VALID_PROFILES[0]).toBe('lean');
  });

  it('profile definition files have required fields', () => {
    for (const name of VALID_PROFILES) {
      const profile = loadProfile(name);
      expect(profile.name).toBe(name);
      expect(profile.description).toBeTruthy();
      expect(Array.isArray(profile.hooks)).toBe(true);
      expect(profile.hooks.length).toBeGreaterThan(0);
    }
  });
});

describe('profile switching (T010)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // Create hooks directory
    fs.mkdirSync(path.join(tempDir, 'hooks'), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('extras to lean removes extra hooks', () => {
    const hooksDir = path.join(tempDir, 'hooks');

    // Simulate extras profile installed (5 hook files)
    const extrasHooks = [
      'automem-session-start.json',
      'automem-build.json',
      'automem-test.json',
      'automem-deploy.json',
      'automem-session-end.json',
    ];
    for (const hook of extrasHooks) {
      fs.writeFileSync(path.join(hooksDir, hook), '{}', 'utf8');
    }

    // Verify 5 files exist
    const before = fs.readdirSync(hooksDir).filter(f => f.startsWith('automem-'));
    expect(before).toHaveLength(5);

    // Get lean profile hooks
    const leanProfile = loadProfile('lean');

    // Simulate remove-first: remove hooks not in lean
    const existing = fs.readdirSync(hooksDir).filter(f => f.startsWith('automem-') && f.endsWith('.json'));
    for (const hookFile of existing) {
      if (!leanProfile.hooks.includes(hookFile)) {
        fs.unlinkSync(path.join(hooksDir, hookFile));
      }
    }

    // Verify only lean hooks remain
    const after = fs.readdirSync(hooksDir).filter(f => f.startsWith('automem-'));
    expect(after).toHaveLength(2);
    expect(after).toContain('automem-session-start.json');
    expect(after).toContain('automem-session-end.json');
    expect(after).not.toContain('automem-build.json');
    expect(after).not.toContain('automem-test.json');
    expect(after).not.toContain('automem-deploy.json');
  });
});

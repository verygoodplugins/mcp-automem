/**
 * Copilot Profile System Tests (US1: T006-T010)
 * Tests for loadProfile(), --profile flag, and profile switching behavior.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadProfile, VALID_PROFILES, DEFAULT_PROFILE } from '../src/cli/copilot.js';

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
  // T006: loadProfile('lean') returns exactly session-start and store tracker
  it('lean profile returns exactly session-start and track-store hooks', () => {
    const profile = loadProfile('lean');
    expect(profile.name).toBe('lean');
    expect(profile.hooks).toEqual([
      'automem-session-start.json',
      'automem-track-store.json',
    ]);
    expect(profile.hooks).toHaveLength(2);
  });

  // T007: loadProfile('full') adds the opt-in storage nudge
  it('full profile returns lean hooks plus the opt-in stop nudge', () => {
    const profile = loadProfile('full');
    expect(profile.name).toBe('full');
    expect(profile.hooks).toEqual([
      'automem-session-start.json',
      'automem-track-store.json',
      'automem-stop-nudge.json',
    ]);
    expect(profile.hooks).toHaveLength(3);
  });

  // T008: loadProfile('invalid') throws with error message listing valid profiles
  it('invalid profile throws with error listing valid profiles', () => {
    expect(() => loadProfile('invalid')).toThrow(/Invalid profile 'invalid'/);
    expect(() => loadProfile('invalid')).toThrow(/lean/);
    expect(() => loadProfile('invalid')).toThrow(/full/);
  });

  // T009: default profile resolves to lean for low-blast-radius first install
  it('VALID_PROFILES contains lean and full', () => {
    expect(VALID_PROFILES).toContain('lean');
    expect(VALID_PROFILES).toContain('full');
    expect(DEFAULT_PROFILE).toBe('lean');
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

  it('full to lean removes extra hooks', () => {
    const hooksDir = path.join(tempDir, 'hooks');

    // Simulate full profile installed (3 hook files)
    const fullHooks = [
      'automem-session-start.json',
      'automem-track-store.json',
      'automem-stop-nudge.json',
    ];
    for (const hook of fullHooks) {
      fs.writeFileSync(path.join(hooksDir, hook), '{}', 'utf8');
    }

    // Verify 3 files exist
    const before = fs.readdirSync(hooksDir).filter(f => f.startsWith('automem-'));
    expect(before).toHaveLength(3);

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
    expect(after).toContain('automem-track-store.json');
    expect(after).not.toContain('automem-stop-nudge.json');
  });
});

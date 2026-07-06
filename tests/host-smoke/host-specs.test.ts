import { describe, expect, it } from 'vitest';
import { HOST_SMOKE_SPECS } from '../helpers/host-specs.js';
import { duplicateCounts } from '../helpers/host-smoke.js';

describe('host smoke specs', () => {
  it('defines reusable host specs for Hermes, Codex, Claude Code, and OpenCode', () => {
    expect(HOST_SMOKE_SPECS.map((spec) => spec.host).sort()).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'hermes',
      'opencode',
    ]);
  });

  it('uses unique expected tool names per host', () => {
    for (const spec of HOST_SMOKE_SPECS) {
      expect(duplicateCounts(spec.expectedToolNames)).toEqual({});
      expect(spec.expectedToolNames.length).toBeGreaterThan(0);
    }
  });
});

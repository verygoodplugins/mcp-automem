import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PROBE_SCRIPT = path.join(REPO_ROOT, 'scripts/probe-claude-stop-additional-context.mjs');

describe('Claude Code Stop additionalContext probe', () => {
  it('ships a real-host probe with the planned variants and Claude stream flags', () => {
    const source = fs.readFileSync(PROBE_SCRIPT, 'utf8');

    expect(source).toContain('current-imperative');
    expect(source).toContain('neutral-factual');
    expect(source).toContain('plain-stdout');
    expect(source).toContain('--output-format');
    expect(source).toContain('stream-json');
    expect(source).toContain('--include-hook-events');
    expect(source).toContain('--debug-file');
    expect(source).toContain('--setting-sources');
    expect(source).toContain('--verbose');
  });

  it('documents the manual package entrypoint', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['probe:claude-stop-context']).toBe(
      'node scripts/probe-claude-stop-additional-context.mjs'
    );
  });

  it('prints help without invoking Claude Code', () => {
    const output = execFileSync(process.execPath, [PROBE_SCRIPT, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(output).toContain('probe:claude-stop-context');
    expect(output).toContain('neutral-factual');
    expect(output).toContain('plain-stdout');
    expect(output).toContain('default: 0.20');
  });
});

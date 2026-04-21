/**
 * Tests for templates/claude-code/hooks/automem-session-start.sh
 *
 * This hook doesn't read stdin or write a queue — it just prints a prompt
 * that gets injected into Claude's first turn. Tests verify the prompt uses
 * the bare-tag convention (no namespace prefixes) and includes the validated
 * two-phase recall with the 1M-context limits.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOOKS_DIR } from './helpers';

function runSessionStart(options: { cwd?: string } = {}): { stdout: string; exitCode: number } {
  const hookPath = path.join(HOOKS_DIR, 'automem-session-start.sh');
  const result = spawnSync('bash', [hookPath], {
    encoding: 'utf8',
    timeout: 5000,
    cwd: options.cwd ?? process.cwd(),
  });
  return {
    stdout: result.stdout ?? '',
    exitCode: result.status ?? 0,
  };
}

describe('automem-session-start.sh', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length) {
      try {
        fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('exits cleanly', () => {
    const result = runSessionStart();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('injects a Phase 1 preference recall using the bare "preference" tag', () => {
    const { stdout } = runSessionStart();
    expect(stdout).toMatch(/Phase 1/);
    expect(stdout).toMatch(/tags:\s*\["preference"\]/);
    expect(stdout).toMatch(/limit:\s*20/);
    // v3: Phase 1 sorts by updated_desc and uses detailed format so the
    // freshest preferences win and staleness is visible inline.
    expect(stdout).toMatch(/sort:\s*"updated_desc"/);
    expect(stdout).toMatch(/format:\s*"detailed"/);
  });

  it('injects a Phase 2 task-context recall with project-slug gate + 90-day window', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-session-'));
    tmpDirs.push(tmp);
    // Create a package.json so PROJECT resolves to basename(cwd)
    fs.mkdirSync(path.join(tmp, 'my-cool-project'), { recursive: true });
    const projectDir = path.join(tmp, 'my-cool-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));

    const { stdout } = runSessionStart({ cwd: projectDir });
    expect(stdout).toMatch(/Phase 2/);
    expect(stdout).toMatch(/tags:\s*\["my-cool-project"\]/);
    expect(stdout).toMatch(/time_query:\s*"last 90 days"/);
    expect(stdout).toMatch(/limit:\s*30/);
    // v3: Phase 2 uses a SINGLE `query` (not `queries[]` + auto_decompose).
    // Sub-queries converge on the same top scorers and dedup drops results;
    // a single targeted query wins empirically. See issue #97 §D.
    expect(stdout).toMatch(/query:\s*"<proper nouns/);
    expect(stdout).not.toMatch(/^\s*queries:\s*\[/m);
    expect(stdout).not.toMatch(/auto_decompose:\s*true/);
    // The guidance block should warn against the old pattern so future
    // readers of the injected prompt understand why it changed.
    expect(stdout).toMatch(/queries\[\]/);
    expect(stdout).toMatch(/auto_decompose/);
  });

  it('injects a Phase 3 on-demand debugging recall gated by bugfix/solution', () => {
    const { stdout } = runSessionStart();
    expect(stdout).toMatch(/Phase 3/);
    // On-demand framing: should NOT be described as a routine every-session call
    expect(stdout).toMatch(/ON-DEMAND|on-demand/);
    expect(stdout).toMatch(/tags:\s*\["bugfix",\s*"solution"\]/);
  });

  it('tool-call bodies use ONLY bare tags (no namespace prefixes inside tags arrays)', () => {
    const { stdout } = runSessionStart();

    // Extract every `tags: [...]` literal from the injected tool-call bodies.
    const tagsArrays = stdout.match(/tags:\s*\[[^\]]*\]/g) ?? [];
    expect(tagsArrays.length).toBeGreaterThan(0);

    for (const literal of tagsArrays) {
      expect(literal, `namespace prefix in ${literal}`).not.toMatch(
        /(project|lang|pref|source|framework|tool|env|platform|domain|significance)\//
      );
    }

    // The prose guidance ("Do NOT use namespace-prefixed tags (`project/*`, …)")
    // is intentional — we want to teach the agent what NOT to do — so we
    // check the literal tag arrays only, not the whole prompt.
  });

  it('includes the tag-gate warning so Claude knows to drop tags on discovery queries', () => {
    const { stdout } = runSessionStart();
    expect(stdout).toMatch(/HARD GATE|hard gate/);
  });
});

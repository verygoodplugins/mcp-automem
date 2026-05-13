/**
 * Execution tests for templates/copilot/scripts/automem-session-start.{sh,ps1}
 *
 * Both bash and pwsh variants are tested. Each describe block is skipped when
 * the required interpreter is not available, so the suite works cross-platform.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasBash, hasPwsh, runSessionStart, type Shell } from './helpers';

function sessionStartSuite(shell: Shell) {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length) {
      try { fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('exits cleanly and outputs valid JSON with additionalContext', () => {
    const result = runSessionStart(shell);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('additionalContext');
    expect(parsed.additionalContext).toContain('automem_session_context');
  });

  it('injects a Phase 1 preference recall using the bare "preference" tag', () => {
    const { additionalContext: ctx } = runSessionStart(shell);
    expect(ctx).toMatch(/Phase 1/);
    expect(ctx).toMatch(/tags:\s*\["preference"\]/);
    expect(ctx).toMatch(/limit:\s*20/);
    expect(ctx).toMatch(/sort:\s*"updated_desc"/);
    expect(ctx).toMatch(/format:\s*"detailed"/);
  });

  it('injects a Phase 2 task-context recall with project-slug gate + 90-day window', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `automem-${shell}-session-`));
    tmpDirs.push(tmp);
    const projectDir = path.join(tmp, 'my-cool-project');
    fs.mkdirSync(projectDir, { recursive: true });

    const { additionalContext: ctx } = runSessionStart(shell, { cwd: projectDir });
    expect(ctx).toMatch(/Phase 2/);
    expect(ctx).toMatch(/tags:\s*\["my-cool-project"\]/);
    expect(ctx).toMatch(/time_query:\s*"last 90 days"/);
    expect(ctx).toMatch(/limit:\s*30/);
    expect(ctx).toMatch(/query:\s*"<proper nouns/);
    expect(ctx).not.toMatch(/^\s*queries:\s*\[/m);
    expect(ctx).not.toMatch(/auto_decompose:\s*true/);
    expect(ctx).toMatch(/queries\[\]/);
    expect(ctx).toMatch(/auto_decompose/);
  });

  it('injects a Phase 3 on-demand debugging recall gated by bugfix/solution', () => {
    const { additionalContext: ctx } = runSessionStart(shell);
    expect(ctx).toMatch(/Phase 3/);
    expect(ctx).toMatch(/ON-DEMAND|on-demand/);
    expect(ctx).toMatch(/tags:\s*\["bugfix",\s*"solution"\]/);
  });

  it('tool-call bodies use ONLY bare tags (no namespace prefixes)', () => {
    const { additionalContext: ctx } = runSessionStart(shell);
    const tagsArrays = ctx.match(/tags:\s*\[[^\]]*\]/g) ?? [];
    expect(tagsArrays.length).toBeGreaterThan(0);
    for (const literal of tagsArrays) {
      expect(literal, `namespace prefix in ${literal}`).not.toMatch(
        /(project|lang|pref|source|framework|tool|env|platform|domain|significance)\//
      );
    }
  });

  it('includes the tag-gate warning', () => {
    const { additionalContext: ctx } = runSessionStart(shell);
    expect(ctx).toMatch(/HARD GATE|hard gate/);
  });
}

describe.skipIf(!hasBash())('automem-session-start.sh (bash)', () => {
  sessionStartSuite('bash');
});

describe.skipIf(!hasPwsh())('automem-session-start.ps1 (pwsh)', () => {
  sessionStartSuite('pwsh');
});

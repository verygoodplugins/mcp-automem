import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyCodexSetup, CODEX_RULES_END, CODEX_RULES_START } from './codex.js';

describe('codex setup', () => {
  let tmpDir: string;
  let rulesPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-setup-'));
    rulesPath = path.join(tmpDir, 'AGENTS.md');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a marked rules block into a new AGENTS.md', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });

    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toContain(CODEX_RULES_START);
    expect(content).toContain(CODEX_RULES_END);
    expect(content).toContain('demo');
  });

  it('appends below existing content instead of replacing the file', async () => {
    fs.writeFileSync(rulesPath, '# My project notes\n\nKeep this.\n');

    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });

    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toContain('# My project notes');
    expect(content).toContain('Keep this.');
    expect(content.indexOf(CODEX_RULES_START)).toBeGreaterThan(content.indexOf('Keep this.'));
  });

  // The pre-extraction shape appended a bare `\n` on every merge, so each re-run grew
  // the file by one newline and no two installs produced the same bytes.
  it('re-running is byte-stable', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });
    const first = fs.readFileSync(rulesPath, 'utf8');

    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });
    const second = fs.readFileSync(rulesPath, 'utf8');

    expect(second).toBe(first);
    expect(second.endsWith(`${CODEX_RULES_END}\n`)).toBe(true);
  });

  it('re-running keeps content below the block in place, byte for byte', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });
    fs.writeFileSync(rulesPath, `${fs.readFileSync(rulesPath, 'utf8')}\n# Trailing notes\n`);
    const before = fs.readFileSync(rulesPath, 'utf8');

    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(before);
  });

  // Both markers are present, so an indexOf check treats this as well-formed and
  // replaces from the first start through the end — deleting the second marker and the
  // user's notes between them.
  it('refuses when the rules file has two start markers and one end', async () => {
    const handWritten = [
      '# My notes',
      CODEX_RULES_START,
      'stale half-block',
      CODEX_RULES_START,
      'notes the user wrote between the markers',
      CODEX_RULES_END,
      '',
    ].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /found 2 start markers and 1 end marker/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  // Appending past a half-written block leaves one start and two ends, so the *next*
  // run replaces everything between the original start and the appended end.
  it('refuses a one-sided start marker instead of appending', async () => {
    const handWritten = ['# My notes', CODEX_RULES_START, 'half a block, no end', ''].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /without a matching/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('refuses a stray end marker too', async () => {
    const handWritten = ['# My notes', CODEX_RULES_END, ''].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /without a matching/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('refuses when the end marker precedes the start marker', async () => {
    const handWritten = ['# My notes', CODEX_RULES_END, 'user content', CODEX_RULES_START, ''].join(
      '\n'
    );
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /precedes/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('dry-run writes nothing', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', dryRun: true, quiet: true });
    expect(fs.existsSync(rulesPath)).toBe(false);
  });

  it('dry-run still refuses a malformed rules file', async () => {
    const handWritten = [CODEX_RULES_START, 'a', CODEX_RULES_START, 'b', CODEX_RULES_END, ''].join(
      '\n'
    );
    fs.writeFileSync(rulesPath, handWritten);

    await expect(
      applyCodexSetup({ rulesPath, projectName: 'demo', dryRun: true, quiet: true })
    ).rejects.toThrow(/found 2 start markers and 1 end marker/);
  });
});

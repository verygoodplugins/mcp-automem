/**
 * Behavioral tests for the Copilot store tracker and opt-in agentStop nudge.
 *
 * These exercise the real shell/PowerShell scripts end to end against
 * real-format payloads (toolName `automem-store_memory`, transcripts whose
 * human turns are `{"type":"user.message"}` events). Each shell is skipped
 * when its interpreter is unavailable, so the suite stays cross-platform.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hasBash, hasPwsh, type Shell } from './helpers';

const SCRIPTS_DIR = path.resolve(__dirname, '../../templates/copilot/scripts');

let _mountPrefix: string | null = null;
function bashMountPrefix(): string {
  if (_mountPrefix !== null) return _mountPrefix;
  try {
    const r = spawnSync('bash', ['-c', 'test -d /c && echo gitbash || echo wsl'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    _mountPrefix = r.stdout?.trim() === 'gitbash' ? '' : '/mnt';
  } catch {
    _mountPrefix = '/mnt';
  }
  return _mountPrefix;
}

function toUnix(p: string): string {
  if (process.platform !== 'win32') return p;
  const forward = p.replace(/\\/g, '/');
  const prefix = bashMountPrefix();
  return forward.replace(/^([A-Za-z]):/, (_m, d: string) => `${prefix}/${d.toLowerCase()}`);
}

/** Encode an absolute path as it would appear inside a JSON hook payload. */
function payloadPath(shell: Shell, abs: string): string {
  return shell === 'bash' ? toUnix(abs) : abs.replace(/\\/g, '\\\\');
}

function runHook(shell: Shell, scriptBase: string, payload: string, tmpDir: string): string {
  const ext = shell === 'bash' ? '.sh' : '.ps1';
  const scriptPath = path.join(SCRIPTS_DIR, `${scriptBase}${ext}`);
  let result;
  if (shell === 'bash') {
    const bashScript = toUnix(scriptPath);
    const bashTmp = toUnix(tmpDir);
    result = spawnSync(
      'bash',
      ['-c', `export TMPDIR="${bashTmp}"; exec bash "${bashScript}"`],
      { input: payload, encoding: 'utf8', timeout: 15000 }
    );
  } else {
    result = spawnSync(
      'pwsh',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { input: payload, encoding: 'utf8', timeout: 15000, env: { ...process.env, TEMP: tmpDir, TMP: tmpDir } }
    );
  }
  return result.stdout ?? '';
}

function transcriptWith(userTurns: number): string {
  const lines = ['{"type":"session.start"}'];
  for (let i = 0; i < userTurns; i += 1) {
    lines.push('{"type":"user.message","data":{"text":"hi"}}');
    lines.push('{"type":"assistant.message"}');
  }
  return lines.join('\n') + '\n';
}

const SHELLS: Array<{ shell: Shell; available: () => boolean }> = [
  { shell: 'bash', available: hasBash },
  { shell: 'pwsh', available: hasPwsh },
];

for (const { shell, available } of SHELLS) {
  describe.runIf(available())(`automem-track-store (${shell})`, () => {
    const dirs: string[] = [];
    function tmp(): string {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), `automem-track-${shell}-`));
      dirs.push(d);
      return d;
    }
    afterEach(() => {
      for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    it('writes a sentinel for an automem-store_memory call', () => {
      const t = tmp();
      const payload = JSON.stringify({
        sessionId: 'sess-store',
        toolName: 'automem-store_memory',
        toolResult: { resultType: 'success', textResultForLlm: 'ok' },
      });
      runHook(shell, 'automem-track-store', payload, t);
      expect(fs.existsSync(path.join(t, 'automem-stored-sess-store'))).toBe(true);
    });

    it('does NOT write a sentinel for a non-store tool', () => {
      const t = tmp();
      const payload = JSON.stringify({
        sessionId: 'sess-nonstore',
        toolName: 'powershell',
        toolResult: { resultType: 'success', textResultForLlm: 'x' },
      });
      runHook(shell, 'automem-track-store', payload, t);
      expect(fs.existsSync(path.join(t, 'automem-stored-sess-nonstore'))).toBe(false);
    });
  });

  describe.runIf(available())(`automem-stop-nudge (${shell})`, () => {
    const dirs: string[] = [];
    function tmp(): string {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), `automem-nudge-${shell}-`));
      dirs.push(d);
      return d;
    }
    afterEach(() => {
      for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    function nudgePayload(t: string, sessionId: string, userTurns: number): string {
      const transcript = path.join(t, 'events.jsonl');
      fs.writeFileSync(transcript, transcriptWith(userTurns));
      return `{"sessionId":"${sessionId}","transcriptPath":"${payloadPath(shell, transcript)}","stopReason":"end_turn"}`;
    }

    it('blocks once when nothing was stored in a substantive session', () => {
      const t = tmp();
      const out = runHook(shell, 'automem-stop-nudge', nudgePayload(t, 'nudge-1', 5), t);
      expect(out).toContain('"decision":"block"');
      expect(out).toContain('store_memory');
      // Once-per-session: a re-entrant agentStop stays silent.
      const out2 = runHook(shell, 'automem-stop-nudge', nudgePayload(t, 'nudge-1', 5), t);
      expect(out2.trim()).toBe('');
    });

    it('stays silent when a store already happened (stored sentinel present)', () => {
      const t = tmp();
      fs.writeFileSync(path.join(t, 'automem-stored-nudge-2'), '');
      const out = runHook(shell, 'automem-stop-nudge', nudgePayload(t, 'nudge-2', 5), t);
      expect(out.trim()).toBe('');
    });

    it('stays silent below the substantive-session threshold', () => {
      const t = tmp();
      const out = runHook(shell, 'automem-stop-nudge', nudgePayload(t, 'nudge-3', 2), t);
      expect(out.trim()).toBe('');
      // Did not burn the once-per-session sentinel, so a later turn can nudge.
      expect(fs.existsSync(path.join(t, 'automem-stop-nudged-nudge-3'))).toBe(false);
    });
  });
}

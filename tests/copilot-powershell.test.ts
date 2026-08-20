/**
 * Copilot PowerShell Script Tests
 * Validates PS script presence and hook JSON dual-key structure for the
 * LLM-judged hook model (session-start recall, store tracker, opt-in nudge).
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEMPLATE_ROOT = path.resolve(fileURLToPath(new URL('../templates/copilot', import.meta.url)));

const PS_SCRIPTS = [
  'automem-session-start.ps1',
  'automem-track-store.ps1',
  'automem-stop-nudge.ps1',
];

const HOOK_FILES_WITH_COMMANDS = [
  'automem-session-start.json',
  'automem-track-store.json',
  'automem-stop-nudge.json',
];

describe('PowerShell scripts', () => {
  it('all PS scripts exist in templates', () => {
    for (const script of PS_SCRIPTS) {
      const scriptPath = path.join(TEMPLATE_ROOT, 'scripts', script);
      expect(fs.existsSync(scriptPath), `Missing PS script: ${script}`).toBe(true);
    }
  });

  it('all PS scripts fail silently with try/catch and exit 0', () => {
    for (const script of PS_SCRIPTS) {
      const content = fs.readFileSync(path.join(TEMPLATE_ROOT, 'scripts', script), 'utf8');
      expect(content, `${script} missing try block`).toContain('try {');
      expect(content, `${script} missing catch block`).toContain('} catch {');
      expect(content, `${script} missing exit 0`).toContain('exit 0');
    }
  });

  it('the retired capture/queue PS scripts are gone', () => {
    const retired = [
      'capture-build-result.ps1',
      'capture-test-pattern.ps1',
      'capture-deployment.ps1',
      'session-memory.ps1',
      'queue-cleanup.ps1',
      'python-command.ps1',
    ];
    for (const script of retired) {
      expect(
        fs.existsSync(path.join(TEMPLATE_ROOT, 'scripts', script)),
        `Retired script should be deleted: ${script}`
      ).toBe(false);
    }
  });
});

describe('Hook JSON dual-key verification', () => {
  it('command-type hook entries have both bash and powershell keys', () => {
    for (const hookFile of HOOK_FILES_WITH_COMMANDS) {
      const hookPath = path.join(TEMPLATE_ROOT, 'hooks', hookFile);
      expect(fs.existsSync(hookPath), `Missing hook file: ${hookFile}`).toBe(true);

      const data = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
      for (const [eventName, entries] of Object.entries(data.hooks)) {
        for (const entry of entries as Array<Record<string, unknown>>) {
          if (entry.type === 'command') {
            expect(entry.bash, `${hookFile} -> ${eventName}: missing bash key`).toBeTruthy();
            expect(
              entry.powershell,
              `${hookFile} -> ${eventName}: missing powershell key`
            ).toBeTruthy();
          }
        }
      }
    }
  });

  it('powershell keys invoke a .ps1 script via the & operator', () => {
    for (const hookFile of HOOK_FILES_WITH_COMMANDS) {
      const hookPath = path.join(TEMPLATE_ROOT, 'hooks', hookFile);
      const data = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
      for (const entries of Object.values(data.hooks)) {
        for (const entry of entries as Array<Record<string, unknown>>) {
          if (entry.type === 'command' && entry.powershell) {
            const ps = String(entry.powershell);
            expect(
              ps.includes('& ') && ps.includes('.ps1'),
              `${hookFile}: powershell entry is not a .ps1 invocation: ${ps}`
            ).toBe(true);
          }
        }
      }
    }
  });
});

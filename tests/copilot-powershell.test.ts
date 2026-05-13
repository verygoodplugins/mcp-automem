/**
 * Copilot PowerShell Script Tests (US2: T021a, T021b)
 * Validates PS script presence and hook JSON dual-key structure.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEMPLATE_ROOT = path.resolve(
  fileURLToPath(new URL('../templates/copilot', import.meta.url))
);

const PS_SCRIPTS = [
  'capture-build-result.ps1',
  'capture-test-pattern.ps1',
  'capture-deployment.ps1',
  'session-memory.ps1',
  'queue-cleanup.ps1',
  'python-command.ps1',
];

const HOOK_FILES_WITH_COMMANDS = [
  'automem-build.json',
  'automem-test.json',
  'automem-deploy.json',
  'automem-session-end.json',
  'automem-post-tool-use.json',
];

describe('PowerShell scripts (T021a)', () => {
  it('all 6 PS scripts exist in templates', () => {
    for (const script of PS_SCRIPTS) {
      const scriptPath = path.join(TEMPLATE_ROOT, 'scripts', script);
      expect(fs.existsSync(scriptPath), `Missing PS script: ${script}`).toBe(true);
    }
  });

  it('all PS scripts contain try/catch error handling pattern', () => {
    for (const script of PS_SCRIPTS) {
      const content = fs.readFileSync(path.join(TEMPLATE_ROOT, 'scripts', script), 'utf8');
      expect(content, `${script} missing try block`).toContain('try {');
      expect(content, `${script} missing catch block`).toContain('} catch {');
      expect(content, `${script} missing error handler`).toContain('Write-Error "AutoMem hook error: $_"');
      expect(content, `${script} missing exit 0`).toContain('exit 0');
    }
  });

  it('capture scripts write to memory-queue.jsonl path', () => {
    const captureScripts = PS_SCRIPTS.filter(s => s.startsWith('capture-') || s === 'session-memory.ps1');
    for (const script of captureScripts) {
      const content = fs.readFileSync(path.join(TEMPLATE_ROOT, 'scripts', script), 'utf8');
      expect(content, `${script} missing queue path`).toContain('memory-queue.jsonl');
    }
  });

  it('capture scripts produce JSONL with required schema fields', () => {
    // Verify scripts reference the required fields in their record construction
    const captureScripts = ['capture-build-result.ps1', 'capture-test-pattern.ps1', 'capture-deployment.ps1'];
    const requiredFields = ['content', 'tags', 'importance', 'type', 'metadata', 'timestamp'];

    for (const script of captureScripts) {
      const content = fs.readFileSync(path.join(TEMPLATE_ROOT, 'scripts', script), 'utf8');
      for (const field of requiredFields) {
        expect(content, `${script} missing JSONL field: ${field}`).toContain(field);
      }
    }
  });
});

describe('Hook JSON dual-key verification (T021b)', () => {
  it('command-type hook entries have both bash and powershell keys', () => {
    for (const hookFile of HOOK_FILES_WITH_COMMANDS) {
      const hookPath = path.join(TEMPLATE_ROOT, 'hooks', hookFile);
      if (!fs.existsSync(hookPath)) continue;

      const data = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
      for (const [eventName, entries] of Object.entries(data.hooks)) {
        for (const entry of entries as Array<Record<string, unknown>>) {
          if (entry.type === 'command') {
            expect(entry.bash, `${hookFile} -> ${eventName}: missing bash key`).toBeTruthy();
            expect(entry.powershell, `${hookFile} -> ${eventName}: missing powershell key`).toBeTruthy();
            // Verify PS key is a real script reference, not a warning stub
            expect(
              String(entry.powershell),
              `${hookFile} -> ${eventName}: powershell is still a warning stub`
            ).toContain('-File');
          }
        }
      }
    }
  });

  it('powershell keys use correct invocation format', () => {
    for (const hookFile of HOOK_FILES_WITH_COMMANDS) {
      const hookPath = path.join(TEMPLATE_ROOT, 'hooks', hookFile);
      if (!fs.existsSync(hookPath)) continue;

      const data = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
      for (const entries of Object.values(data.hooks)) {
        for (const entry of entries as Array<Record<string, unknown>>) {
          if (entry.type === 'command' && entry.powershell) {
            const ps = String(entry.powershell);
            expect(ps).toContain('powershell -ExecutionPolicy Bypass -File');
            expect(ps).toContain('.ps1');
          }
        }
      }
    }
  });
});

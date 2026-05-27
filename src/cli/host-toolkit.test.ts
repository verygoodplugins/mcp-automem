import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  backupPath,
  detectProjectName,
  parseCommonFlags,
  readJsonFile,
  replaceTemplateVars,
  writeFileWithBackup,
} from './host-toolkit.js';

describe('host-toolkit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-toolkit-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('backupPath', () => {
    it('returns .bak when nothing collides', () => {
      const filePath = path.join(tmpDir, 'config.json');
      expect(backupPath(filePath)).toBe(`${filePath}.bak`);
    });

    it('increments counter when .bak already exists', () => {
      const filePath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(`${filePath}.bak`, 'existing');
      expect(backupPath(filePath)).toBe(`${filePath}.bak.1`);
    });

    it('skips multiple existing backups', () => {
      const filePath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(`${filePath}.bak`, 'a');
      fs.writeFileSync(`${filePath}.bak.1`, 'b');
      fs.writeFileSync(`${filePath}.bak.2`, 'c');
      expect(backupPath(filePath)).toBe(`${filePath}.bak.3`);
    });
  });

  describe('writeFileWithBackup', () => {
    it('creates a new file when none exists', () => {
      const target = path.join(tmpDir, 'new.txt');
      const result = writeFileWithBackup(target, 'hello', { quiet: true });
      expect(result.status).toBe('created');
      expect(fs.readFileSync(target, 'utf8')).toBe('hello');
    });

    it('updates an existing file and writes a backup', () => {
      const target = path.join(tmpDir, 'existing.txt');
      fs.writeFileSync(target, 'old');
      const result = writeFileWithBackup(target, 'new', { quiet: true });
      expect(result.status).toBe('updated');
      expect(fs.readFileSync(target, 'utf8')).toBe('new');
      expect(fs.readFileSync(`${target}.bak`, 'utf8')).toBe('old');
    });

    it('returns unchanged when content matches', () => {
      const target = path.join(tmpDir, 'same.txt');
      fs.writeFileSync(target, 'same');
      const result = writeFileWithBackup(target, 'same', { quiet: true });
      expect(result.status).toBe('unchanged');
      expect(fs.existsSync(`${target}.bak`)).toBe(false);
    });

    it('writes nothing in dry-run mode', () => {
      const target = path.join(tmpDir, 'dry.txt');
      const result = writeFileWithBackup(target, 'hello', { dryRun: true, quiet: true });
      expect(result.status).toBe('dry-run');
      expect(fs.existsSync(target)).toBe(false);
    });
  });

  describe('readJsonFile', () => {
    it('returns parsed JSON', () => {
      const target = path.join(tmpDir, 'data.json');
      fs.writeFileSync(target, JSON.stringify({ a: 1 }));
      expect(readJsonFile<{ a: number }>(target)).toEqual({ a: 1 });
    });

    it('returns null when file does not exist', () => {
      expect(readJsonFile(path.join(tmpDir, 'missing.json'))).toBeNull();
    });

    it('returns null on malformed JSON', () => {
      const target = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(target, '{ not json');
      expect(readJsonFile(target)).toBeNull();
    });
  });

  describe('replaceTemplateVars', () => {
    it('replaces single variable', () => {
      expect(replaceTemplateVars('hello {{NAME}}', { NAME: 'world' })).toBe('hello world');
    });

    it('replaces all occurrences', () => {
      expect(replaceTemplateVars('{{X}} and {{X}}', { X: '1' })).toBe('1 and 1');
    });

    it('leaves untouched variables in place', () => {
      expect(replaceTemplateVars('{{A}} {{B}}', { A: 'a' })).toBe('a {{B}}');
    });
  });

  describe('detectProjectName', () => {
    it('reads name from package.json and strips scope', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: '@scope/my-pkg' }),
      );
      expect(detectProjectName(tmpDir)).toBe('my-pkg');
    });

    it('falls back to directory basename when no package.json', () => {
      expect(detectProjectName(tmpDir)).toBe(path.basename(tmpDir));
    });

    it('ignores malformed package.json and uses directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ broken');
      expect(detectProjectName(tmpDir)).toBe(path.basename(tmpDir));
    });
  });

  describe('parseCommonFlags', () => {
    it('parses common flags', () => {
      const opts = parseCommonFlags(['--dir', '/tmp', '--name', 'p', '--dry-run', '--quiet', '-y']);
      expect(opts).toEqual({
        targetDir: '/tmp',
        projectName: 'p',
        dryRun: true,
        quiet: true,
        yes: true,
      });
    });

    it('handles extra value flag', () => {
      let rulesPath: string | undefined;
      const opts = parseCommonFlags(['--rules', '/x.md', '--quiet'], {
        '--rules': { kind: 'value', set: (v) => (rulesPath = v) },
      });
      expect(rulesPath).toBe('/x.md');
      expect(opts.quiet).toBe(true);
    });

    it('handles extra boolean flag', () => {
      let cleanAll = false;
      parseCommonFlags(['--clean-all', '--quiet'], {
        '--clean-all': { kind: 'boolean', set: () => (cleanAll = true) },
      });
      expect(cleanAll).toBe(true);
    });

    it('exits when a required value is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => parseCommonFlags(['--dir'])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errSpy).toHaveBeenCalled();
    });

    it('silently ignores unknown flags (matches existing handler behavior)', () => {
      const opts = parseCommonFlags(['--unknown', '--dry-run']);
      expect(opts.dryRun).toBe(true);
    });
  });
});

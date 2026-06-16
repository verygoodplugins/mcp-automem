import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  backupPath,
  detectProjectName,
  formatEnvValue,
  mergeEnvContent,
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

    it('treats replacement values as literal strings', () => {
      expect(replaceTemplateVars('value={{A}}', { A: '$& $$ $1' })).toBe('value=$& $$ $1');
    });

    it('escapes variable names before building the matcher', () => {
      expect(replaceTemplateVars('{{A.B}} {{ACB}}', { 'A.B': 'x' })).toBe('x {{ACB}}');
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

    it('ignores unknown flags that match inherited object properties', () => {
      expect(() => parseCommonFlags(['toString', '--dry-run'])).not.toThrow();
      expect(parseCommonFlags(['toString', '--dry-run']).dryRun).toBe(true);
    });
  });

  describe('formatEnvValue', () => {
    it('leaves safe values unquoted and quotes the rest', () => {
      expect(formatEnvValue('https://automem.example')).toBe('https://automem.example');
      expect(formatEnvValue('sk_live_abc123')).toBe('sk_live_abc123');
      expect(formatEnvValue('has space')).toBe('"has space"');
      expect(formatEnvValue('a#b')).toBe('"a#b"');
      expect(formatEnvValue('with"quote')).toBe('"with\\"quote"');
      expect(formatEnvValue('')).toBe('""');
    });

    it('quotes shell metacharacters that the loose quoter used to miss', () => {
      // Regression guard for the install/setup divergence: $, ;, {} must be quoted
      // so a dotenv parser cannot expand or mis-split them.
      expect(formatEnvValue('a$b')).toBe('"a$b"');
      expect(formatEnvValue('a;b')).toBe('"a;b"');
      expect(formatEnvValue('a{b}')).toBe('"a{b}"');
    });
  });

  describe('mergeEnvContent', () => {
    it('preserves foreign keys, comments, and blank lines while updating in place', () => {
      const existing = ['# header comment', 'FOO=bar', '', 'AUTOMEM_API_URL=http://old:1'].join('\n') + '\n';
      const merged = mergeEnvContent(existing, { AUTOMEM_API_URL: 'http://new:2' });
      const lines = merged.split(/\r?\n/);
      expect(lines).toContain('# header comment');
      expect(lines).toContain('FOO=bar');
      expect(lines).toContain('AUTOMEM_API_URL=http://new:2');
      // updated in place, not duplicated
      expect(lines.filter((l) => l.startsWith('AUTOMEM_API_URL=')).length).toBe(1);
      expect(merged).not.toContain('http://old:1');
    });

    it('appends new keys that were not already present', () => {
      const merged = mergeEnvContent('FOO=bar\n', { AUTOMEM_API_KEY: 'sk-test' });
      expect(merged).toContain('FOO=bar');
      expect(merged).toContain('AUTOMEM_API_KEY=sk-test');
    });

    it('does not corrupt a pre-existing key that collides with an Object.prototype member', () => {
      // `key in updates` would treat `constructor`/`toString` as present (prototype
      // chain) and rewrite them to garbage; hasOwnProperty must keep them verbatim.
      const existing = 'constructor=foo\ntoString=bar\n';
      const merged = mergeEnvContent(existing, { AUTOMEM_API_URL: 'http://x:1' });
      expect(merged).toContain('constructor=foo');
      expect(merged).toContain('toString=bar');
      expect(merged).toContain('AUTOMEM_API_URL=http://x:1');
    });
  });

  describe('writeFileWithBackup secret mode', () => {
    // POSIX permission bits only — Windows does not honor chmod's mode the same way.
    it.skipIf(process.platform === 'win32')('writes a secret file as 0o600', () => {
      const target = path.join(tmpDir, '.env');
      writeFileWithBackup(target, 'AUTOMEM_API_KEY=sk-secret\n', { quiet: true, secret: true });
      const mode = fs.statSync(target).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it.skipIf(process.platform === 'win32')('tightens an existing world-readable secret file and its backup to 0o600', () => {
      const target = path.join(tmpDir, '.env');
      fs.writeFileSync(target, 'AUTOMEM_API_KEY=old\n', { mode: 0o644 });
      fs.chmodSync(target, 0o644);
      writeFileWithBackup(target, 'AUTOMEM_API_KEY=new\n', { quiet: true, secret: true });
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
      const backup = `${target}.bak`;
      expect(fs.existsSync(backup)).toBe(true);
      expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
    });
  });
});

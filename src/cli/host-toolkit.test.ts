import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  backupPath,
  describeMarkedBlockDefect,
  detectProjectName,
  formatEnvValue,
  isAutoMemServerEntry,
  mergeEnvContent,
  parseCommonFlags,
  readApiKeyFrom,
  readEndpointFrom,
  readJsonFile,
  removeEnvContentKeys,
  replaceTemplateVars,
  parseEnvAssignment,
  resolveInheritedApiKey,
  scanMarkedBlock,
  stripMarkedBlock,
  upsertMarkedBlock,
  writeFileWithBackup,
} from './host-toolkit.js';

const MARKERS = { start: '<!-- BEGIN TEST RULES -->', end: '<!-- END TEST RULES -->' };
const BLOCK = `${MARKERS.start}\nrules body\n${MARKERS.end}\n`;

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
        JSON.stringify({ name: '@scope/my-pkg' })
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
      const existing =
        ['# header comment', 'FOO=bar', '', 'AUTOMEM_API_URL=http://old:1'].join('\n') + '\n';
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

    it.skipIf(process.platform === 'win32')(
      'tightens an existing world-readable secret file and its backup to 0o600',
      () => {
        const target = path.join(tmpDir, '.env');
        fs.writeFileSync(target, 'AUTOMEM_API_KEY=old\n', { mode: 0o644 });
        fs.chmodSync(target, 0o644);
        writeFileWithBackup(target, 'AUTOMEM_API_KEY=new\n', { quiet: true, secret: true });
        expect(fs.statSync(target).mode & 0o777).toBe(0o600);
        const backup = `${target}.bak`;
        expect(fs.existsSync(backup)).toBe(true);
        expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
      }
    );
  });

  describe('scanMarkedBlock', () => {
    it('reports an untouched file as absent', () => {
      const scan = scanMarkedBlock('# Notes\n', MARKERS);
      expect(scan).toMatchObject({ starts: 0, ends: 0, absent: true, paired: false });
    });

    it('reports one ordered pair as a single block', () => {
      const scan = scanMarkedBlock(`# Notes\n\n${BLOCK}`, MARKERS);
      expect(scan).toMatchObject({ starts: 1, ends: 1, paired: true, singlePair: true });
    });

    it('counts repeated markers instead of stopping at the first', () => {
      const content = [MARKERS.start, 'first', MARKERS.start, 'second', MARKERS.end, ''].join('\n');
      const scan = scanMarkedBlock(content, MARKERS);
      // Both markers are present, so an indexOf check calls this well-formed. The
      // counts are what make it refusable.
      expect(scan.startIndex).not.toBe(-1);
      expect(scan.endIndex).toBeGreaterThan(scan.startIndex);
      expect(scan).toMatchObject({ starts: 2, ends: 1, paired: false, singlePair: false });
    });

    it('rejects a reversed pair', () => {
      const scan = scanMarkedBlock(`${MARKERS.end}\nbody\n${MARKERS.start}\n`, MARKERS);
      expect(scan).toMatchObject({ starts: 1, ends: 1, paired: false, singlePair: false });
    });

    it('accepts two properly nested pairs as paired but not a single block', () => {
      const scan = scanMarkedBlock(`${BLOCK}\n${BLOCK}`, MARKERS);
      expect(scan).toMatchObject({ starts: 2, ends: 2, paired: true, singlePair: false });
    });

    it('rejects two pairs whose markers interleave out of order', () => {
      const content = [MARKERS.start, 'a', MARKERS.start, 'b', MARKERS.end, MARKERS.end, ''].join(
        '\n'
      );
      expect(scanMarkedBlock(content, MARKERS)).toMatchObject({
        starts: 2,
        ends: 2,
        paired: false,
      });
    });
  });

  describe('upsertMarkedBlock', () => {
    it('writes the block with one trailing newline into a new file', () => {
      expect(upsertMarkedBlock(null, BLOCK, MARKERS, 'rules.md')).toBe(
        `${MARKERS.start}\nrules body\n${MARKERS.end}\n`
      );
    });

    it('appends below unrelated content', () => {
      const result = upsertMarkedBlock('# Notes\n', BLOCK, MARKERS, 'rules.md');
      expect(result).toBe(`# Notes\n\n${MARKERS.start}\nrules body\n${MARKERS.end}\n`);
    });

    it('replaces an existing block and is byte-stable across re-runs', () => {
      const first = upsertMarkedBlock('# Notes\n', BLOCK, MARKERS, 'rules.md');
      const second = upsertMarkedBlock(first, BLOCK, MARKERS, 'rules.md');
      expect(second).toBe(first);
      const third = upsertMarkedBlock(second, BLOCK, MARKERS, 'rules.md');
      expect(third).toBe(second);
    });

    it('keeps content that follows the block', () => {
      const existing = `# Top\n\n${MARKERS.start}\nold\n${MARKERS.end}\n\n# Bottom\n`;
      const result = upsertMarkedBlock(existing, BLOCK, MARKERS, 'rules.md');
      expect(result).toBe(`# Top\n\n${MARKERS.start}\nrules body\n${MARKERS.end}\n\n# Bottom\n`);
    });

    // Normalizing only the end of the file hides a growing seam: the block template
    // ends with a newline and `after` opens with one, so a naive join adds a blank
    // line per run to every file that has content below the block.
    it('is byte-stable across re-runs when content follows the block', () => {
      const existing = `# Top\n\n${MARKERS.start}\nold\n${MARKERS.end}\n\n# Bottom\n`;
      const first = upsertMarkedBlock(existing, BLOCK, MARKERS, 'rules.md');
      const second = upsertMarkedBlock(first, BLOCK, MARKERS, 'rules.md');
      const third = upsertMarkedBlock(second, BLOCK, MARKERS, 'rules.md');
      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it('refuses two start markers and one end', () => {
      const existing = [MARKERS.start, 'stale', MARKERS.start, 'user notes', MARKERS.end, ''].join(
        '\n'
      );
      expect(() => upsertMarkedBlock(existing, BLOCK, MARKERS, 'rules.md')).toThrow(
        /found 2 start markers and 1 end marker/
      );
    });

    it('refuses a one-sided start marker', () => {
      expect(() =>
        upsertMarkedBlock(`# Notes\n${MARKERS.start}\nhalf\n`, BLOCK, MARKERS, 'rules.md')
      ).toThrow(/without a matching/);
    });

    it('refuses a one-sided end marker', () => {
      expect(() =>
        upsertMarkedBlock(`# Notes\n${MARKERS.end}\n`, BLOCK, MARKERS, 'rules.md')
      ).toThrow(/without a matching/);
    });

    it('refuses a reversed pair', () => {
      expect(() =>
        upsertMarkedBlock(`${MARKERS.end}\nbody\n${MARKERS.start}\n`, BLOCK, MARKERS, 'rules.md')
      ).toThrow(/precedes/);
    });

    it('refuses two complete blocks rather than picking one', () => {
      expect(() => upsertMarkedBlock(`${BLOCK}\n${BLOCK}`, BLOCK, MARKERS, 'rules.md')).toThrow(
        /found 2 start markers and 2 end markers/
      );
    });

    it('names the file in the error so the user knows what to repair', () => {
      expect(() =>
        upsertMarkedBlock(`${MARKERS.start}\n`, BLOCK, MARKERS, '/tmp/AGENTS.md')
      ).toThrow(/\/tmp\/AGENTS\.md/);
    });
  });

  describe('stripMarkedBlock', () => {
    it('removes the block and collapses the blank lines left behind', () => {
      const existing = `# Top\n\n${BLOCK}\n# Bottom\n`;
      expect(stripMarkedBlock(existing, MARKERS)).toBe('# Top\n\n# Bottom\n');
    });

    it('leaves content without markers alone', () => {
      expect(stripMarkedBlock('# Top\n', MARKERS)).toBe('# Top\n');
    });

    it('removes every properly paired block', () => {
      expect(stripMarkedBlock(`# Top\n\n${BLOCK}\n${BLOCK}\n# Bottom\n`, MARKERS)).toBe(
        '# Top\n\n# Bottom\n'
      );
    });
  });

  describe('describeMarkedBlockDefect', () => {
    it('singularizes a lone marker count', () => {
      const scan = scanMarkedBlock(`${MARKERS.start}\n${MARKERS.start}\n${MARKERS.end}\n`, MARKERS);
      expect(describeMarkedBlockDefect(scan, MARKERS)).toBe(
        'found 2 start markers and 1 end marker'
      );
    });
  });
});

describe('resolveInheritedApiKey', () => {
  const ENDPOINT = 'https://chosen.example.test';

  it('takes an explicit --api-key over everything, whatever the endpoints say', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        explicitKey: 'sk-flag',
        storedEndpoint: ENDPOINT,
        storedKey: 'sk-stored',
        env: { AUTOMEM_API_URL: ENDPOINT, AUTOMEM_API_KEY: 'sk-env' },
      })
    ).toBe('sk-flag');
  });

  it('reuses an env key whose env endpoint is the chosen one', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        env: { AUTOMEM_API_URL: ENDPOINT, AUTOMEM_API_KEY: 'sk-env' },
      })
    ).toBe('sk-env');
  });

  // The whole point of the sweep: a key must not follow --endpoint to a host it was
  // never issued for. Filed separately against grok, hermes and the guided installer.
  it('drops an env key when the env endpoint is a different host', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        env: { AUTOMEM_API_URL: 'https://elsewhere.example.test', AUTOMEM_API_KEY: 'sk-env' },
      })
    ).toBeUndefined();
  });

  it('treats a trailing slash as the same endpoint, not a different host', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: 'https://chosen.example.test',
        env: { AUTOMEM_API_URL: 'https://chosen.example.test/', AUTOMEM_API_KEY: 'sk-env' },
      })
    ).toBe('sk-env');
  });

  // The two inherited sources are asymmetric on purpose; both halves are pinned here
  // so a later "simplification" that collapses them fails loudly.
  it('keeps an env key that has no env endpoint — it is bound to nothing', () => {
    expect(resolveInheritedApiKey({ endpoint: ENDPOINT, env: { AUTOMEM_API_KEY: 'sk-env' } })).toBe(
      'sk-env'
    );
  });

  it('drops a stored key that has no stored endpoint — a keyed entry with no URL is malformed', () => {
    expect(
      resolveInheritedApiKey({ endpoint: ENDPOINT, storedKey: 'sk-stored', env: {} })
    ).toBeUndefined();
  });

  it('reuses a stored key when the stored endpoint is the chosen one', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        storedEndpoint: ENDPOINT,
        storedKey: 'sk-stored',
        env: {},
      })
    ).toBe('sk-stored');
  });

  it('drops a stored key when the endpoint changed underneath it', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        storedEndpoint: 'https://old.example.test',
        storedKey: 'sk-stored',
        env: {},
      })
    ).toBeUndefined();
  });

  it('prefers the env key over the stored key when both are valid', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        storedEndpoint: ENDPOINT,
        storedKey: 'sk-stored',
        env: { AUTOMEM_API_URL: ENDPOINT, AUTOMEM_API_KEY: 'sk-env' },
      })
    ).toBe('sk-env');
  });

  it('falls back to the stored key when the env key is rejected', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        storedEndpoint: ENDPOINT,
        storedKey: 'sk-stored',
        env: { AUTOMEM_API_URL: 'https://elsewhere.example.test', AUTOMEM_API_KEY: 'sk-env' },
      })
    ).toBe('sk-stored');
  });

  it('reads the deprecated AUTOMEM_API_TOKEN alias and pairs it the same way', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        env: { AUTOMEM_ENDPOINT: ENDPOINT, AUTOMEM_API_TOKEN: 'sk-legacy' },
      })
    ).toBe('sk-legacy');
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        env: { AUTOMEM_ENDPOINT: 'https://elsewhere.example.test', AUTOMEM_API_TOKEN: 'sk-legacy' },
      })
    ).toBeUndefined();
  });

  // Those variables are exported by Claude Code into the plugin's own MCP subprocess
  // for src/index.ts to resolve. An installer that inherited the key never consulted
  // the CLAUDE_PLUGIN_OPTION_API_URL it was issued against, so it could not pair it.
  it('ignores CLAUDE_PLUGIN_OPTION_* entirely', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        env: {
          CLAUDE_PLUGIN_OPTION_API_URL: ENDPOINT,
          CLAUDE_PLUGIN_OPTION_API_KEY: 'sk-plugin',
        },
      })
    ).toBeUndefined();
  });

  it('ignores blank and whitespace-only values', () => {
    expect(
      resolveInheritedApiKey({
        endpoint: ENDPOINT,
        explicitKey: '   ',
        env: { AUTOMEM_API_KEY: '  ' },
        storedEndpoint: ENDPOINT,
        storedKey: '',
      })
    ).toBeUndefined();
  });
});

describe('readApiKeyFrom / readEndpointFrom', () => {
  it('prefers the canonical name over the deprecated alias', () => {
    expect(readApiKeyFrom({ AUTOMEM_API_KEY: 'canonical', AUTOMEM_API_TOKEN: 'legacy' })).toBe(
      'canonical'
    );
    expect(readEndpointFrom({ AUTOMEM_API_URL: 'canonical', AUTOMEM_ENDPOINT: 'legacy' })).toBe(
      'canonical'
    );
  });

  it('falls back to the alias when the canonical name is absent or blank', () => {
    expect(readApiKeyFrom({ AUTOMEM_API_TOKEN: 'legacy' })).toBe('legacy');
    expect(readApiKeyFrom({ AUTOMEM_API_KEY: '   ', AUTOMEM_API_TOKEN: 'legacy' })).toBe('legacy');
    expect(readEndpointFrom({ AUTOMEM_ENDPOINT: 'legacy' })).toBe('legacy');
  });

  it('returns undefined for an empty or absent source', () => {
    expect(readApiKeyFrom(undefined)).toBeUndefined();
    expect(readApiKeyFrom({})).toBeUndefined();
  });
});

describe('isAutoMemServerEntry', () => {
  it('matches the entry the installers write', () => {
    expect(
      isAutoMemServerEntry({ command: 'npx', args: ['-y', '@verygoodplugins/mcp-automem'] })
    ).toBe(true);
  });

  // `npm exec -- <pkg>[@<version>]` is the documented spec, so a pinned entry is the
  // same package. Rejecting it made setup refuse to update it and uninstall skip it.
  it('matches a version-pinned package spec', () => {
    expect(
      isAutoMemServerEntry({ command: 'npx', args: ['-y', '@verygoodplugins/mcp-automem@0.15.0'] })
    ).toBe(true);
  });

  it('matches a dist-tag package spec', () => {
    expect(
      isAutoMemServerEntry({ command: 'npx', args: ['-y', '@verygoodplugins/mcp-automem@latest'] })
    ).toBe(true);
    expect(isAutoMemServerEntry({ command: 'npx', args: ['-y', 'mcp-automem@next'] })).toBe(true);
  });

  it('matches a linked dev checkout launched by absolute path', () => {
    expect(
      isAutoMemServerEntry({
        command: 'node',
        args: ['/Users/dev/Projects/mcp-automem/dist/index.js'],
      })
    ).toBe(true);
  });

  it('matches a hand-written entry by AutoMem env var names', () => {
    expect(
      isAutoMemServerEntry({
        command: 'some-wrapper',
        args: ['--serve'],
        env: { AUTOMEM_API_URL: 'https://automem.example.test' },
      })
    ).toBe(true);
  });

  // The filed defect: the predicate used to stringify the whole entry, env values
  // included, so an unrelated server that merely *pointed at* a host named
  // mcp-automem was classified as ours — overwritable by setup, deletable by
  // uninstall.
  it('does not claim a foreign server whose env values merely mention mcp-automem', () => {
    expect(
      isAutoMemServerEntry({
        command: 'other-server',
        args: ['--start'],
        env: { UPSTREAM_URL: 'https://mcp-automem.internal', NOTE: 'talks to mcp-automem' },
      })
    ).toBe(false);
  });

  it('does not claim a foreign server whose args merely mention a similar host', () => {
    expect(
      isAutoMemServerEntry({ command: 'other', args: ['--url', 'https://mcp-automem.internal'] })
    ).toBe(false);
    // The version suffix must not open a hole for lookalike hostnames.
    expect(
      isAutoMemServerEntry({
        command: 'other',
        args: ['--url', 'https://mcp-automem.internal/v1', 'https://user@mcp-automem.example'],
      })
    ).toBe(false);
  });

  it('rejects non-entries', () => {
    expect(isAutoMemServerEntry(null)).toBe(false);
    expect(isAutoMemServerEntry('mcp-automem')).toBe(false);
    expect(isAutoMemServerEntry(['mcp-automem'])).toBe(false);
    expect(isAutoMemServerEntry({ command: 'other', args: ['--start'] })).toBe(false);
  });
});

describe('removeEnvContentKeys', () => {
  it('drops only the named keys, leaving comments and neighbours byte-identical', () => {
    const existing = ['# header', 'KEEP=1', 'AUTOMEM_API_KEY=secret', '', 'TRAILING=2'].join('\n');
    const result = removeEnvContentKeys(existing, ['AUTOMEM_API_KEY']);
    expect(result).not.toContain('AUTOMEM_API_KEY');
    expect(result).toContain('# header');
    expect(result).toContain('KEEP=1');
    expect(result).toContain('TRAILING=2');
  });

  it('removes every supported alias when both are present', () => {
    const existing = ['AUTOMEM_API_KEY=a', 'AUTOMEM_API_TOKEN=b', 'OTHER=c'].join('\n');
    const result = removeEnvContentKeys(existing, ['AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN']);
    expect(result).toBe(`OTHER=c${os.EOL}`);
  });

  it('is a no-op for an empty body or an empty key list', () => {
    expect(removeEnvContentKeys('', ['AUTOMEM_API_KEY'])).toBe('');
    expect(removeEnvContentKeys('KEEP=1', [])).toBe('KEEP=1');
  });
});

describe('parseEnvAssignment', () => {
  // The writers must recognise exactly what the dotenv-based readers accept. Missing
  // the `export` prefix meant a reader saw a stale key, asked for its removal, and the
  // remover silently kept the line — leaving the credential live against a new host.
  it.each([
    ['plain', 'AUTOMEM_API_KEY=secret', 'AUTOMEM_API_KEY', false],
    ['export-prefixed', 'export AUTOMEM_API_KEY=secret', 'AUTOMEM_API_KEY', true],
    ['indented export', '   export  AUTOMEM_API_KEY=secret', 'AUTOMEM_API_KEY', true],
    ['spaced equals', 'AUTOMEM_API_KEY = secret', 'AUTOMEM_API_KEY', false],
  ])('reads the key from a %s assignment', (_label, line, key, exported) => {
    expect(parseEnvAssignment(line)).toEqual({ key, exported });
  });

  it('returns undefined for comments and blank lines', () => {
    expect(parseEnvAssignment('# AUTOMEM_API_KEY=secret')).toBeUndefined();
    expect(parseEnvAssignment('   ')).toBeUndefined();
    expect(parseEnvAssignment('not an assignment')).toBeUndefined();
  });
});

describe('export-prefixed assignments in the writers', () => {
  it('removeEnvContentKeys drops an export-prefixed credential', () => {
    const body = 'export AUTOMEM_API_URL=https://old.test\nexport AUTOMEM_API_KEY=sk-old\nKEEP=1\n';
    const result = removeEnvContentKeys(body, ['AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN']);
    expect(result).not.toContain('sk-old');
    expect(result).toContain('KEEP=1');
    expect(result).toContain('export AUTOMEM_API_URL=https://old.test');
  });

  it('mergeEnvContent rewrites an export-prefixed line in place, prefix intact', () => {
    const body = 'export AUTOMEM_API_URL=https://old.test\n';
    const result = mergeEnvContent(body, { AUTOMEM_API_URL: 'https://new.test' });
    expect(result).toContain('export AUTOMEM_API_URL=https://new.test');
    // Rewritten, not appended — a second assignment would leave the old host named.
    expect(result).not.toContain('https://old.test');
    expect(result.match(/AUTOMEM_API_URL=/g)).toHaveLength(1);
  });
});

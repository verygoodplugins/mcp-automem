import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml } from 'smol-toml';
import {
  buildGrokAutoMemServerEntry,
  readExistingGrokCredentials,
  removeGrokMemoryServer,
  resolveGrokPaths,
  upsertGrokMemoryServer,
} from './grok-config.js';

describe('grok-config', () => {
  let tmpDir: string;
  let originalGrokHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-config-'));
    originalGrokHome = process.env.GROK_HOME;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = originalGrokHome;
  });

  describe('resolveGrokPaths', () => {
    it('uses --dir when provided', () => {
      const p = resolveGrokPaths({ dir: '/custom/grok' });
      expect(p.home).toBe('/custom/grok');
      expect(p.configPath).toBe('/custom/grok/config.toml');
      expect(p.agentsPath).toBe('/custom/grok/AGENTS.md');
    });

    it('uses GROK_HOME when set', () => {
      process.env.GROK_HOME = '/env/grok';
      const p = resolveGrokPaths();
      expect(p.home).toBe('/env/grok');
    });

    it('falls back to ~/.grok', () => {
      delete process.env.GROK_HOME;
      const p = resolveGrokPaths();
      expect(p.home).toBe(path.join(os.homedir(), '.grok'));
    });
  });

  describe('buildGrokAutoMemServerEntry', () => {
    it('includes API key and process tag when key provided', () => {
      const entry = buildGrokAutoMemServerEntry('https://api.example.com', 'sk-test');
      expect(entry).toEqual({
        command: 'npx',
        args: ['-y', '@verygoodplugins/mcp-automem'],
        enabled: true,
        env: {
          AUTOMEM_API_URL: 'https://api.example.com',
          AUTOMEM_API_KEY: 'sk-test',
          AUTOMEM_PROCESS_TAG: 'grok:memory',
        },
      });
    });

    it('writes blank credential overrides when no key is provided', () => {
      const entry = buildGrokAutoMemServerEntry('https://api.example.com');
      // Blank, not absent: the host layers this env over its own, so an omitted
      // key leaves a shell-exported one inherited by the child. A blank shadows it
      // and reads as absent to the server.
      expect(entry.env.AUTOMEM_API_KEY).toBe('');
      expect(entry.env.AUTOMEM_API_TOKEN).toBe('');
      expect(entry.env.AUTOMEM_PROCESS_TAG).toBe('grok:memory');
    });
  });

  describe('upsertGrokMemoryServer', () => {
    it('creates a fresh config.toml when none exists', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const result = upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('http://127.0.0.1:8001', 'sk-x'),
        { quiet: true }
      );
      expect(result.method).toBe('toml');
      expect(result.changed).toBe(true);

      const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, { command: string; env: Record<string, string> }>;
      };
      expect(parsed.mcp_servers.memory.command).toBe('npx');
      expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('http://127.0.0.1:8001');
      expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-x');
    });

    it('preserves other servers and top-level keys when adding memory', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        [
          '[cli]',
          'installer = "internal"',
          '',
          '[mcp_servers.other]',
          'command = "bash"',
          'args = ["-c", "echo hi"]',
          '',
          '[mcp_servers.other.env]',
          'FOO = "bar"',
          '',
        ].join('\n')
      );

      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('http://127.0.0.1:8001'), {
        quiet: true,
      });

      const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
        cli: { installer: string };
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.cli.installer).toBe('internal');
      expect(parsed.mcp_servers.other).toBeDefined();
      expect(parsed.mcp_servers.memory).toBeDefined();
    });

    it('is idempotent — re-running returns changed: false', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const entry = buildGrokAutoMemServerEntry('http://127.0.0.1:8001', 'sk-x');

      const first = upsertGrokMemoryServer(configPath, entry, { quiet: true });
      expect(first.changed).toBe(true);

      const second = upsertGrokMemoryServer(configPath, entry, { quiet: true });
      expect(second.changed).toBe(false);
    });

    it('reports dry-run without writing', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const result = upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('http://127.0.0.1:8001'),
        { dryRun: true, quiet: true }
      );
      expect(result.method).toBe('dry-run');
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('surfaces a clear error for malformed TOML', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, 'mcp_servers = {memory = \n');
      expect(() =>
        upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('http://127.0.0.1:8001'), {
          quiet: true,
        })
      ).toThrow(/Failed to parse Grok config/);
    });

    it('reports whether a dry run would add or update the entry', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const entry = buildGrokAutoMemServerEntry('http://127.0.0.1:8001');

      upsertGrokMemoryServer(configPath, entry, { quiet: true });
      const before = fs.readFileSync(configPath, 'utf8');

      // Same entry: a dry run must report "unchanged", not a pending write.
      const unchanged = upsertGrokMemoryServer(configPath, entry, { dryRun: true, quiet: true });
      expect(unchanged.changed).toBe(false);
      expect(unchanged.method).toBe('dry-run');

      // Different entry: still no write, but it is a real pending change.
      const updated = upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('https://elsewhere.example'),
        { dryRun: true, quiet: true }
      );
      expect(updated.method).toBe('dry-run');
      expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
    });

    it('refuses to overwrite a non-AutoMem server named memory', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const original = [
        '[mcp_servers.memory]',
        'command = "some-other-memory-server"',
        'args = ["--serve"]',
        '',
      ].join('\n');
      fs.writeFileSync(configPath, original);

      expect(() =>
        upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://automem.example'), {
          quiet: true,
        })
      ).toThrow(/Refusing to overwrite/);

      // The user's server survives untouched.
      expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
    });

    it('surfaces the collision during a dry run rather than at write time', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        ['[mcp_servers.memory]', 'command = "some-other-memory-server"', ''].join('\n')
      );

      expect(() =>
        upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://automem.example'), {
          dryRun: true,
          quiet: true,
        })
      ).toThrow(/Refusing to overwrite/);
    });

    it('restricts the config to the owner when it carries an API key', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('https://automem.example', 'sk-secret'),
        { quiet: true }
      );
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    });

    it('tightens an existing world-readable config and its backup once a key is added', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      // Pre-existing config written without a key, at default permissions.
      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://automem.example'), {
        quiet: true,
      });
      fs.chmodSync(configPath, 0o644);

      upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('https://automem.example', 'sk-secret'),
        { quiet: true }
      );

      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
      // The backup holds the same file; if it were left 0644 the tightening is moot.
      const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('config.toml.bak'));
      expect(backups.length).toBeGreaterThan(0);
      for (const backup of backups) {
        expect(fs.statSync(path.join(tmpDir, backup)).mode & 0o777).toBe(0o600);
      }
    });

    it('tightens an unchanged config that already holds a key', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const entry = buildGrokAutoMemServerEntry('https://automem.example', 'sk-secret');
      upsertGrokMemoryServer(configPath, entry, { quiet: true });
      // Simulate a hand-written (or previously mis-permissioned) secret-bearing config.
      fs.chmodSync(configPath, 0o644);

      // Re-running with an identical entry writes nothing — but must still not leave a
      // world-readable credential behind.
      const result = upsertGrokMemoryServer(configPath, entry, { quiet: true });
      expect(result.changed).toBe(false);
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    });

    it('protects a backup that retains a key being removed from the entry', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('https://first.example', 'sk-old-host'),
        { quiet: true }
      );
      fs.chmodSync(configPath, 0o644);

      // Switching endpoints drops the key from the *new* entry, but the backup still
      // contains the old one.
      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://second.example'), {
        quiet: true,
      });

      const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('config.toml.bak'));
      expect(backups.length).toBeGreaterThan(0);
      for (const backup of backups) {
        const full = path.join(tmpDir, backup);
        expect(fs.readFileSync(full, 'utf8')).toContain('sk-old-host');
        expect(fs.statSync(full).mode & 0o777).toBe(0o600);
      }
    });

    it('leaves permissions alone when no API key is written', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://automem.example'), {
        quiet: true,
      });
      expect(fs.statSync(configPath).mode & 0o777).not.toBe(0o600);
    });

    it('fails the dry run on malformed TOML instead of deferring to the real run', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, 'mcp_servers = {memory = \n');
      expect(() =>
        upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('http://127.0.0.1:8001'), {
          dryRun: true,
          quiet: true,
        })
      ).toThrow(/Failed to parse Grok config/);
    });
  });

  // Grok configs are hand-maintained: comments, multi-line `"""` subagent instructions,
  // and array formatting all matter. A parse/stringify round-trip destroys them, so the
  // installer edits the AutoMem table as text and leaves every other byte alone.
  describe('hand-maintained config fidelity', () => {
    const HANDWRITTEN = [
      '# Grok configuration — hand maintained',
      'disabled_mcp_servers = [',
      '    "robinhood",',
      '    "wordpress",',
      ']',
      '',
      '[cli]',
      'installer = "internal" # keep the internal installer',
      '',
      '[subagents.personas.long-haul]',
      'description = "Long autonomous implementer"',
      'instructions = """',
      'You are executing authorized long-haul work.',
      'Do not claim done without verification commands.',
      '"""',
      '',
      '[mcp_servers.todoist]',
      'url = "https://ai.todoist.net/mcp"',
      '',
      '[mcp_servers.todoist.headers]',
      'Authorization = "Bearer redacted"',
      '',
    ].join('\n');

    /** Everything except the AutoMem table must survive byte-for-byte. */
    function withoutMemoryTable(source: string): string {
      return source.replace(/\[mcp_servers\.memory\][\s\S]*?(?=\n\[(?!mcp_servers\.memory)|$)/, '');
    }

    it('adds the AutoMem table without reformatting the rest of the file', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, HANDWRITTEN);

      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://automem.example'), {
        quiet: true,
      });
      const after = fs.readFileSync(configPath, 'utf8');

      expect(after).toContain('# Grok configuration — hand maintained');
      expect(after).toContain('installer = "internal" # keep the internal installer');
      expect(after).toContain('instructions = """');
      expect(after).toContain('You are executing authorized long-haul work.');
      expect(after).toContain('    "robinhood",');
      // The multi-line string must not have collapsed into an escaped one-liner.
      expect(after).not.toContain('\\n');

      const parsed = parseToml(after) as { mcp_servers: Record<string, unknown> };
      expect(parsed.mcp_servers.memory).toBeDefined();
      expect(parsed.mcp_servers.todoist).toBeDefined();
    });

    it('round-trips install then uninstall back to the original bytes', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, HANDWRITTEN);

      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://automem.example'), {
        quiet: true,
      });
      removeGrokMemoryServer(configPath, { quiet: true, onlyIfAutoMem: true });

      expect(fs.readFileSync(configPath, 'utf8')).toBe(HANDWRITTEN);
    });

    it('preserves the surrounding file when updating an existing AutoMem entry', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, HANDWRITTEN);

      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://first.example'), {
        quiet: true,
      });
      const afterFirst = fs.readFileSync(configPath, 'utf8');

      upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('https://second.example', 'sk-new'),
        { quiet: true }
      );
      const afterSecond = fs.readFileSync(configPath, 'utf8');

      expect(withoutMemoryTable(afterSecond)).toBe(withoutMemoryTable(afterFirst));
      const parsed = parseToml(afterSecond) as {
        mcp_servers: { memory: { env: Record<string, string> } };
      };
      expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://second.example');
      expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-new');
    });

    // The fixtures above all end up with the AutoMem table at EOF, where trailing-newline
    // normalization hides seam problems. A table with neighbours on both sides is the
    // shape a pre-existing install actually has.
    it('round-trips an AutoMem table that sits between two other tables', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const original = [
        '# top comment',
        '[cli]',
        'installer = "internal"',
        '',
        '[mcp_servers.memory]',
        'command = "npx"',
        'args = [ "-y", "@verygoodplugins/mcp-automem" ]',
        'enabled = true',
        '',
        '[mcp_servers.memory.env]',
        'AUTOMEM_API_URL = "https://old.example"',
        '',
        '[mcp_servers.other]',
        'command = "bash"',
        '',
      ].join('\n');
      fs.writeFileSync(configPath, original);

      // Updating in place must not disturb the neighbours...
      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://new.example'), {
        quiet: true,
      });
      const updated = fs.readFileSync(configPath, 'utf8');
      expect(updated).toContain('# top comment');
      expect(updated).toContain('[mcp_servers.other]');
      expect(updated).toContain('https://new.example');

      // ...and removing it must close the gap rather than leave a growing run of blanks.
      removeGrokMemoryServer(configPath, { quiet: true, onlyIfAutoMem: true });
      expect(fs.readFileSync(configPath, 'utf8')).toBe(
        [
          '# top comment',
          '[cli]',
          'installer = "internal"',
          '',
          '[mcp_servers.other]',
          'command = "bash"',
          '',
        ].join('\n')
      );
    });

    it('does not accumulate blank lines across repeated install/uninstall cycles', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      const original = [
        '[cli]',
        'installer = "internal"',
        '',
        '[mcp_servers.other]',
        'command = "bash"',
        '',
      ].join('\n');
      fs.writeFileSync(configPath, original);

      for (let i = 0; i < 3; i += 1) {
        upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('https://automem.example'), {
          quiet: true,
        });
        removeGrokMemoryServer(configPath, { quiet: true, onlyIfAutoMem: true });
      }

      expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
    });

    it('falls back to a full rewrite when the entry is an inline table', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      // Dotted/inline forms have no `[mcp_servers.memory]` header to splice. The entry
      // is AutoMem's own (hand-written in a form the installer does not emit), so this
      // exercises the rewrite fallback rather than the non-AutoMem refusal above.
      fs.writeFileSync(
        configPath,
        [
          '# leading comment',
          'mcp_servers.memory = { command = "npx", args = ["-y", "@verygoodplugins/mcp-automem"] }',
          '',
        ].join('\n')
      );

      const result = upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('https://automem.example'),
        { quiet: true }
      );

      expect(result.changed).toBe(true);
      const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: { memory: { env: Record<string, string> } };
      };
      expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://automem.example');
    });
  });

  describe('removeGrokMemoryServer', () => {
    it('protects the uninstall backup when the removed entry held a key', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      upsertGrokMemoryServer(
        configPath,
        buildGrokAutoMemServerEntry('https://automem.example', 'sk-uninstall'),
        { quiet: true }
      );
      fs.chmodSync(configPath, 0o644);

      removeGrokMemoryServer(configPath, { quiet: true, onlyIfAutoMem: true });

      const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('config.toml.bak'));
      const withKey = backups.filter((f) =>
        fs.readFileSync(path.join(tmpDir, f), 'utf8').includes('sk-uninstall')
      );
      expect(withKey.length).toBeGreaterThan(0);
      for (const backup of withKey) {
        expect(fs.statSync(path.join(tmpDir, backup)).mode & 0o777).toBe(0o600);
      }
    });

    it('removes AutoMem memory entry and leaves siblings intact', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      upsertGrokMemoryServer(configPath, buildGrokAutoMemServerEntry('http://127.0.0.1:8001'), {
        quiet: true,
      });
      const withOther = parseToml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, unknown>;
      };
      withOther.mcp_servers.other = { command: 'bash' };
      // Re-write via upsert path: write raw TOML with sibling
      fs.writeFileSync(
        configPath,
        [
          '[mcp_servers.memory]',
          'command = "npx"',
          'args = ["-y", "@verygoodplugins/mcp-automem"]',
          'enabled = true',
          '',
          '[mcp_servers.memory.env]',
          'AUTOMEM_API_URL = "http://127.0.0.1:8001"',
          'AUTOMEM_PROCESS_TAG = "grok:memory"',
          '',
          '[mcp_servers.other]',
          'command = "bash"',
          '',
        ].join('\n')
      );

      const changed = removeGrokMemoryServer(configPath, { quiet: true, onlyIfAutoMem: true });
      expect(changed).toBe(true);
      const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.mcp_servers.memory).toBeUndefined();
      expect(parsed.mcp_servers.other).toBeDefined();
    });

    it('returns false when the entry does not exist', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, ['[mcp_servers.other]', 'command = "bash"', ''].join('\n'));
      expect(removeGrokMemoryServer(configPath, { quiet: true })).toBe(false);
    });

    it('skips non-AutoMem memory entries when onlyIfAutoMem is set', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        ['[mcp_servers.memory]', 'command = "node"', 'args = ["./other-memory.js"]', ''].join('\n')
      );
      expect(removeGrokMemoryServer(configPath, { quiet: true, onlyIfAutoMem: true })).toBe(false);
      const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.mcp_servers.memory).toBeDefined();
    });
  });

  // The AutoMem service still accepts AUTOMEM_API_TOKEN (Railway template, SSE
  // sidecar, existing deploys), so every reader has to. Reading only the canonical
  // name turned a working authenticated install into an unauthenticated one on a
  // flagless re-run, and left a live token in a world-readable backup.
  describe('legacy AUTOMEM_API_TOKEN alias', () => {
    const writeLegacyConfig = (configPath: string): void => {
      fs.writeFileSync(
        configPath,
        [
          '[mcp_servers.memory]',
          'command = "npx"',
          'args = ["-y", "@verygoodplugins/mcp-automem"]',
          'enabled = true',
          '',
          '[mcp_servers.memory.env]',
          'AUTOMEM_API_URL = "https://legacy.example.test"',
          'AUTOMEM_API_TOKEN = "sk-legacy"',
          '',
        ].join('\n')
      );
    };

    it('reads a token-authenticated entry and reports it under the canonical name', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      writeLegacyConfig(configPath);

      expect(readExistingGrokCredentials(configPath)).toEqual({
        endpoint: 'https://legacy.example.test',
        apiKey: 'sk-legacy',
      });
    });

    it('reads the deprecated AUTOMEM_ENDPOINT alias as the endpoint', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        [
          '[mcp_servers.memory.env]',
          'AUTOMEM_ENDPOINT = "https://legacy.example.test"',
          'AUTOMEM_API_KEY = "sk-x"',
          '',
        ].join('\n')
      );

      expect(readExistingGrokCredentials(configPath).endpoint).toBe('https://legacy.example.test');
    });

    it('treats a token-bearing entry as secret-bearing when tightening the backup', () => {
      if (process.platform === 'win32') return;
      const configPath = path.join(tmpDir, 'config.toml');
      writeLegacyConfig(configPath);
      fs.chmodSync(configPath, 0o644);

      removeGrokMemoryServer(configPath, { quiet: true });

      const backup = fs
        .readdirSync(tmpDir)
        .filter((name) => name.startsWith('config.toml.bak'))
        .map((name) => path.join(tmpDir, name));
      expect(backup.length).toBeGreaterThan(0);
      for (const file of backup) {
        // The backup still holds the live token, so it must not stay world-readable.
        expect(fs.readFileSync(file, 'utf8')).toContain('sk-legacy');
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    });
  });

  // The ownership predicate used to serialize the whole entry — env values included —
  // and search it for "mcp-automem", so an unrelated server merely pointing at a host
  // with that name was overwritable by setup and deletable by uninstall.
  describe('foreign server ownership', () => {
    const foreign = [
      '[mcp_servers.memory]',
      'command = "other-server"',
      'args = ["--start"]',
      '',
      '[mcp_servers.memory.env]',
      'UPSTREAM_URL = "https://mcp-automem.internal"',
      '',
    ].join('\n');

    it('refuses to overwrite a foreign entry that merely mentions mcp-automem in env', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, foreign);

      expect(() =>
        upsertGrokMemoryServer(
          configPath,
          buildGrokAutoMemServerEntry('https://automem.example.test'),
          { quiet: true }
        )
      ).toThrow();
      expect(fs.readFileSync(configPath, 'utf8')).toBe(foreign);
    });

    it('leaves that foreign entry alone on uninstall', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(configPath, foreign);

      removeGrokMemoryServer(configPath, { quiet: true, onlyIfAutoMem: true });

      expect(fs.readFileSync(configPath, 'utf8')).toBe(foreign);
    });
  });
});

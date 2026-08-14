import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml } from 'smol-toml';
import {
  buildGrokAutoMemServerEntry,
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

    it('omits the API key when not provided', () => {
      const entry = buildGrokAutoMemServerEntry('https://api.example.com');
      expect(entry.env).not.toHaveProperty('AUTOMEM_API_KEY');
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

    it('falls back to a full rewrite when the entry is an inline table', () => {
      const configPath = path.join(tmpDir, 'config.toml');
      // Dotted/inline forms have no `[mcp_servers.memory]` header to splice.
      fs.writeFileSync(
        configPath,
        ['# leading comment', 'mcp_servers.memory = { command = "npx", enabled = true }', ''].join(
          '\n'
        )
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
});

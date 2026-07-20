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

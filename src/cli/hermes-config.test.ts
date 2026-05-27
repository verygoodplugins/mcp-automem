import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import {
  buildAutoMemServerEntry,
  detectHermesCliMcpAdd,
  removeMcpServerEntry,
  resolveHermesPaths,
  upsertMcpServer,
} from './hermes-config.js';

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(() => {
      throw new Error('mocked: hermes binary not available');
    }),
  };
});

describe('hermes-config', () => {
  let tmpDir: string;
  let originalHermesHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-config-'));
    originalHermesHome = process.env.HERMES_HOME;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
    vi.clearAllMocks();
  });

  describe('resolveHermesPaths', () => {
    it('uses --dir when provided', () => {
      const p = resolveHermesPaths({ dir: '/custom/hermes' });
      expect(p.home).toBe('/custom/hermes');
      expect(p.configPath).toBe('/custom/hermes/config.yaml');
      expect(p.agentsPath).toBe('/custom/hermes/AGENTS.md');
    });

    it('uses HERMES_HOME when set', () => {
      process.env.HERMES_HOME = '/env/hermes';
      const p = resolveHermesPaths();
      expect(p.home).toBe('/env/hermes');
    });

    it('falls back to ~/.hermes', () => {
      delete process.env.HERMES_HOME;
      const p = resolveHermesPaths();
      expect(p.home).toBe(path.join(os.homedir(), '.hermes'));
    });
  });

  describe('buildAutoMemServerEntry', () => {
    it('includes the API key when provided', () => {
      const entry = buildAutoMemServerEntry('https://api.example.com', 'sk-test');
      expect(entry).toEqual({
        command: 'npx',
        args: ['-y', '@verygoodplugins/mcp-automem'],
        env: {
          AUTOMEM_API_URL: 'https://api.example.com',
          AUTOMEM_API_KEY: 'sk-test',
        },
      });
    });

    it('omits the API key when not provided', () => {
      const entry = buildAutoMemServerEntry('https://api.example.com');
      expect(entry.env).not.toHaveProperty('AUTOMEM_API_KEY');
    });
  });

  describe('detectHermesCliMcpAdd', () => {
    it('returns false when the binary is unavailable (mocked)', () => {
      expect(detectHermesCliMcpAdd()).toBe(false);
    });
  });

  describe('upsertMcpServer (YAML fallback path)', () => {
    it('creates a fresh config.yaml when none exists', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      const result = await upsertMcpServer(
        { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') },
        'memory',
        buildAutoMemServerEntry('http://127.0.0.1:8001', 'sk-x'),
        { quiet: true },
      );
      expect(result.method).toBe('yaml-fallback');
      expect(result.changed).toBe(true);

      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, { command: string; env: Record<string, string> }>;
      };
      expect(parsed.mcp_servers.memory.command).toBe('npx');
      expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('http://127.0.0.1:8001');
    });

    it('preserves other servers and top-level keys when adding memory', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(
        configPath,
        [
          '# Hermes config — this comment must survive round-trip',
          'model: claude-opus',
          'mcp_servers:',
          '  other:',
          '    command: bash',
          '    args:',
          '      - -c',
          '      - echo hi',
          '',
        ].join('\n'),
      );

      await upsertMcpServer(
        { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') },
        'memory',
        buildAutoMemServerEntry('http://127.0.0.1:8001'),
        { quiet: true },
      );

      const finalText = fs.readFileSync(configPath, 'utf8');
      expect(finalText).toContain('# Hermes config — this comment must survive round-trip');
      const parsed = parseYaml(finalText) as {
        model: string;
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.model).toBe('claude-opus');
      expect(parsed.mcp_servers.other).toBeDefined();
      expect(parsed.mcp_servers.memory).toBeDefined();
    });

    it('is idempotent — re-running returns changed: false', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      const entry = buildAutoMemServerEntry('http://127.0.0.1:8001', 'sk-x');
      const paths = { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') };

      const first = await upsertMcpServer(paths, 'memory', entry, { quiet: true });
      expect(first.changed).toBe(true);

      const second = await upsertMcpServer(paths, 'memory', entry, { quiet: true });
      expect(second.changed).toBe(false);
    });

    it('reports dry-run without writing', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      const result = await upsertMcpServer(
        { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') },
        'memory',
        buildAutoMemServerEntry('http://127.0.0.1:8001'),
        { dryRun: true, quiet: true },
      );
      expect(result.method).toBe('dry-run');
      expect(fs.existsSync(configPath)).toBe(false);
    });
  });

  describe('removeMcpServerEntry', () => {
    it('removes the named entry and leaves siblings intact', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(
        configPath,
        [
          'mcp_servers:',
          '  memory:',
          '    command: npx',
          '    args: ["-y", "@verygoodplugins/mcp-automem"]',
          '  other:',
          '    command: bash',
          '',
        ].join('\n'),
      );
      const changed = removeMcpServerEntry(configPath, 'memory', { quiet: true });
      expect(changed).toBe(true);
      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.mcp_servers.memory).toBeUndefined();
      expect(parsed.mcp_servers.other).toBeDefined();
    });

    it('returns false when the entry does not exist', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, 'mcp_servers:\n  other:\n    command: bash\n');
      expect(removeMcpServerEntry(configPath, 'memory', { quiet: true })).toBe(false);
    });
  });
});

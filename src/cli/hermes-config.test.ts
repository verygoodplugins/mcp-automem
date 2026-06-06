import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import {
  buildAutoMemServerEntry,
  readExistingHermesCredentials,
  removeHermesMemoryProvider,
  removeMcpServerEntry,
  resolveHermesPaths,
  upsertHermesMemoryProvider,
  upsertMcpServer,
} from './hermes-config.js';

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
        tools: {
          include: [
            'recall_memory',
            'store_memory',
            'associate_memories',
            'update_memory',
            'check_database_health',
          ],
          resources: false,
          prompts: false,
        },
        sampling: {
          enabled: false,
        },
      });
    });

    it('omits the API key when not provided', () => {
      const entry = buildAutoMemServerEntry('https://api.example.com');
      expect(entry.env).not.toHaveProperty('AUTOMEM_API_KEY');
    });
  });

  describe('upsertMcpServer', () => {
    it('creates a fresh config.yaml when none exists', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      const result = await upsertMcpServer(
        { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') },
        'automem',
        buildAutoMemServerEntry('http://127.0.0.1:8001', 'sk-x'),
        { quiet: true },
      );
      expect(result.method).toBe('yaml');
      expect(result.changed).toBe(true);

      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, { command: string; env: Record<string, string> }>;
      };
      expect(parsed.mcp_servers.automem.command).toBe('npx');
      expect(parsed.mcp_servers.automem.env.AUTOMEM_API_URL).toBe('http://127.0.0.1:8001');
      expect(parsed.mcp_servers.memory).toBeUndefined();
    });

    it('preserves other servers and top-level keys when adding automem', async () => {
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
        'automem',
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
      expect(parsed.mcp_servers.automem).toBeDefined();
      expect(parsed.mcp_servers.memory).toBeUndefined();
    });

    it('is idempotent — re-running returns changed: false', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      const entry = buildAutoMemServerEntry('http://127.0.0.1:8001', 'sk-x');
      const paths = { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') };

      const first = await upsertMcpServer(paths, 'automem', entry, { quiet: true });
      expect(first.changed).toBe(true);

      const second = await upsertMcpServer(paths, 'automem', entry, { quiet: true });
      expect(second.changed).toBe(false);
    });

    it('reports dry-run without writing', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      const result = await upsertMcpServer(
        { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') },
        'automem',
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
          '  automem:',
          '    command: npx',
          '    args: ["-y", "@verygoodplugins/mcp-automem"]',
          '  other:',
          '    command: bash',
          '',
        ].join('\n'),
      );
      const changed = removeMcpServerEntry(configPath, 'automem', { quiet: true });
      expect(changed).toBe(true);
      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.mcp_servers.automem).toBeUndefined();
      expect(parsed.mcp_servers.other).toBeDefined();
    });

    it('returns false when the entry does not exist', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, 'mcp_servers:\n  other:\n    command: bash\n');
      expect(removeMcpServerEntry(configPath, 'automem', { quiet: true })).toBe(false);
    });

    it('can remove the pre-release memory entry when it points at AutoMem', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(
        configPath,
        [
          'mcp_servers:',
          '  memory:',
          '    command: npx',
          '    args:',
          '      - -y',
          '      - "@verygoodplugins/mcp-automem"',
          '  other:',
          '    command: bash',
          '',
        ].join('\n'),
      );

      expect(removeMcpServerEntry(configPath, 'memory', {
        quiet: true,
        onlyIfAutoMem: true,
      })).toBe(true);

      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.mcp_servers.memory).toBeUndefined();
      expect(parsed.mcp_servers.other).toBeDefined();
    });

    it('does not remove a non-AutoMem memory MCP entry when guarded', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(
        configPath,
        [
          'mcp_servers:',
          '  memory:',
          '    command: python',
          '    args:',
          '      - other-memory-server.py',
          '',
        ].join('\n'),
      );

      expect(removeMcpServerEntry(configPath, 'memory', {
        quiet: true,
        onlyIfAutoMem: true,
      })).toBe(false);

      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        mcp_servers: Record<string, unknown>;
      };
      expect(parsed.mcp_servers.memory).toBeDefined();
    });
  });

  describe('malformed config handling', () => {
    // An unterminated flow map — parseDocument collects this in doc.errors
    // rather than throwing, so the guard must inspect doc.errors.
    const MALFORMED = 'mcp_servers: {automem: \n';

    it('upsertMcpServer throws a file-scoped, fix-and-re-run error', async () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, MALFORMED);
      await expect(
        upsertMcpServer(
          { home: tmpDir, configPath, agentsPath: path.join(tmpDir, 'AGENTS.md') },
          'automem',
          buildAutoMemServerEntry('http://127.0.0.1:8001'),
          { quiet: true },
        ),
      ).rejects.toThrow(/Failed to parse Hermes config at .*config\.yaml.*Fix the YAML syntax and re-run/s);
    });

    it('removeMcpServerEntry throws on malformed YAML instead of corrupting it', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, MALFORMED);
      expect(() => removeMcpServerEntry(configPath, 'automem', { quiet: true })).toThrow(
        /Fix the YAML syntax and re-run/,
      );
    });
  });

  describe('readExistingHermesCredentials', () => {
    const paths = (dir: string) => ({
      home: dir,
      configPath: path.join(dir, 'config.yaml'),
      agentsPath: path.join(dir, 'AGENTS.md'),
    });

    it('reads endpoint + key from the mcp_servers.automem entry', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'config.yaml'),
        [
          'mcp_servers:',
          '  automem:',
          '    command: npx',
          '    env:',
          '      AUTOMEM_API_URL: https://remote.automem.test',
          '      AUTOMEM_API_KEY: sk-remote',
          '',
        ].join('\n'),
      );
      const creds = readExistingHermesCredentials(paths(tmpDir));
      expect(creds.endpoint).toBe('https://remote.automem.test');
      expect(creds.apiKey).toBe('sk-remote');
    });

    it('falls back to ~/.hermes/.env and strips quotes', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'AUTOMEM_API_URL=https://env.automem.test\nAUTOMEM_API_KEY="sk-env"\n',
      );
      const creds = readExistingHermesCredentials(paths(tmpDir));
      expect(creds.endpoint).toBe('https://env.automem.test');
      expect(creds.apiKey).toBe('sk-env');
    });

    it('prefers the config entry over .env when both are present', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'config.yaml'),
        [
          'mcp_servers:',
          '  automem:',
          '    env:',
          '      AUTOMEM_API_URL: https://config.automem.test',
          '      AUTOMEM_API_KEY: sk-config',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'AUTOMEM_API_URL=https://env.automem.test\nAUTOMEM_API_KEY=sk-env\n',
      );
      const creds = readExistingHermesCredentials(paths(tmpDir));
      expect(creds.endpoint).toBe('https://config.automem.test');
      expect(creds.apiKey).toBe('sk-config');
    });

    it('normalizes blank values to undefined so a ?? fallback fires', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'config.yaml'),
        [
          'mcp_servers:',
          '  automem:',
          '    env:',
          '      AUTOMEM_API_URL: ""',
          '      AUTOMEM_API_KEY: ""',
          '',
        ].join('\n'),
      );
      const creds = readExistingHermesCredentials(paths(tmpDir));
      expect(creds.endpoint).toBeUndefined();
      expect(creds.apiKey).toBeUndefined();
    });

    it('returns an empty object when nothing is installed', () => {
      expect(readExistingHermesCredentials(paths(tmpDir))).toEqual({});
    });

    it('does not throw on a malformed config — returns {}', () => {
      fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'mcp_servers: {automem: \n');
      expect(readExistingHermesCredentials(paths(tmpDir))).toEqual({});
    });
  });

  describe('Hermes memory provider config', () => {
    it('sets memory.provider without disturbing other config', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(
        configPath,
        [
          'model: claude-opus',
          'memory:',
          '  provider: ""',
          '',
        ].join('\n'),
      );

      expect(upsertHermesMemoryProvider(configPath, 'automem', { quiet: true })).toBe(true);

      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        model: string;
        memory: { provider: string };
      };
      expect(parsed.model).toBe('claude-opus');
      expect(parsed.memory.provider).toBe('automem');
    });

    it('clears memory.provider only when AutoMem owns it', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, 'memory:\n  provider: automem\n');

      expect(removeHermesMemoryProvider(configPath, 'automem', { quiet: true })).toBe(true);

      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        memory: { provider: string };
      };
      expect(parsed.memory.provider).toBe('');
    });

    it('does not clear another Hermes memory provider', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, 'memory:\n  provider: supermemory\n');

      expect(removeHermesMemoryProvider(configPath, 'automem', { quiet: true })).toBe(false);

      const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
        memory: { provider: string };
      };
      expect(parsed.memory.provider).toBe('supermemory');
    });
  });
});

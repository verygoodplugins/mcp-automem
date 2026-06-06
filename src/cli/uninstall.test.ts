import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { runUninstall } from './uninstall.js';

describe('uninstall hermes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-uninstall-hermes-'));
    fs.mkdirSync(path.join(tmpDir, 'plugins', 'automem'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePreReleaseHermesState(): void {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      [
        'model:',
        '  provider: anthropic',
        'memory:',
        '  provider: automem',
        'mcp_servers:',
        '  memory:',
        '    command: npx',
        '    args:',
        '      - -y',
        '      - "@verygoodplugins/mcp-automem"',
        '  automem:',
        '    command: npx',
        '    args:',
        '      - -y',
        '      - "@verygoodplugins/mcp-automem"',
        '  other:',
        '    command: bash',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      [
        'AUTOMEM_API_URL=https://automem.example.test',
        'AUTOMEM_API_KEY=sk-test',
        'AUTOMEM_API_TOKEN=token-test',
        'AUTOMEM_HERMES_PROVIDER_TOOLS=true',
        'KEEP_ME=1',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'AGENTS.md'),
      [
        '# Hermes',
        '',
        '<!-- BEGIN AUTOMEM HERMES RULES -->',
        'AutoMem managed rules',
        '<!-- END AUTOMEM HERMES RULES -->',
        '',
        'keep this',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(tmpDir, 'plugins', 'automem', 'plugin.yaml'), 'name: automem\n');
  }

  it('removes clean and pre-release Hermes AutoMem surfaces', async () => {
    writePreReleaseHermesState();

    await runUninstall({
      platform: 'hermes',
      projectDir: tmpDir,
      yes: true,
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      memory?: { provider?: string };
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.memory?.provider).not.toBe('automem');
    expect(parsed.mcp_servers.memory).toBeUndefined();
    expect(parsed.mcp_servers.automem).toBeUndefined();
    expect(parsed.mcp_servers.other).toBeDefined();

    const envText = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    expect(envText).toBe('KEEP_ME=1\n');
    expect(fs.existsSync(path.join(tmpDir, 'plugins', 'automem'))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).toContain('keep this');
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).not.toContain(
      'BEGIN AUTOMEM HERMES RULES'
    );
  });

  it('does not remove a non-AutoMem memory MCP server', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      [
        'mcp_servers:',
        '  memory:',
        '    command: python',
        '    args:',
        '      - other-memory-server.py',
        '',
      ].join('\n'),
    );

    await runUninstall({
      platform: 'hermes',
      projectDir: tmpDir,
      yes: true,
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.mcp_servers.memory).toBeDefined();
  });

  it('honors dry-run without changing Hermes files', async () => {
    writePreReleaseHermesState();
    const beforeConfig = fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8');
    const beforeEnv = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    const beforeAgents = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');

    await runUninstall({
      platform: 'hermes',
      projectDir: tmpDir,
      yes: true,
      dryRun: true,
      quiet: true,
    });

    expect(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')).toBe(beforeConfig);
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')).toBe(beforeEnv);
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).toBe(beforeAgents);
    expect(fs.existsSync(path.join(tmpDir, 'plugins', 'automem'))).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { removeManagedHookEntries } from './claude-code.js';
import { parseUninstallArgs, runUninstall } from './uninstall.js';

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
        'AUTOMEM_ENDPOINT=https://legacy.example.test',
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

  it('strips the AutoMem block from a custom --rules file and leaves AGENTS.md alone', async () => {
    const customRules = path.join(tmpDir, 'CUSTOM_RULES.md');
    fs.writeFileSync(
      customRules,
      [
        '# Custom',
        '',
        '<!-- BEGIN AUTOMEM HERMES RULES -->',
        'AutoMem managed rules',
        '<!-- END AUTOMEM HERMES RULES -->',
        '',
        'keep this custom',
        '',
      ].join('\n'),
    );
    // A default AGENTS.md with its own block must be untouched when --rules redirects.
    fs.writeFileSync(
      path.join(tmpDir, 'AGENTS.md'),
      [
        '<!-- BEGIN AUTOMEM HERMES RULES -->',
        'should NOT be touched',
        '<!-- END AUTOMEM HERMES RULES -->',
        '',
      ].join('\n'),
    );

    await runUninstall({
      platform: 'hermes',
      projectDir: tmpDir,
      rulesPath: customRules,
      yes: true,
      quiet: true,
    });

    const custom = fs.readFileSync(customRules, 'utf8');
    expect(custom).toContain('keep this custom');
    expect(custom).not.toContain('BEGIN AUTOMEM HERMES RULES');
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).toContain(
      'should NOT be touched'
    );
  });

  it('maps --rules <path> to options.rulesPath', () => {
    const options = parseUninstallArgs(['hermes', '--rules', '/custom/AGENTS.md']);
    expect(options).toMatchObject({ platform: 'hermes', rulesPath: '/custom/AGENTS.md' });
  });

  it('returns null when --rules has no path value', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(parseUninstallArgs(['hermes', '--rules'])).toBeNull();
      expect(errSpy).toHaveBeenCalledWith('Error: --rules requires a path value');
    } finally {
      errSpy.mockRestore();
    }
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

describe('removeManagedHookEntries', () => {
  const opts = { homeDir: '/Users/testuser', platform: 'darwin' as const };

  it('removes managed hooks across events, preserves foreign hooks, drops emptied events', () => {
    const hooks = {
      Stop: [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: 'bash "$HOME/.claude/scripts/queue-cleanup.sh"' },
            {
              type: 'command',
              command:
                'npx -y @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5',
            },
            { type: 'command', command: 'node "/Users/testuser/.claude/hooks/awtrix-event.js"' },
            {
              type: 'command',
              command:
                "bash -c 'CLAUDE_HOOK_TYPE=session_end bash \"$HOME/.claude/hooks/session-memory.sh\"'",
            },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: 'startup|clear',
          hooks: [
            { type: 'command', command: 'bash "$HOME/.claude/hooks/automem-session-start.sh"' },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: 'AskUserQuestion',
          hooks: [{ type: 'command', command: 'node "/Users/testuser/.claude/hooks/plan-autonomy.js"' }],
        },
      ],
    };

    const { hooks: cleaned, removedCount } = removeManagedHookEntries(hooks, opts);
    expect(removedCount).toBe(4);
    expect(cleaned.SessionStart).toBeUndefined();
    expect(cleaned.Stop).toHaveLength(1);
    expect(cleaned.Stop[0].hooks).toEqual([
      { type: 'command', command: 'node "/Users/testuser/.claude/hooks/awtrix-event.js"' },
    ]);
    expect(cleaned.PreToolUse).toEqual(hooks.PreToolUse);
  });

  it('returns zero removals for a config with no AutoMem hooks', () => {
    const hooks = {
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash /opt/user.sh' }] }],
    };
    const result = removeManagedHookEntries(hooks, opts);
    expect(result.removedCount).toBe(0);
    expect(result.hooks).toEqual(hooks);
  });
});

describe('uninstall claude-code', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-uninstall-cc-'));
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const settingsPath = () => path.join(tmpHome, '.claude', 'settings.json');

  function writeInstalledSettings(): void {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify(
        {
          permissions: {
            allow: ['mcp__memory__store_memory', 'mcp__memory__recall_memory', 'Bash(ls:*)'],
          },
          hooks: {
            Stop: [
              {
                matcher: '*',
                hooks: [
                  { type: 'command', command: 'bash "$HOME/.claude/scripts/queue-cleanup.sh"' },
                  {
                    type: 'command',
                    command:
                      'npx -y @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5',
                  },
                  { type: 'command', command: `node "${tmpHome}/.claude/hooks/awtrix-event.js"` },
                ],
              },
            ],
            SessionStart: [
              {
                matcher: 'startup|clear',
                hooks: [
                  { type: 'command', command: 'bash "$HOME/.claude/hooks/automem-session-start.sh"' },
                ],
              },
            ],
          },
        },
        null,
        2
      )
    );
  }

  it('removes managed hooks and MCP permissions, keeps foreign hooks, creates a backup', async () => {
    writeInstalledSettings();

    await runUninstall({ platform: 'claude-code', yes: true, quiet: true });

    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    expect(settings.permissions.allow).toEqual(['Bash(ls:*)']);
    expect(settings.hooks.SessionStart).toBeUndefined();
    expect(settings.hooks.Stop[0].hooks).toEqual([
      { type: 'command', command: `node "${tmpHome}/.claude/hooks/awtrix-event.js"` },
    ]);

    const backups = fs
      .readdirSync(path.join(tmpHome, '.claude'))
      .filter((name) => name.startsWith('settings.json.backup.'));
    expect(backups).toHaveLength(1);
  });

  it('honors dry-run without changing settings.json', async () => {
    writeInstalledSettings();
    const before = fs.readFileSync(settingsPath(), 'utf8');

    await runUninstall({ platform: 'claude-code', yes: true, dryRun: true, quiet: true });

    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(before);
  });
});

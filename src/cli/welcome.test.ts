import { describe, expect, it, vi } from 'vitest';
import { WELCOME_PROMPT, cursorWelcomeUrl, startWelcome, welcomeTargets } from './welcome.js';
import { parseInstallArgs, equivalentInstallCommand } from './install.js';

describe('optional AutoMem welcome', () => {
  it('makes the source, user control, actual memory operations and persistence clear', () => {
    expect(WELCOME_PROMPT).toContain('prepared by the AutoMem installer');
    expect(WELCOME_PROMPT).toMatch(/skip a question, stop the tour/);
    expect(WELCOME_PROMPT).toMatch(/one at a time/);
    expect(WELCOME_PROMPT).toMatch(/preferences, decisions, milestones, and corrections/);
    expect(WELCOME_PROMPT).toMatch(/actual memory tool name.*JSON preview/);
    expect(WELCOME_PROMPT).toMatch(/Don't invent tool calls, results, or relationships/);
    expect(WELCOME_PROMPT).toMatch(/same reachable service/);
    expect(WELCOME_PROMPT).toMatch(/Don't promise encryption, backups, universal sync/);
    expect(WELCOME_PROMPT).toMatch(/warm, reassuring see you later/);
  });

  it('offers every installed harness, using a copy fallback where interactive launch is unavailable', () => {
    const targets = welcomeTargets({
      clients: ['cursor', 'codex', 'claude-code', 'grok', 'openclaw', 'hermes'],
      platform: 'darwin',
      commandExists: (command) => command !== 'grok',
    });
    expect(targets.map(({ client, method }) => [client, method])).toEqual([
      ['cursor', 'cursor'],
      ['codex', 'terminal'],
      ['claude-code', 'terminal'],
      ['grok', 'copy'],
      ['openclaw', 'terminal'],
      ['hermes', 'copy'],
    ]);
    expect(
      welcomeTargets({ clients: ['codex'], platform: 'win32', commandExists: () => true })[0].method
    ).toBe('copy');
  });

  it('prefills Cursor using its prompt deeplink and routes to the selected workspace', () => {
    const url = new URL(cursorWelcomeUrl('/tmp/project with spaces'));
    expect(url.protocol).toBe('cursor:');
    expect(url.host).toBe('anysphere.cursor-deeplink');
    expect(url.pathname).toBe('/prompt');
    expect(url.searchParams.get('text')).toBe(WELCOME_PROMPT);
    expect(url.searchParams.get('workspace')).toBe('project with spaces');
    expect(url.toString().length).toBeLessThan(10_000);
    const runCommand = vi.fn(() => true);
    const result = startWelcome({
      target: welcomeTargets({ clients: ['cursor'] })[0],
      cwd: '/tmp/project with spaces',
      platform: 'darwin',
      runCommand,
    });
    expect(result.method).toBe('opened');
    expect(runCommand.mock.calls[0][0]).toBe('open');
    expect(result.message).toMatch(/review.*send/i);
  });

  it('passes a single user-visible initial prompt to interactive CLIs without auto-approval', () => {
    for (const client of ['codex', 'claude-code', 'grok', 'openclaw'] as const) {
      const target = welcomeTargets({
        clients: [client],
        platform: 'linux',
        commandExists: () => true,
      })[0];
      const runCommand = vi.fn(() => true);
      expect(
        startWelcome({ target, cwd: '/tmp/project', platform: 'linux', runCommand }).method
      ).toBe('finished');
      const [command, args, opts] = runCommand.mock.calls[0];
      expect(command).toBe(client === 'claude-code' ? 'claude' : client);
      expect(args).toEqual(
        client === 'openclaw' ? ['tui', '--message', WELCOME_PROMPT] : [WELCOME_PROMPT]
      );
      expect(opts).toMatchObject({ interactive: true, cwd: '/tmp/project' });
      expect(args).not.toContain('--deliver');
      expect(args).not.toContain('--yolo');
    }
  });

  it('does not pass installer credentials to the welcome launcher', () => {
    const target = welcomeTargets({
      clients: ['codex'],
      platform: 'darwin',
      commandExists: () => true,
    })[0];
    const runCommand = vi.fn(() => true);
    startWelcome({
      target,
      cwd: '/tmp/project',
      platform: 'darwin',
      runCommand,
      clearCredentials: true,
      env: {
        PATH: '/bin',
        AUTOMEM_API_KEY: 'test-key',
        AUTOMEM_API_TOKEN: 'test-token',
        CLAUDE_PLUGIN_OPTION_API_KEY: 'plugin-test-key',
        OTHER_SETTING: 'kept',
      },
    });
    expect(runCommand.mock.calls[0][2].env).toEqual({ PATH: '/bin', OTHER_SETTING: 'kept' });
    const manualRun = vi.fn(() => true);
    startWelcome({
      target,
      cwd: '/tmp/project',
      platform: 'darwin',
      runCommand: manualRun,
      env: { AUTOMEM_API_KEY: 'manual-test-key' },
    });
    expect(manualRun.mock.calls[0][2].env?.AUTOMEM_API_KEY).toBe('manual-test-key');
    // Claude Code can intentionally authenticate its plugin through this env var.
    const claude = welcomeTargets({
      clients: ['claude-code'],
      platform: 'darwin',
      commandExists: () => true,
    })[0];
    const claudeRun = vi.fn(() => true);
    startWelcome({
      target: claude,
      cwd: '/tmp/project',
      platform: 'darwin',
      runCommand: claudeRun,
      env: { AUTOMEM_API_KEY: 'claude-test-key' },
    });
    expect(claudeRun.mock.calls[0][2].env?.AUTOMEM_API_KEY).toBe('claude-test-key');
  });

  it('falls back to the clipboard, then to a printable prompt when opening fails', () => {
    const target = welcomeTargets({ clients: ['cursor'] })[0];
    const copy = vi.fn((command: string) => command === 'pbcopy');
    expect(
      startWelcome({ target, cwd: '/tmp/project', platform: 'darwin', runCommand: copy }).method
    ).toBe('copied');
    expect(copy.mock.calls.map(([command]) => command)).toEqual(['open', 'pbcopy']);
    const none = vi.fn(() => false);
    const result = startWelcome({
      target,
      cwd: '/tmp/project',
      platform: 'darwin',
      runCommand: none,
    });
    expect(result.method).toBe('printed');
    expect(result.prompt).toBe(WELCOME_PROMPT);
  });

  it('allows a scriptable opt-out and preserves it in retry instructions', () => {
    expect(parseInstallArgs(['--no-welcome'], {}).noWelcome).toBe(true);
    expect(parseInstallArgs([], { AUTOMEM_NO_WELCOME: '1' }).noWelcome).toBe(true);
    expect(parseInstallArgs([], {}).noWelcome).toBeUndefined();
    expect(
      equivalentInstallCommand({
        target: 'existing',
        clients: ['cursor'],
        noWelcome: true,
        apiKeyProvided: false,
      })
    ).toContain('--no-welcome');
  });
});

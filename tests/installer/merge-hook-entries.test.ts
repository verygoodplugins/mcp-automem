/**
 * Tests for the installer's hook-entry merge and migration logic
 * (src/cli/claude-code.ts).
 *
 * Motivating bug: a user's settings.json ended up with two SessionStart
 * entries running the same script — one spelled with `$HOME`, one with the
 * absolute path. The old merge compared commands by exact string equality,
 * so path-variant duplicates slipped through and the session-start prompt
 * fired twice. The merge now compares normalized commands (home-directory
 * spellings expanded, quotes stripped) plus an AutoMem-owned script-basename
 * secondary key, self-repairs existing duplicates, and migrates managed
 * hooks when the template moves them under a new matcher.
 */

import os from 'os';
import { describe, expect, it } from 'vitest';
import {
  mergeHookEntries,
  mergeSettings,
  migrateManagedHookEntries,
  normalizeHookCommand,
} from '../../src/cli/claude-code.js';

const HOME = '/Users/testuser';

function hook(command: string) {
  return { type: 'command', command };
}

describe('normalizeHookCommand', () => {
  it('expands $HOME, ${HOME}, %USERPROFILE%, and leading ~/ to the home directory', () => {
    const expected = `bash ${HOME}/.claude/hooks/automem-session-start.sh`;
    const variants = [
      'bash "$HOME/.claude/hooks/automem-session-start.sh"',
      'bash "${HOME}/.claude/hooks/automem-session-start.sh"',
      'bash %USERPROFILE%/.claude/hooks/automem-session-start.sh',
      'bash ~/.claude/hooks/automem-session-start.sh',
      `bash "${HOME}/.claude/hooks/automem-session-start.sh"`,
    ];
    for (const variant of variants) {
      expect(normalizeHookCommand(variant, { homeDir: HOME, platform: 'darwin' })).toBe(expected);
    }
  });

  it('does not expand $HOMEPAGE or other env vars', () => {
    const normalized = normalizeHookCommand('echo $HOMEPAGE ${CLAUDE_PLUGIN_ROOT}/x.sh', {
      homeDir: HOME,
      platform: 'darwin',
    });
    expect(normalized).toContain('$HOMEPAGE');
    expect(normalized).toContain('${CLAUDE_PLUGIN_ROOT}/x.sh');
  });

  it('collapses whitespace and strips quotes', () => {
    expect(
      normalizeHookCommand('  bash   "/opt/x.sh"  ', { homeDir: HOME, platform: 'darwin' })
    ).toBe('bash /opt/x.sh');
  });

  it('normalizes separators and case on win32', () => {
    const a = normalizeHookCommand('bash "C:\\Users\\Test\\hooks\\X.sh"', {
      homeDir: 'C:\\Users\\Test',
      platform: 'win32',
    });
    const b = normalizeHookCommand('bash "%USERPROFILE%/hooks/x.sh"', {
      homeDir: 'C:\\Users\\Test',
      platform: 'win32',
    });
    expect(a).toBe(b);
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeHookCommand(undefined)).toBe('');
    expect(normalizeHookCommand(42)).toBe('');
  });
});

describe('mergeHookEntries', () => {
  const opts = { homeDir: HOME, platform: 'darwin' as const };

  it('dedupes $HOME / absolute-path / ~ variants of the same hook to one', () => {
    const existing = [
      { hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
      { hooks: [hook(`bash "${HOME}/.claude/hooks/automem-session-start.sh"`)] },
      { hooks: [hook('bash ~/.claude/hooks/automem-session-start.sh')] },
    ];
    const merged = mergeHookEntries(existing, [], opts);
    expect(merged).toHaveLength(1);
    expect(merged[0].hooks).toHaveLength(1);
  });

  it('self-repairs a pre-duplicated hook list within one entry', () => {
    const existing = [
      {
        hooks: [
          hook('bash "$HOME/.claude/hooks/automem-session-start.sh"'),
          hook(`bash ${HOME}/.claude/hooks/automem-session-start.sh`),
        ],
      },
    ];
    const merged = mergeHookEntries(existing, [], opts);
    expect(merged[0].hooks).toHaveLength(1);
  });

  it('does not add a template hook that already exists under a path variant', () => {
    const existing = [
      { hooks: [hook(`bash "${HOME}/.claude/hooks/automem-session-start.sh"`)] },
    ];
    const template = [
      { hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
    ];
    const merged = mergeHookEntries(existing, template, opts);
    expect(merged).toHaveLength(1);
    expect(merged[0].hooks).toHaveLength(1);
  });

  it('dedupes bash -c wrapper variants via the managed script basename', () => {
    const existing = [
      {
        hooks: [
          hook("bash -c 'CLAUDE_HOOK_TYPE=session_end bash \"$HOME/.claude/hooks/session-memory.sh\"'"),
        ],
        matcher: '*',
      },
    ];
    const template = [
      { matcher: '*', hooks: [hook(`bash "${HOME}/.claude/hooks/session-memory.sh"`)] },
    ];
    const merged = mergeHookEntries(existing, template, opts);
    expect(merged).toHaveLength(1);
    expect(merged[0].hooks).toHaveLength(1);
  });

  it('keeps hooks under different matchers separate', () => {
    const existing = [
      { matcher: 'startup', hooks: [hook('bash /opt/custom.sh')] },
      { matcher: 'resume', hooks: [hook('bash /opt/custom.sh')] },
    ];
    const merged = mergeHookEntries(existing, [], opts);
    expect(merged).toHaveLength(2);
  });

  it('preserves user hooks and appends template hooks under a new matcher', () => {
    const existing = [{ matcher: '*', hooks: [hook('bash /opt/user-hook.sh')] }];
    const template = [
      { matcher: 'startup|clear', hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
    ];
    const merged = mergeHookEntries(existing, template, opts);
    expect(merged).toHaveLength(2);
    expect(merged[0].hooks[0].command).toBe('bash /opt/user-hook.sh');
    expect(merged[1].matcher).toBe('startup|clear');
  });
});

describe('migrateManagedHookEntries', () => {
  const opts = { homeDir: HOME, platform: 'darwin' as const };

  it('removes a managed hook from a matcher-less entry when the template moves it', () => {
    const existing = [
      { hooks: [hook(`bash "${HOME}/.claude/hooks/automem-session-start.sh"`)] },
    ];
    const template = [
      { matcher: 'startup|clear', hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
    ];
    const migrated = migrateManagedHookEntries(existing, template, opts);
    expect(migrated).toHaveLength(0);
  });

  it('keeps user hooks in an entry that loses its managed hook', () => {
    const existing = [
      {
        hooks: [
          hook('bash /opt/user-hook.sh'),
          hook('bash "$HOME/.claude/hooks/automem-session-start.sh"'),
        ],
      },
    ];
    const template = [
      { matcher: 'startup|clear', hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
    ];
    const migrated = migrateManagedHookEntries(existing, template, opts);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].hooks).toEqual([hook('bash /opt/user-hook.sh')]);
  });

  it('leaves entries alone when the matcher already matches the template', () => {
    const existing = [
      {
        matcher: 'startup|clear',
        hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')],
      },
    ];
    const template = [
      { matcher: 'startup|clear', hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
    ];
    expect(migrateManagedHookEntries(existing, template, opts)).toEqual(existing);
  });

  it('does not touch unmanaged user hooks under any matcher', () => {
    const existing = [{ hooks: [hook('bash /opt/user-session-banner.sh')] }];
    const template = [
      { matcher: 'startup|clear', hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
    ];
    expect(migrateManagedHookEntries(existing, template, opts)).toEqual(existing);
  });
});

describe('mergeSettings (SessionStart matcher migration end-to-end)', () => {
  // mergeSettings uses the real os.homedir(); spell existing hooks with both
  // $HOME and the literal home dir to mirror the observed double-fire bug.
  const home = os.homedir();

  const template = {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|clear',
          hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')],
        },
      ],
    },
    permissions: { allow: [], deny: [], ask: [] },
  };

  it('collapses duplicate matcher-less entries into one gated entry', () => {
    const settings = {
      hooks: {
        SessionStart: [
          { hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
          { hooks: [hook(`bash "${home}/.claude/hooks/automem-session-start.sh"`)] },
        ],
      },
    };
    const merged = mergeSettings(settings, template);
    const sessionStart = merged.hooks.SessionStart;
    expect(sessionStart).toHaveLength(1);
    expect(sessionStart[0].matcher).toBe('startup|clear');
    expect(sessionStart[0].hooks).toHaveLength(1);
  });

  it('is idempotent on a second run', () => {
    const settings = {
      hooks: {
        SessionStart: [
          { hooks: [hook('bash "$HOME/.claude/hooks/automem-session-start.sh"')] },
          { hooks: [hook(`bash "${home}/.claude/hooks/automem-session-start.sh"`)] },
        ],
      },
    };
    const once = mergeSettings(settings, template);
    const twice = mergeSettings(JSON.parse(JSON.stringify(once)), template);
    expect(twice).toEqual(once);
  });

  it('preserves a user hook sharing the entry with the migrated automem hook', () => {
    const settings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              hook('bash /opt/user-session-banner.sh'),
              hook(`bash "${home}/.claude/hooks/automem-session-start.sh"`),
            ],
          },
        ],
      },
    };
    const merged = mergeSettings(settings, template);
    const sessionStart = merged.hooks.SessionStart;
    expect(sessionStart).toHaveLength(2);
    expect(sessionStart[0].hooks).toEqual([hook('bash /opt/user-session-banner.sh')]);
    expect(sessionStart[1].matcher).toBe('startup|clear');
    expect(sessionStart[1].hooks).toHaveLength(1);
  });
});

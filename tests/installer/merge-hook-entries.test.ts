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

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeLegacyHookCommands,
  mergeHookEntries,
  mergeSettings,
  migrateManagedHookEntries,
  normalizeHookCommand,
  removeManagedHookEntries,
  stripRetiredHookEntries,
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

  it('dedupes the bare-CLI and npx spellings of the queue drainer to one hook', () => {
    const existing = [
      {
        matcher: '*',
        hooks: [
          hook(
            `command -v mcp-automem >/dev/null 2>&1 && mcp-automem queue --file "${HOME}/.claude/scripts/memory-queue.jsonl" --limit 5 || true`
          ),
          hook(
            'npx -y @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5'
          ),
        ],
      },
    ];
    const merged = mergeHookEntries(existing, [], opts);
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

describe('stripRetiredHookEntries', () => {
  const opts = { homeDir: HOME, platform: 'darwin' as const };

  it.each([
    ['unwrapped env-prefix', 'CLAUDE_HOOK_TYPE=session_end bash "$HOME/.claude/hooks/session-memory.sh"'],
    ['bash -c wrapped', "bash -c 'CLAUDE_HOOK_TYPE=session_end bash \"$HOME/.claude/hooks/session-memory.sh\"'"],
    ['absolute path', `bash "${HOME}/.claude/hooks/session-memory.sh"`],
    ['tilde path', 'bash ~/.claude/hooks/session-memory.sh'],
    ['plugin form', "bash -c 'CLAUDE_HOOK_TYPE=session_end \"${CLAUDE_PLUGIN_ROOT}/scripts/session-memory.sh\"'"],
  ])('removes the retired session-memory hook spelled as %s', (_label, command) => {
    const existing = [
      {
        matcher: '*',
        hooks: [
          hook('bash "$HOME/.claude/hooks/automem-stop-nudge.sh"'),
          hook(command),
          hook(`node "${HOME}/.claude/hooks/awtrix-event.js"`),
        ],
      },
    ];
    const stripped = stripRetiredHookEntries(existing, opts);
    expect(stripped).toHaveLength(1);
    expect(stripped[0].hooks).toHaveLength(2);
    expect(
      stripped[0].hooks.map((h: { command: string }) => h.command).join(' ')
    ).not.toContain('session-memory.sh');
  });

  // The memory queue lost its last automatic writer when the capture hooks
  // retired, so the queue Stop machinery (cleanup script + npx drainer, in
  // every historical spelling) is retired too. The `mcp-automem queue` CLI
  // remains for manual drains.
  it.each([
    ['queue-cleanup script', 'bash "$HOME/.claude/scripts/queue-cleanup.sh"'],
    ['queue-cleanup absolute path', `bash "${HOME}/.claude/scripts/queue-cleanup.sh"`],
    ['queue-cleanup plugin form', '${CLAUDE_PLUGIN_ROOT}/scripts/queue-cleanup.sh'],
    ['npx drainer (no -y, no --limit)', 'npx @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl"'],
    ['npx drainer (no -y, --limit)', 'npx @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5'],
    ['npx drainer (canonical -y form)', 'npx -y @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5'],
    ['bare-CLI drainer', `command -v mcp-automem >/dev/null 2>&1 && mcp-automem queue --file "${HOME}/.claude/scripts/memory-queue.jsonl" --limit 5 || true`],
  ])('removes the retired queue hook spelled as %s', (_label, command) => {
    const existing = [
      {
        matcher: '*',
        hooks: [hook(command), hook(`node "${HOME}/.claude/hooks/awtrix-event.js"`)],
      },
    ];
    const stripped = stripRetiredHookEntries(existing, opts);
    expect(stripped).toHaveLength(1);
    expect(stripped[0].hooks).toEqual([hook(`node "${HOME}/.claude/hooks/awtrix-event.js"`)]);
  });

  it('drops an entry whose hooks all retired', () => {
    const existing = [
      {
        matcher: '*',
        hooks: [hook('bash "$HOME/.claude/hooks/session-memory.sh"')],
      },
    ];
    expect(stripRetiredHookEntries(existing, opts)).toHaveLength(0);
  });

  it('never touches non-AutoMem hooks', () => {
    const existing = [
      {
        matcher: '*',
        hooks: [
          hook(`node "${HOME}/.claude/hooks/awtrix-event.js"`),
          hook('bash /opt/my-own-session-memory-wrapper.sh'),
        ],
      },
    ];
    expect(stripRetiredHookEntries(existing, opts)).toEqual(existing);
  });

  it('does not strip the deliberately retained smart-notify.sh', () => {
    const existing = [
      { matcher: '*', hooks: [hook('bash "$HOME/.claude/scripts/smart-notify.sh"')] },
    ];
    expect(stripRetiredHookEntries(existing, opts)).toEqual(existing);
  });

  // The new hook basenames (stop-nudge.sh, track-store.sh) are generic enough
  // that a user could have an unrelated hook with the same name. A managed
  // basename only counts when the script lives under an AutoMem-owned path, so a
  // foreign script sharing a *retired* basename is never stripped either.
  it('leaves a foreign script that merely shares a retired basename', () => {
    const existing = [
      { matcher: '*', hooks: [hook('bash /opt/queue-cleanup.sh')] },
    ];
    expect(stripRetiredHookEntries(existing, opts)).toEqual(existing);
  });
});

describe('owned-path scoping for managed hooks', () => {
  const opts = { homeDir: HOME, platform: 'darwin' as const };

  it('removeManagedHookEntries removes the owned stop-nudge but keeps a foreign /opt/stop-nudge.sh', () => {
    const hooks = {
      Stop: [
        {
          matcher: '*',
          hooks: [
            hook(`bash "${HOME}/.claude/hooks/automem-stop-nudge.sh"`),
            hook('bash /opt/stop-nudge.sh'),
          ],
        },
      ],
    };
    const { hooks: cleaned, removedCount } = removeManagedHookEntries(hooks, opts);
    expect(removedCount).toBe(1);
    expect(cleaned.Stop[0].hooks).toEqual([hook('bash /opt/stop-nudge.sh')]);
  });

  it('treats the plugin ${CLAUDE_PLUGIN_ROOT}/scripts/ location as owned', () => {
    const hooks = {
      Stop: [
        { matcher: '*', hooks: [hook('${CLAUDE_PLUGIN_ROOT}/scripts/stop-nudge.sh')] },
      ],
    };
    const { removedCount } = removeManagedHookEntries(hooks, opts);
    expect(removedCount).toBe(1);
  });

  it('does not dedupe a foreign track-store.sh against the owned one', () => {
    const existing = [
      {
        matcher: '*',
        hooks: [
          hook(`bash "${HOME}/.claude/hooks/automem-track-store.sh"`),
          hook('bash /opt/track-store.sh'),
        ],
      },
    ];
    const merged = mergeHookEntries(existing, [], opts);
    expect(merged[0].hooks).toHaveLength(2);
  });
});

describe('canonicalizeLegacyHookCommands', () => {
  const opts = { homeDir: HOME, platform: 'darwin' as const };
  const TEMPLATE_DRAINER =
    'npx -y @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5';
  const template = [{ matcher: '*', hooks: [hook(TEMPLATE_DRAINER)] }];

  it('rewrites the bare-CLI drainer to the template spelling', () => {
    const existing = [
      {
        matcher: '*',
        hooks: [
          hook(
            `command -v mcp-automem >/dev/null 2>&1 && mcp-automem queue --file "${HOME}/.claude/scripts/memory-queue.jsonl" --limit 5 || true`
          ),
        ],
      },
    ];
    const result = canonicalizeLegacyHookCommands(existing, template, opts);
    expect(result[0].hooks[0].command).toBe(TEMPLATE_DRAINER);
  });

  it('rewrites the historical no-limit npx drainer to the template spelling', () => {
    const existing = [
      {
        matcher: '*',
        hooks: [
          hook('npx @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl"'),
        ],
      },
    ];
    const result = canonicalizeLegacyHookCommands(existing, template, opts);
    expect(result[0].hooks[0].command).toBe(TEMPLATE_DRAINER);
  });

  it('rewrites the unwrapped env-prefixed capture hook to the wrapped template spelling', () => {
    const wrapped =
      "bash -c 'CLAUDE_HOOK_TYPE=build bash \"$HOME/.claude/hooks/capture-build-result.sh\"'";
    const existing = [
      {
        matcher: 'Bash',
        hooks: [hook('CLAUDE_HOOK_TYPE=build bash "$HOME/.claude/hooks/capture-build-result.sh"')],
      },
    ];
    const result = canonicalizeLegacyHookCommands(
      existing,
      [{ matcher: 'Bash', hooks: [hook(wrapped)] }],
      opts
    );
    expect(result[0].hooks[0].command).toBe(wrapped);
  });

  it('leaves a user-customized drainer alone', () => {
    const custom =
      'npx -y @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 10';
    const existing = [{ matcher: '*', hooks: [hook(custom)] }];
    const result = canonicalizeLegacyHookCommands(existing, template, opts);
    expect(result[0].hooks[0].command).toBe(custom);
  });

  it('leaves foreign hooks alone', () => {
    const existing = [{ matcher: '*', hooks: [hook(`node "${HOME}/.claude/hooks/awtrix-event.js"`)] }];
    expect(canonicalizeLegacyHookCommands(existing, template, opts)).toEqual(existing);
  });
});

describe('mergeSettings (legacy Stop-hook migration end-to-end)', () => {
  // Fixture mirrors a real machine observed in the wild: retired session-memory
  // hook, BOTH queue-drainer spellings (the double-store bug), and a foreign
  // user hook that must survive untouched. mergeSettings uses the real
  // os.homedir(), so absolute-path spellings use it too.
  const home = os.homedir();
  const REPO_ROOT = path.resolve(__dirname, '../..');
  const realTemplate = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'templates/claude-code/settings.json'), 'utf8')
  );

  const liveStopFixture = () => ({
    hooks: {
      Stop: [
        {
          matcher: '*',
          hooks: [
            hook('bash "$HOME/.claude/scripts/queue-cleanup.sh"'),
            hook(
              `command -v mcp-automem >/dev/null 2>&1 && mcp-automem queue --file "${home}/.claude/scripts/memory-queue.jsonl" --limit 5 || true`
            ),
            hook(`node "${home}/.claude/hooks/awtrix-event.js"`),
            hook(
              "bash -c 'CLAUDE_HOOK_TYPE=session_end bash \"$HOME/.claude/hooks/session-memory.sh\"'"
            ),
            hook(
              'npx -y @verygoodplugins/mcp-automem queue --file "$HOME/.claude/scripts/memory-queue.jsonl" --limit 5'
            ),
          ],
        },
      ],
    },
  });

  it('migrates the real-machine Stop block: strips retired + queue hooks, keeps foreign hook, registers the nudge', () => {
    const merged = mergeSettings(liveStopFixture(), realTemplate);
    const stop = merged.hooks.Stop;
    expect(stop).toHaveLength(1);
    const commands = stop[0].hooks.map((h: { command: string }) => h.command);
    expect(commands.join(' ')).not.toContain('session-memory.sh');
    // The whole queue pipeline retired with the capture hooks: no cleanup
    // script, no drainer in any spelling.
    expect(commands.join(' ')).not.toContain('queue-cleanup.sh');
    expect(commands.filter((c: string) => /mcp-automem\s+queue|@verygoodplugins\/mcp-automem queue/.test(c))).toHaveLength(0);
    expect(commands).toContain(`node "${home}/.claude/hooks/awtrix-event.js"`);
    expect(commands).toContain('bash "$HOME/.claude/hooks/automem-stop-nudge.sh"');
  });

  it('is idempotent over the legacy fixture', () => {
    const once = mergeSettings(liveStopFixture(), realTemplate);
    const twice = mergeSettings(JSON.parse(JSON.stringify(once)), realTemplate);
    expect(twice).toEqual(once);
  });

  it('removes a retired hook stranded under an event the template no longer registers', () => {
    const settings = {
      hooks: {
        SubagentStop: [
          { matcher: '*', hooks: [hook('bash "$HOME/.claude/hooks/session-memory.sh"')] },
        ],
      },
    };
    const merged = mergeSettings(settings, realTemplate);
    expect(merged.hooks.SubagentStop).toBeUndefined();
  });

  // Mechanical build/test/deploy capture retired in favor of the LLM-judged
  // stop nudge: a pre-switch install (wrapped + legacy spellings) must come
  // out captureless with the nudge + tracker registered.
  it('strips retired capture hooks and registers the stop-nudge replacement', () => {
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              hook(
                "bash -c 'CLAUDE_HOOK_TYPE=build bash \"$HOME/.claude/hooks/capture-build-result.sh\"'"
              ),
              hook('CLAUDE_HOOK_TYPE=test_run bash "$HOME/.claude/hooks/capture-test-pattern.sh"'),
              hook(`bash "${home}/.claude/hooks/capture-deployment.sh"`),
              hook(`node "${home}/.claude/hooks/awtrix-event.js"`),
            ],
          },
        ],
        Stop: [{ matcher: '*', hooks: [hook('bash "$HOME/.claude/scripts/queue-cleanup.sh"')] }],
      },
    };
    const merged = mergeSettings(settings, realTemplate);

    const allCommands = Object.values(
      merged.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
    )
      .flat()
      .flatMap((entry) => entry.hooks.map((h) => h.command));
    expect(allCommands.join(' ')).not.toMatch(/capture-(build-result|test-pattern|deployment)/);
    // The queue Stop machinery retires alongside the capture hooks that fed it.
    expect(allCommands.join(' ')).not.toContain('queue-cleanup.sh');
    // Foreign user hook survives.
    expect(allCommands).toContain(`node "${home}/.claude/hooks/awtrix-event.js"`);
    // Replacement architecture is registered from the template.
    expect(allCommands).toContain('bash "$HOME/.claude/hooks/automem-stop-nudge.sh"');
    expect(allCommands).toContain('bash "$HOME/.claude/hooks/automem-track-store.sh"');
  });
});

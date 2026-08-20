import { afterEach, describe, expect, it } from 'vitest';
import {
  allowAutoMemTools,
  allowPluginWhenAllowlistExists,
  buildDefaultTags,
  buildMcporterConfig,
  buildPluginConfigEntry,
  buildSkillConfigEntry,
  disableBuiltInMemorySlot,
  disableMemoryCoreDreaming,
  disableSessionMemoryHook,
  enablePluginsCommand,
  enableSkipBootstrap,
  hasExplicitSkipBootstrap,
  hasOnboardingArtifacts,
  hydrateStartupProfile,
  isFreshOnboardingTarget,
  parseArgs,
  probeBootstrapBypass,
  redactConfigForOutput,
  replaceOpenClawMemorySystem,
  resolveApiKey,
} from './openclaw.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('openclaw cli helpers', () => {
  it('parses the new openclaw flags with plugin defaults', () => {
    expect(parseArgs([])).toMatchObject({
      mode: 'plugin',
      scope: 'workspace',
    });

    expect(
      parseArgs([
        '--mode',
        'mcp',
        '--scope',
        'shared',
        '--plugin-source',
        '../local-plugin',
        '--name',
        'Project X',
        '--replace-memory',
      ])
    ).toMatchObject({
      mode: 'mcp',
      scope: 'shared',
      pluginSource: '../local-plugin',
      projectName: 'Project X',
      replaceMemory: true,
    });
  });

  it('rejects invalid mode values', () => {
    expect(() => parseArgs(['--mode', 'nope'])).toThrow(/invalid --mode/i);
  });

  it('builds default tags from project names', () => {
    expect(buildDefaultTags('@scope/My Cool Project')).toEqual(['my-cool-project']);
    expect(buildDefaultTags('')).toEqual([]);
    expect(buildDefaultTags('api')).toEqual([]);
  });

  it('redacts sensitive output recursively', () => {
    const redacted = redactConfigForOutput({
      apiKey: 'secret-value',
      nested: {
        AUTOMEM_API_TOKEN: 'other-secret',
      },
      safe: 'visible',
    });

    expect(redacted).toEqual({
      apiKey: '<redacted>',
      nested: {
        AUTOMEM_API_TOKEN: '<redacted>',
      },
      safe: 'visible',
    });
  });

  it('builds plugin config entries with sane defaults', () => {
    expect(
      buildPluginConfigEntry({
        endpoint: 'http://localhost:8001',
        apiKey: 'top-secret',
        defaultTags: ['project-x'],
        startupProfile: '- [Preference] Call me Jack.',
      })
    ).toEqual({
      enabled: true,
      config: {
        endpoint: 'http://localhost:8001',
        apiKey: 'top-secret',
        autoRecall: true,
        exposure: 'dm-only',
        defaultTags: ['project-x'],
        startupProfile: '- [Preference] Call me Jack.',
      },
    });
  });

  it('preserves existing plugin recall settings while updating endpoint and tags', () => {
    expect(
      buildPluginConfigEntry({
        existing: {
          config: {
            endpoint: 'http://old-endpoint',
            autoRecall: false,
            autoRecallLimit: 8,
            preferenceRecallLimit: 20,
            contextRecallLimit: 30,
            debugRecallLimit: 20,
            contextRecallWindowDays: 90,
            exposure: 'all',
          },
        },
        endpoint: 'http://localhost:8001',
        defaultTags: ['project-x'],
      })
    ).toEqual({
      enabled: true,
      config: {
        endpoint: 'http://localhost:8001',
        autoRecall: false,
        autoRecallLimit: 8,
        preferenceRecallLimit: 20,
        contextRecallLimit: 30,
        debugRecallLimit: 20,
        contextRecallWindowDays: 90,
        exposure: 'all',
        defaultTags: ['project-x'],
      },
    });
  });

  it('builds skill config entries with runtime env injection', () => {
    expect(
      buildSkillConfigEntry({
        endpoint: 'https://memory.example',
        apiKey: 'top-secret',
        defaultTags: ['project-x'],
      })
    ).toEqual({
      enabled: true,
      apiKey: 'top-secret',
      env: {
        AUTOMEM_API_URL: 'https://memory.example',
        AUTOMEM_DEFAULT_TAGS: 'project-x',
      },
    });
  });

  it('builds mcporter config without embedding secrets', () => {
    const config = buildMcporterConfig({
      existing: {
        imports: ['./shared.json'],
        mcpServers: {
          automem: {
            command: 'npx',
            args: ['@verygoodplugins/mcp-automem'],
            env: {
              AUTOMEM_API_KEY: 'should-not-survive',
            },
          },
          other: {
            command: 'uvx',
            args: ['something-else'],
          },
        },
      },
    });

    expect(config).toEqual({
      imports: ['./shared.json'],
      mcpServers: {
        automem: {
          description: 'AutoMem memory service',
          command: 'npx',
          args: ['-y', '@verygoodplugins/mcp-automem'],
        },
        other: {
          command: 'uvx',
          args: ['something-else'],
        },
      },
    });
  });

  it('enables the /plugins chat command', () => {
    const config = {};
    enablePluginsCommand(config as never);
    expect(config).toEqual({
      commands: {
        plugins: true,
      },
    });
  });

  it('can disable OpenClaw built-in memory components for AutoMem-only mode', () => {
    const config = {};
    replaceOpenClawMemorySystem(config as never, { mode: 'plugin', scope: 'shared' });
    expect(config).toEqual({
      plugins: {
        slots: {
          memory: 'none',
        },
        entries: {
          'memory-core': {
            config: {
              dreaming: {
                enabled: false,
              },
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            'session-memory': {
              enabled: false,
            },
          },
        },
      },
    });
  });

  it('updates individual memory-core compatibility helpers without clobbering siblings', () => {
    const config = {
      plugins: {
        slots: {
          contextEngine: 'legacy',
        },
        entries: {
          'memory-core': {
            enabled: true,
            config: {
              dreaming: {
                enabled: true,
                frequency: '0 3 * * *',
              },
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            'command-logger': {
              enabled: true,
            },
          },
        },
      },
    };

    disableBuiltInMemorySlot(config as never);
    disableSessionMemoryHook(config as never);
    disableMemoryCoreDreaming(config as never);

    expect(config).toEqual({
      plugins: {
        slots: {
          contextEngine: 'legacy',
          memory: 'none',
        },
        entries: {
          'memory-core': {
            enabled: true,
            config: {
              dreaming: {
                enabled: false,
                frequency: '0 3 * * *',
              },
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            'command-logger': {
              enabled: true,
            },
            'session-memory': {
              enabled: false,
            },
          },
        },
      },
    });
  });

  it('adds automem to plugins.allow when an allowlist already exists', () => {
    const config = {
      plugins: {
        allow: ['anthropic', 'brave'],
      },
    };

    allowPluginWhenAllowlistExists(config as never, 'automem');

    expect(config).toEqual({
      plugins: {
        allow: ['anthropic', 'brave', 'automem'],
      },
    });
  });

  it('does not create a new plugins.allow gate when one was not already configured', () => {
    const config = {
      plugins: {
        entries: {
          anthropic: { enabled: true },
        },
      },
    };

    allowPluginWhenAllowlistExists(config as never, 'automem');

    expect(config).toEqual({
      plugins: {
        entries: {
          anthropic: { enabled: true },
        },
      },
    });
  });

  it('adds AutoMem tool names to tools.alsoAllow for additive plugin installs', () => {
    const config = {};

    allowAutoMemTools(config as never);

    expect(config).toEqual({
      tools: {
        alsoAllow: [
          'automem_store_memory',
          'automem_recall_memory',
          'automem_update_memory',
          'automem_delete_memory',
          'automem_associate_memories',
          'automem_check_health',
        ],
      },
    });
  });

  it('preserves an existing restrictive tools.allow policy while deduping AutoMem tool names', () => {
    const config = {
      tools: {
        profile: 'coding',
        allow: ['bash', 'automem_recall_memory'],
      },
    };

    allowAutoMemTools(config as never);

    expect(config).toEqual({
      tools: {
        profile: 'coding',
        allow: [
          'bash',
          'automem_recall_memory',
          'automem_store_memory',
          'automem_update_memory',
          'automem_delete_memory',
          'automem_associate_memories',
          'automem_check_health',
        ],
      },
    });
  });

  it('migrates legacy AutoMem-only tools.allow entries into tools.alsoAllow', () => {
    const config = {
      tools: {
        profile: 'coding',
        allow: ['automem_recall_memory', 'automem_store_memory'],
      },
    };

    allowAutoMemTools(config as never);

    expect(config).toEqual({
      tools: {
        profile: 'coding',
        alsoAllow: [
          'automem_store_memory',
          'automem_recall_memory',
          'automem_update_memory',
          'automem_delete_memory',
          'automem_associate_memories',
          'automem_check_health',
        ],
      },
    });
  });

  it('detects fresh onboarding targets from empty workspaces', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-openclaw-'));
    expect(hasOnboardingArtifacts(workspace)).toBe(false);
    expect(isFreshOnboardingTarget({}, workspace)).toBe(true);
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('does not treat a workspace with onboarding files as fresh', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-openclaw-'));
    fs.writeFileSync(path.join(workspace, 'USER.md'), 'Jack');
    expect(hasOnboardingArtifacts(workspace)).toBe(true);
    expect(isFreshOnboardingTarget({}, workspace)).toBe(false);
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('preserves explicit skipBootstrap config', () => {
    const config = {
      agents: {
        defaults: {
          skipBootstrap: false,
        },
      },
    };

    expect(hasExplicitSkipBootstrap(config as never)).toBe(true);
    expect(isFreshOnboardingTarget(config as never, null)).toBe(false);
  });

  it('enables skipBootstrap on config when requested', () => {
    const config = {};
    enableSkipBootstrap(config as never);
    expect(config).toEqual({
      agents: {
        defaults: {
          skipBootstrap: true,
        },
      },
    });
  });

  it('skips bootstrap when AutoMem is healthy and non-empty', async () => {
    const probe = await probeBootstrapBypass({
      checkHealth: async () => ({
        status: 'healthy',
        backend: 'automem',
        statistics: {},
      }),
      recallMemory: async () => ({
        results: [{ id: 'mem-1', memory: { content: 'Known profile' } }],
        count: 1,
      }),
    });

    expect(probe).toMatchObject({
      shouldSkipBootstrap: true,
      healthStatus: 'healthy',
      memoryCount: 1,
    });
  });

  it('leaves bootstrap enabled when AutoMem is healthy but empty', async () => {
    const probe = await probeBootstrapBypass({
      checkHealth: async () => ({
        status: 'healthy',
        backend: 'automem',
        statistics: {},
      }),
      recallMemory: async () => ({
        results: [],
        count: 0,
      }),
    });

    expect(probe).toMatchObject({
      shouldSkipBootstrap: false,
      healthStatus: 'healthy',
      memoryCount: 0,
    });
  });

  it('leaves bootstrap enabled when AutoMem health fails', async () => {
    const probe = await probeBootstrapBypass({
      checkHealth: async () => ({
        status: 'error',
        backend: 'automem',
        statistics: {},
        error: 'down',
      }),
      recallMemory: async () => ({
        results: [{ id: 'mem-1', memory: { content: 'should not be read' } }],
        count: 1,
      }),
    });

    expect(probe).toMatchObject({
      shouldSkipBootstrap: false,
      healthStatus: 'error',
    });
  });

  it('hydrates a startup profile from recalled identity cues', async () => {
    const profile = await hydrateStartupProfile({
      checkHealth: async () => ({
        status: 'healthy',
        backend: 'automem',
        statistics: {},
      }),
      recallMemory: async () => ({
        results: [
          {
            id: 'profile-1',
            memory: {
              content: 'Call me Jack. Timezone Berlin. Keep it sharp and direct.',
              tags: ['profile', 'identity'],
              type: 'Preference',
            },
          },
        ],
        count: 1,
      }),
    });

    expect(profile).toContain('Call me Jack');
  });
});

describe('openclaw credential/endpoint pairing', () => {
  const ENDPOINT = 'https://chosen.example.test';
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of [
      'AUTOMEM_API_URL',
      'AUTOMEM_ENDPOINT',
      'AUTOMEM_API_KEY',
      'AUTOMEM_API_TOKEN',
    ]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('takes --api-key over the environment', () => {
    process.env.AUTOMEM_API_URL = ENDPOINT;
    process.env.AUTOMEM_API_KEY = 'sk-env';
    expect(resolveApiKey({ apiKey: 'sk-flag' }, ENDPOINT)).toBe('sk-flag');
  });

  it('reuses a shell key exported for the chosen endpoint', () => {
    process.env.AUTOMEM_API_URL = ENDPOINT;
    process.env.AUTOMEM_API_KEY = 'sk-env';
    expect(resolveApiKey({}, ENDPOINT)).toBe('sk-env');
  });

  // OpenClaw reads no previously installed credential, so this is the only half that
  // applies to it — but it is the half that discloses a secret.
  it('does not carry a shell key exported for a different endpoint', () => {
    process.env.AUTOMEM_API_URL = 'https://elsewhere.example.test';
    process.env.AUTOMEM_API_KEY = 'sk-env';
    expect(resolveApiKey({}, ENDPOINT)).toBeUndefined();
  });

  it('keeps an unbound shell key', () => {
    delete process.env.AUTOMEM_API_URL;
    delete process.env.AUTOMEM_ENDPOINT;
    process.env.AUTOMEM_API_KEY = 'sk-env';
    expect(resolveApiKey({}, ENDPOINT)).toBe('sk-env');
  });
});

// The resolver correctly returned undefined for a mismatched endpoint, but these
// builders then put the stored key straight back — and `...existingConfig` copied it
// forward even before the explicit fallback ran.
describe('openclaw stored-key pairing in config builders', () => {
  it('drops a plugin key stored for a different endpoint', () => {
    const entry = buildPluginConfigEntry({
      existing: { config: { endpoint: 'https://host-a.test', apiKey: 'sk-host-a' } },
      endpoint: 'https://host-b.test',
      defaultTags: [],
    });
    const config = entry.config as Record<string, unknown>;
    expect(config.endpoint).toBe('https://host-b.test');
    expect(config.apiKey).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('sk-host-a');
  });

  it('keeps a plugin key stored for the same endpoint', () => {
    const entry = buildPluginConfigEntry({
      existing: { config: { endpoint: 'https://same.test/', apiKey: 'sk-same' } },
      endpoint: 'https://same.test',
      defaultTags: [],
    });
    expect((entry.config as Record<string, unknown>).apiKey).toBe('sk-same');
  });

  it('lets an explicit key win over a mismatched stored one', () => {
    const entry = buildPluginConfigEntry({
      existing: { config: { endpoint: 'https://host-a.test', apiKey: 'sk-host-a' } },
      endpoint: 'https://host-b.test',
      apiKey: 'sk-explicit',
      defaultTags: [],
    });
    expect((entry.config as Record<string, unknown>).apiKey).toBe('sk-explicit');
  });

  it('preserves unrelated plugin config while dropping the stale key', () => {
    const entry = buildPluginConfigEntry({
      existing: {
        config: {
          endpoint: 'https://host-a.test',
          apiKey: 'sk-host-a',
          autoRecall: false,
          autoRecallLimit: 7,
          exposure: 'all',
        },
      },
      endpoint: 'https://host-b.test',
      defaultTags: [],
    });
    const config = entry.config as Record<string, unknown>;
    expect(config.apiKey).toBeUndefined();
    expect(config.autoRecall).toBe(false);
    expect(config.autoRecallLimit).toBe(7);
    expect(config.exposure).toBe('all');
  });

  it('drops a skill key stored for a different endpoint', () => {
    const entry = buildSkillConfigEntry({
      existing: { apiKey: 'sk-host-a', env: { AUTOMEM_API_URL: 'https://host-a.test' } },
      endpoint: 'https://host-b.test',
      defaultTags: [],
    });
    expect(entry.apiKey).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('sk-host-a');
  });

  it('keeps a skill key stored for the same endpoint', () => {
    const entry = buildSkillConfigEntry({
      existing: { apiKey: 'sk-same', env: { AUTOMEM_API_URL: 'https://same.test' } },
      endpoint: 'https://same.test',
      defaultTags: [],
    });
    expect(entry.apiKey).toBe('sk-same');
  });
});

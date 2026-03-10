import { describe, expect, it } from 'vitest';
import {
  buildDefaultTags,
  buildMcporterConfig,
  buildPluginConfigEntry,
  buildSkillConfigEntry,
  parseArgs,
  redactConfigForOutput,
} from './openclaw.js';

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
      ])
    ).toMatchObject({
      mode: 'mcp',
      scope: 'shared',
      pluginSource: '../local-plugin',
      projectName: 'Project X',
    });
  });

  it('rejects invalid mode values', () => {
    expect(() => parseArgs(['--mode', 'nope'])).toThrow(/invalid --mode/i);
  });

  it('builds default tags from project names', () => {
    expect(buildDefaultTags('@scope/My Cool Project')).toEqual([
      'platform/openclaw',
      'project/my-cool-project',
    ]);
    expect(buildDefaultTags('')).toEqual(['platform/openclaw']);
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
        defaultTags: ['openclaw', 'project-x'],
      })
    ).toEqual({
      enabled: true,
      config: {
        endpoint: 'http://localhost:8001',
        apiKey: 'top-secret',
        autoRecall: true,
        autoRecallLimit: 3,
        exposure: 'dm-only',
        defaultTags: ['openclaw', 'project-x'],
      },
    });
  });

  it('builds skill config entries with runtime env injection', () => {
    expect(
      buildSkillConfigEntry({
        endpoint: 'https://memory.example',
        apiKey: 'top-secret',
        defaultTags: ['openclaw', 'project-x'],
      })
    ).toEqual({
      enabled: true,
      apiKey: 'top-secret',
      env: {
        AUTOMEM_ENDPOINT: 'https://memory.example',
        AUTOMEM_DEFAULT_TAGS: 'openclaw,project-x',
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
});

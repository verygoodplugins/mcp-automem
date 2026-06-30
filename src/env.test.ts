/**
 * Endpoint/key resolution (src/env.ts).
 *
 * The Claude Code plugin prompts for the AutoMem endpoint and key via
 * userConfig; Claude Code exports those answers to plugin subprocesses as
 * CLAUDE_PLUGIN_OPTION_<KEY> environment variables. The server resolves them
 * itself rather than wiring them through the plugin's .mcp.json env — a
 * config-level AUTOMEM_API_URL would shadow a legacy user's AUTOMEM_ENDPOINT
 * and silently redirect them (see tests/installer/plugin-mcp-config.test.ts).
 *
 * Precedence: AUTOMEM_API_URL (explicit, documented) beats the plugin prompt;
 * the plugin prompt beats the deprecated AUTOMEM_ENDPOINT; everything beats
 * the localhost default. Blank answers fall through.
 */

import { describe, expect, it } from 'vitest';
import { readAutoMemApiKeyFromEnv, resolveAutoMemApiUrl } from './env.js';

describe('resolveAutoMemApiUrl', () => {
  it('prefers AUTOMEM_API_URL over everything', () => {
    expect(
      resolveAutoMemApiUrl({
        AUTOMEM_API_URL: 'https://primary.example',
        CLAUDE_PLUGIN_OPTION_API_URL: 'https://plugin.example',
        AUTOMEM_ENDPOINT: 'https://legacy.example',
      })
    ).toEqual({ url: 'https://primary.example', source: 'AUTOMEM_API_URL' });
  });

  it('plugin userConfig answer beats the deprecated AUTOMEM_ENDPOINT', () => {
    expect(
      resolveAutoMemApiUrl({
        CLAUDE_PLUGIN_OPTION_API_URL: 'https://plugin.example',
        AUTOMEM_ENDPOINT: 'https://legacy.example',
      })
    ).toEqual({ url: 'https://plugin.example', source: 'CLAUDE_PLUGIN_OPTION_API_URL' });
  });

  it('accepts the lowercase CLAUDE_PLUGIN_OPTION_api_url spelling', () => {
    expect(
      resolveAutoMemApiUrl({ CLAUDE_PLUGIN_OPTION_api_url: 'https://plugin.example' })
    ).toEqual({ url: 'https://plugin.example', source: 'CLAUDE_PLUGIN_OPTION_API_URL' });
  });

  it('falls back to the deprecated AUTOMEM_ENDPOINT, tagged as such', () => {
    expect(resolveAutoMemApiUrl({ AUTOMEM_ENDPOINT: 'https://legacy.example' })).toEqual({
      url: 'https://legacy.example',
      source: 'AUTOMEM_ENDPOINT',
    });
  });

  it('a blank plugin answer falls through to AUTOMEM_ENDPOINT (the blind-accept case)', () => {
    expect(
      resolveAutoMemApiUrl({
        CLAUDE_PLUGIN_OPTION_API_URL: '   ',
        AUTOMEM_ENDPOINT: 'https://legacy.example',
      })
    ).toEqual({ url: 'https://legacy.example', source: 'AUTOMEM_ENDPOINT' });
  });

  it('defaults to localhost when nothing is set', () => {
    expect(resolveAutoMemApiUrl({})).toEqual({
      url: 'http://127.0.0.1:8001',
      source: 'default',
    });
  });
});

describe('readAutoMemApiKeyFromEnv', () => {
  it('prefers AUTOMEM_API_KEY, then AUTOMEM_API_TOKEN', () => {
    expect(
      readAutoMemApiKeyFromEnv({ AUTOMEM_API_KEY: 'key', AUTOMEM_API_TOKEN: 'token' })
    ).toBe('key');
    expect(readAutoMemApiKeyFromEnv({ AUTOMEM_API_TOKEN: 'token' })).toBe('token');
  });

  it('falls back to the plugin userConfig answer in either casing', () => {
    expect(readAutoMemApiKeyFromEnv({ CLAUDE_PLUGIN_OPTION_API_KEY: 'plugin-key' })).toBe(
      'plugin-key'
    );
    expect(readAutoMemApiKeyFromEnv({ CLAUDE_PLUGIN_OPTION_api_key: 'plugin-key' })).toBe(
      'plugin-key'
    );
  });

  it('explicit env keys beat the plugin answer; blanks fall through', () => {
    expect(
      readAutoMemApiKeyFromEnv({
        AUTOMEM_API_KEY: 'key',
        CLAUDE_PLUGIN_OPTION_API_KEY: 'plugin-key',
      })
    ).toBe('key');
    expect(
      readAutoMemApiKeyFromEnv({
        AUTOMEM_API_KEY: '  ',
        CLAUDE_PLUGIN_OPTION_API_KEY: 'plugin-key',
      })
    ).toBe('plugin-key');
    expect(readAutoMemApiKeyFromEnv({})).toBeUndefined();
  });
});

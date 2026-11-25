/**
 * Endpoint/key resolution (src/env.ts).
 *
 * The Claude Code plugin prompts for the AutoMem endpoint and key via
 * userConfig. Claude Code does not pass plugin options to a stdio MCP server
 * by itself: the plugin's .mcp.json maps them into the server's environment as
 * CLAUDE_PLUGIN_OPTION_API_URL / CLAUDE_PLUGIN_OPTION_API_KEY. AUTOMEM_* names
 * stay out of .mcp.json — a config-level AUTOMEM_API_URL would shadow the
 * user's own environment, including a legacy AUTOMEM_ENDPOINT (see
 * tests/installer/plugin-mcp-config.test.ts).
 *
 * Precedence: AUTOMEM_API_URL (explicit, documented) beats the plugin option;
 * the plugin option beats the deprecated AUTOMEM_ENDPOINT; everything beats
 * the localhost default. Blank values and unexpanded `${...}` placeholders
 * fall through. An environment key always wins; when the plugin also has a
 * saved URL, its key is sent only to that endpoint (resolveAutoMemApiKey).
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_AUTOMEM_API_URL,
  hasMcpSidecarPath,
  isMcpSidecarHealth,
  isPluginApiKeyWithheld,
  readAutoMemApiKeyFromEnv,
  readAutoMemConnectionFile,
  resolveAutoMemApiKey,
  resolveAutoMemApiUrl,
  sameAutoMemEndpoint,
} from './env.js';

describe('readAutoMemConnectionFile', () => {
  it('reads a protected connection exactly and allows an intentionally empty key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-connection-'));
    try {
      const file = path.join(dir, 'connection.json');
      fs.writeFileSync(
        file,
        JSON.stringify({ endpoint: 'https://memory.example', apiKey: 'key-${env:VALUE}-"quoted"' })
      );
      expect(readAutoMemConnectionFile({ AUTOMEM_CONNECTION_FILE: file })).toEqual({
        endpoint: 'https://memory.example',
        apiKey: 'key-${env:VALUE}-"quoted"',
      });
      fs.writeFileSync(file, JSON.stringify({ endpoint: 'http://127.0.0.1:8001', apiKey: '' }));
      expect(readAutoMemConnectionFile({ AUTOMEM_CONNECTION_FILE: file })).toEqual({
        endpoint: 'http://127.0.0.1:8001',
        apiKey: undefined,
      });
      expect(readAutoMemConnectionFile({})).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed without disclosing credentials when the file is missing or invalid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-connection-'));
    try {
      const file = path.join(dir, 'connection.json');
      expect(() => readAutoMemConnectionFile({ AUTOMEM_CONNECTION_FILE: file })).toThrow(
        /missing or invalid/
      );
      fs.writeFileSync(file, '{"endpoint":"not-a-url", "apiKey":"secret-in-file"}');
      expect(() => readAutoMemConnectionFile({ AUTOMEM_CONNECTION_FILE: file })).toThrow(
        /missing or invalid/
      );
      try {
        readAutoMemConnectionFile({ AUTOMEM_CONNECTION_FILE: file });
      } catch (error) {
        expect(String(error)).not.toContain('secret-in-file');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
    expect(readAutoMemApiKeyFromEnv({ AUTOMEM_API_KEY: 'key', AUTOMEM_API_TOKEN: 'token' })).toBe(
      'key'
    );
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

const P = (url?: string, key?: string) => ({
  CLAUDE_PLUGIN_OPTION_API_URL: url,
  CLAUDE_PLUGIN_OPTION_API_KEY: key,
});

describe('plugin option placeholders', () => {
  it('treats an unexpanded placeholder as blank', () => {
    expect(
      resolveAutoMemApiUrl({
        ...P('${user_config.api_url}'),
        AUTOMEM_ENDPOINT: 'https://legacy.example',
      })
    ).toEqual({ url: 'https://legacy.example', source: 'AUTOMEM_ENDPOINT' });
    expect(resolveAutoMemApiUrl(P(' ${user_config.api_url} '))).toEqual({
      url: DEFAULT_AUTOMEM_API_URL,
      source: 'default',
    });
    expect(readAutoMemApiKeyFromEnv(P(undefined, '${user_config.api_key}'))).toBeUndefined();
  });

  it('keeps a real value that merely contains ${', () => {
    expect(readAutoMemApiKeyFromEnv(P(undefined, 'ab${cd}ef'))).toBe('ab${cd}ef');
  });

  it('a blank or placeholder upper-case name does not hide the lower-case one', () => {
    expect(
      resolveAutoMemApiUrl({ CLAUDE_PLUGIN_OPTION_API_URL: '', CLAUDE_PLUGIN_OPTION_api_url: 'x' })
    ).toEqual({ url: 'x', source: 'CLAUDE_PLUGIN_OPTION_API_URL' });
    expect(
      readAutoMemApiKeyFromEnv({
        CLAUDE_PLUGIN_OPTION_API_KEY: '${user_config.api_key}',
        CLAUDE_PLUGIN_OPTION_api_key: 'real-key',
      })
    ).toBe('real-key');
    expect(
      readAutoMemApiKeyFromEnv({
        CLAUDE_PLUGIN_OPTION_API_KEY: 'upper-key',
        CLAUDE_PLUGIN_OPTION_api_key: 'lower-key',
      })
    ).toBe('upper-key');
  });

  it('a placeholder plugin URL counts as blank, so the plugin key is used', () => {
    expect(
      resolveAutoMemApiKey({
        ...P('${user_config.api_url}', 'plugin-key'),
        AUTOMEM_API_URL: 'https://hosted.example',
      })
    ).toBe('plugin-key');
  });
});

describe('resolveAutoMemApiKey', () => {
  it('uses the plugin key with the plugin URL', () => {
    expect(resolveAutoMemApiKey(P('http://127.0.0.1:8100', 'plugin-key'))).toBe('plugin-key');
  });

  it('uses the plugin key when the plugin has no URL, whatever URL is in use', () => {
    expect(
      resolveAutoMemApiKey({ ...P('', 'plugin-key'), AUTOMEM_API_URL: 'https://hosted.example' })
    ).toBe('plugin-key');
    expect(resolveAutoMemApiKey(P(undefined, 'plugin-key'))).toBe('plugin-key');
  });

  it('withholds the plugin key from a different endpoint', () => {
    expect(
      resolveAutoMemApiKey({
        ...P('http://127.0.0.1:8001', 'local-key'),
        AUTOMEM_API_URL: 'https://hosted.example',
      })
    ).toBeUndefined();
  });

  it('keeps the plugin key when the environment URL names the same endpoint', () => {
    expect(
      resolveAutoMemApiKey({
        ...P('http://127.0.0.1:8001', 'local-key'),
        AUTOMEM_API_URL: 'http://127.0.0.1:8001/',
      })
    ).toBe('local-key');
  });

  it('an environment key always wins', () => {
    expect(
      resolveAutoMemApiKey({
        ...P('http://127.0.0.1:8001', 'local-key'),
        AUTOMEM_API_URL: 'https://hosted.example',
        AUTOMEM_API_KEY: 'env-key',
      })
    ).toBe('env-key');
    expect(
      resolveAutoMemApiKey({
        ...P('http://127.0.0.1:8001', 'local-key'),
        AUTOMEM_API_TOKEN: 'env-token',
      })
    ).toBe('env-token');
  });

  it('accepts the lower-case option names the server already accepts', () => {
    expect(
      resolveAutoMemApiKey({
        CLAUDE_PLUGIN_OPTION_api_url: 'http://127.0.0.1:8100',
        CLAUDE_PLUGIN_OPTION_api_key: 'k',
      })
    ).toBe('k');
  });

  it('pairs the plugin key with an explicitly passed URL', () => {
    expect(
      resolveAutoMemApiKey(P('http://127.0.0.1:8100', 'plugin-key'), {
        url: 'https://elsewhere.example',
        source: 'AUTOMEM_API_URL',
      })
    ).toBeUndefined();
    expect(
      resolveAutoMemApiKey(P('http://127.0.0.1:8100', 'plugin-key'), {
        url: 'http://127.0.0.1:8100/',
        source: 'CLAUDE_PLUGIN_OPTION_API_URL',
      })
    ).toBe('plugin-key');
  });
});

describe('isPluginApiKeyWithheld', () => {
  it('is true only when a plugin key is withheld from a different endpoint', () => {
    expect(
      isPluginApiKeyWithheld({
        ...P('http://127.0.0.1:8001', 'local-key'),
        AUTOMEM_API_URL: 'https://hosted.example',
      })
    ).toBe(true);
  });

  it('is false when an environment key is set', () => {
    expect(
      isPluginApiKeyWithheld({
        ...P('http://127.0.0.1:8001', 'local-key'),
        AUTOMEM_API_URL: 'https://hosted.example',
        AUTOMEM_API_KEY: 'env-key',
      })
    ).toBe(false);
  });

  it('is false when the URLs match, the plugin has no URL, or there is no plugin key', () => {
    expect(
      isPluginApiKeyWithheld({
        ...P('http://127.0.0.1:8001', 'local-key'),
        AUTOMEM_API_URL: 'http://127.0.0.1:8001/',
      })
    ).toBe(false);
    expect(
      isPluginApiKeyWithheld({ ...P(undefined, 'k'), AUTOMEM_API_URL: 'https://hosted.example' })
    ).toBe(false);
    expect(
      isPluginApiKeyWithheld({
        ...P('http://127.0.0.1:8001'),
        AUTOMEM_API_URL: 'https://hosted.example',
      })
    ).toBe(false);
    expect(isPluginApiKeyWithheld({})).toBe(false);
  });
});

// Pins the comparison host-toolkit's sameEndpoint has always used: trim, strip
// trailing slashes, compare strings. No URL parsing, no case folding.
describe('sameAutoMemEndpoint', () => {
  it('compares trimmed spellings without trailing slashes', () => {
    expect(sameAutoMemEndpoint('http://127.0.0.1:8001', 'http://127.0.0.1:8001/')).toBe(true);
    expect(sameAutoMemEndpoint(' https://x.example// ', 'https://x.example')).toBe(true);
    expect(sameAutoMemEndpoint('http://127.0.0.1:8001', 'http://127.0.0.1:8100')).toBe(false);
    expect(sameAutoMemEndpoint('https://X.example', 'https://x.example')).toBe(false);
  });

  it('does not parse: unparseable strings compare as plain text', () => {
    expect(sameAutoMemEndpoint('not a url', 'also not a url')).toBe(false);
    expect(sameAutoMemEndpoint('not a url', 'not a url/')).toBe(true);
  });

  it('an empty side is never the same endpoint', () => {
    expect(sameAutoMemEndpoint('', '')).toBe(false);
    expect(sameAutoMemEndpoint('', 'http://127.0.0.1:8001')).toBe(false);
  });
});

// The remote MCP sidecar (automem/mcp-sse-server) answers /health with a 200
// and a `status`, so a sidecar URL pasted into AUTOMEM_API_URL looks healthy
// until the first recall 404s. Its payload carries `transports` and
// `endpoints`, which the REST API's /health never returns.
describe('isMcpSidecarHealth', () => {
  it('recognizes the sidecar /health payload', () => {
    expect(
      isMcpSidecarHealth({
        status: 'healthy',
        transports: ['streamable-http', 'sse'],
        endpoints: { streamableHttp: '/mcp', sse: '/mcp/sse' },
        upstream: 'https://automem.example',
      })
    ).toBe(true);
    expect(isMcpSidecarHealth({ status: 'healthy', endpoints: {} })).toBe(true);
    expect(isMcpSidecarHealth({ status: 'healthy', transports: [] })).toBe(true);
  });

  it('does not flag the REST API /health payload', () => {
    expect(
      isMcpSidecarHealth({
        status: 'healthy',
        falkordb: 'connected',
        qdrant: 'connected',
        memory_count: 12,
      })
    ).toBe(false);
    // A future REST /health that advertises the MCP URL must not trip this.
    expect(
      isMcpSidecarHealth({
        status: 'healthy',
        falkordb: 'connected',
        qdrant: 'connected',
        endpoints: { mcp: 'https://mcp.example/mcp' },
      })
    ).toBe(false);
    expect(isMcpSidecarHealth(null)).toBe(false);
    expect(isMcpSidecarHealth('healthy')).toBe(false);
    expect(isMcpSidecarHealth(undefined)).toBe(false);
  });
});

describe('hasMcpSidecarPath', () => {
  it('matches the sidecar transport paths, ignoring query and trailing slash', () => {
    expect(hasMcpSidecarPath('https://mcp.example/mcp')).toBe(true);
    expect(hasMcpSidecarPath('https://mcp.example/mcp/')).toBe(true);
    expect(hasMcpSidecarPath('https://mcp.example/mcp/sse')).toBe(true);
    expect(hasMcpSidecarPath('https://mcp.example/mcp?api_key=abc')).toBe(true);
    expect(hasMcpSidecarPath('https://mcp.example/MCP')).toBe(true);
  });

  it('leaves REST API base URLs alone', () => {
    expect(hasMcpSidecarPath('https://automem.example')).toBe(false);
    expect(hasMcpSidecarPath('http://127.0.0.1:8001/')).toBe(false);
    expect(hasMcpSidecarPath('https://mcp-automem.example')).toBe(false);
    expect(hasMcpSidecarPath('https://example.com/mcpx')).toBe(false);
    expect(hasMcpSidecarPath('not a url')).toBe(false);
  });
});

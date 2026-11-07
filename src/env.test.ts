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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hasMcpSidecarPath,
  isMcpSidecarHealth,
  readAutoMemApiKeyFromEnv,
  readAutoMemConnectionFile,
  resolveAutoMemApiUrl,
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

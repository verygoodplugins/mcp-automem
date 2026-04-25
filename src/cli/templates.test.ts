import { describe, expect, it } from 'vitest';
import {
  buildClaudeCodeExport,
  buildClaudeDesktopSnippet,
  buildMcpConfigJson,
} from './templates.js';

describe('config snippets — canonical AUTOMEM_API_URL only', () => {
  const endpoint = 'https://memory.example.com';
  const apiKey = 'sk-test-123';

  it('Claude Desktop snippet emits AUTOMEM_API_URL and not the deprecated AUTOMEM_ENDPOINT', () => {
    const raw = buildClaudeDesktopSnippet(endpoint, apiKey);
    const env = JSON.parse(raw).mcpServers.memory.env;

    expect(env).toHaveProperty('AUTOMEM_API_URL', endpoint);
    expect(env).toHaveProperty('AUTOMEM_API_KEY', apiKey);
    expect(env).not.toHaveProperty('AUTOMEM_ENDPOINT');
  });

  it('Claude Code shell export emits AUTOMEM_API_URL only (no deprecated alias line)', () => {
    const out = buildClaudeCodeExport(endpoint, apiKey);

    expect(out).toMatch(new RegExp(`export AUTOMEM_API_URL="${endpoint}"`));
    expect(out).toMatch(new RegExp(`export AUTOMEM_API_KEY="${apiKey}"`));
    expect(out).not.toContain('AUTOMEM_ENDPOINT');
  });

  it('mcp-automem config --json snippet emits AUTOMEM_API_URL only', () => {
    const env = buildMcpConfigJson(endpoint, apiKey).mcpServers.memory.env;

    expect(env.AUTOMEM_API_URL).toBe(endpoint);
    expect(env.AUTOMEM_API_KEY).toBe(apiKey);
    expect(env).not.toHaveProperty('AUTOMEM_ENDPOINT');
  });
});

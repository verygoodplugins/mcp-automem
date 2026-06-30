/**
 * Regression guard for the plugin's MCP server config.
 *
 * Claude Code's .mcp.json env expansion supports only single-level `${VAR}`
 * and `${VAR:-default}` (https://code.claude.com/docs/en/mcp.md). A nested
 * default like `${AUTOMEM_API_URL:-${AUTOMEM_ENDPOINT:-…}}` is undocumented
 * and parses to a mangled value, so it must never ship.
 *
 * The plugin also must not set AUTOMEM_API_URL itself: stdio MCP servers
 * inherit the parent environment, and the server resolves
 * AUTOMEM_API_URL → AUTOMEM_ENDPOINT (deprecated) → default in code
 * (src/index.ts). A config-level default would shadow a legacy user's
 * AUTOMEM_ENDPOINT and silently redirect them to the default endpoint.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

const SHIPPED_MCP_CONFIGS = [
  'plugins/automem/.mcp.json',
  'templates/claude_desktop_config.json',
  'templates/cursor_mcp.json',
  'templates/antigravity/mcp_config.json',
];

const NESTED_EXPANSION = /\$\{[^}]*\$\{/;

describe('shipped MCP server configs', () => {
  it.each(SHIPPED_MCP_CONFIGS)('%s has no nested ${} expansion', (relPath) => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    expect(raw).not.toMatch(NESTED_EXPANSION);
  });

  it('plugin .mcp.json leaves endpoint resolution to the server', () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, 'plugins/automem/.mcp.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { env?: Record<string, string> }>;
    };
    const memory = parsed.mcpServers.memory;
    expect(memory).toBeDefined();
    expect(memory.env?.AUTOMEM_API_URL).toBeUndefined();
    expect(memory.env?.AUTOMEM_ENDPOINT).toBeUndefined();
  });

  /**
   * The plugin prompts for endpoint/key at enable time via userConfig.
   * Claude Code exports the answers to plugin subprocesses as
   * CLAUDE_PLUGIN_OPTION_<KEY> env vars, and the server resolves them in
   * src/env.ts (AUTOMEM_API_URL > plugin answer > AUTOMEM_ENDPOINT >
   * default). api_url must NOT declare a `default`: a pre-filled default
   * blindly accepted by a legacy AUTOMEM_ENDPOINT user would shadow their
   * endpoint — the exact failure mode the .mcp.json guard above prevents.
   */
  it('plugin manifest prompts for endpoint and key via userConfig', () => {
    const raw = fs.readFileSync(
      path.join(REPO_ROOT, 'plugins/automem/.claude-plugin/plugin.json'),
      'utf8'
    );
    const parsed = JSON.parse(raw) as {
      description?: string;
      userConfig?: Record<
        string,
        {
          type?: string;
          title?: string;
          description?: string;
          sensitive?: boolean;
          default?: unknown;
        }
      >;
    };

    expect(parsed.description ?? '').not.toMatch(/deprecated/i);

    const apiUrl = parsed.userConfig?.api_url;
    expect(apiUrl).toBeDefined();
    expect(apiUrl?.type).toBe('string');
    expect(apiUrl?.title).toBeTruthy();
    expect(apiUrl?.description).toBeTruthy();
    expect(apiUrl?.sensitive).toBeUndefined();
    expect(apiUrl?.default).toBeUndefined();

    const apiKey = parsed.userConfig?.api_key;
    expect(apiKey).toBeDefined();
    expect(apiKey?.type).toBe('string');
    expect(apiKey?.title).toBeTruthy();
    expect(apiKey?.description).toBeTruthy();
    expect(apiKey?.sensitive).toBe(true);
    expect(apiKey?.default).toBeUndefined();
  });

  it('marketplace catalog no longer markets the plugin as deprecated', () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin/marketplace.json'), 'utf8');
    expect(raw).not.toMatch(/deprecated/i);
  });
});

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
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  buildClaudeCodeExport,
  buildClaudeDesktopSnippet,
  buildHermesSnippet,
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

    expect(out).toContain(`export AUTOMEM_API_URL="${endpoint}"`);
    expect(out).toContain(`export AUTOMEM_API_KEY="${apiKey}"`);
    expect(out).not.toContain('AUTOMEM_ENDPOINT');
  });

  it('mcp-automem config --json snippet emits AUTOMEM_API_URL only', () => {
    const env = buildMcpConfigJson(endpoint, apiKey).mcpServers.memory.env;

    expect(env.AUTOMEM_API_URL).toBe(endpoint);
    expect(env.AUTOMEM_API_KEY).toBe(apiKey);
    expect(env).not.toHaveProperty('AUTOMEM_ENDPOINT');
  });

  it('Hermes snippet uses the non-colliding automem server key', () => {
    const out = buildHermesSnippet(endpoint, apiKey);

    expect(out).toContain('  automem:');
    expect(out).not.toContain('  memory:');
    expect(out).toContain('recall_memory');
    expect(out).not.toContain('delete_memory');
    expect(out).toContain('resources: false');
    expect(out).toContain('prompts: false');
    expect(out).toContain('enabled: false');
  });
});

// npm treats any spec the current folder's package already satisfies (unpinned,
// a range, or the exact version) as the local project and runs its bin from PATH,
// so inside a clone of this repo `npx -y @verygoodplugins/mcp-automem` fails with
// `mcp-automem: not found`. A dist-tag is never satisfied locally, so every launch
// command we print or ship names one.
describe('launch commands use the @latest dist-tag', () => {
  const LAUNCH_ARGS = ['-y', '@verygoodplugins/mcp-automem@latest'];
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const readRepoFile = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

  it('Claude Desktop snippet', () => {
    expect(JSON.parse(buildClaudeDesktopSnippet()).mcpServers.memory.args).toEqual(LAUNCH_ARGS);
  });

  it('Claude Code command', () => {
    expect(buildClaudeCodeExport()).toContain(
      'claude mcp add memory "npx -y @verygoodplugins/mcp-automem@latest"'
    );
  });

  it('Hermes snippet', () => {
    const parsed = parseYaml(buildHermesSnippet()) as {
      mcp_servers: { automem: { args: string[] } };
    };
    expect(parsed.mcp_servers.automem.args).toEqual(LAUNCH_ARGS);
  });

  it('config --format=json snippet', () => {
    expect(buildMcpConfigJson('https://memory.example.com', 'k').mcpServers.memory.args).toEqual(
      LAUNCH_ARGS
    );
  });

  it.each([
    'templates/claude_desktop_config.json',
    'templates/cursor_mcp.json',
    'templates/antigravity/mcp_config.json',
  ])('%s', (file) => {
    const doc = JSON.parse(readRepoFile(file)) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(Object.values(doc.mcpServers).map((server) => server.args)).toEqual([LAUNCH_ARGS]);
  });

  it.each(['templates/codex/config.toml', 'templates/grok/config.toml'])('%s', (file) => {
    const doc = parseToml(readRepoFile(file)) as {
      mcp_servers: Record<string, { args: string[] }>;
    };
    expect(Object.values(doc.mcp_servers).map((server) => server.args)).toEqual([LAUNCH_ARGS]);
  });
});

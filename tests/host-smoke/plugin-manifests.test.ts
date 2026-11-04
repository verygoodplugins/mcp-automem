import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * One plugin directory, several host manifests. Claude Code reads
 * `.claude-plugin/plugin.json`; Cursor and Grok Bot read `.cursor-plugin/plugin.json`
 * first and fall back to the Claude manifest; the Grok Build CLI only ever sees the
 * Claude one. Release Please rewrites `version` in all three through `json` extra-files,
 * so a generator would fight the release PR; this test is the parity guard instead.
 */
const ROOT = path.resolve(__dirname, '../..');
const PLUGIN = path.join(ROOT, 'plugins/automem');

function readJson(relativePath: string) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

const claude = readJson('plugins/automem/.claude-plugin/plugin.json');
const cursor = readJson('plugins/automem/.cursor-plugin/plugin.json');
const catalog = readJson('.claude-plugin/marketplace.json');
const mcp = readJson('plugins/automem/.mcp.json');
const pkg = readJson('package.json');

const PLUGIN_ENABLED_TOOLS = [
  'associate_memories',
  'check_database_health',
  'recall_memory',
  'store_memory',
  'update_memory',
];

describe('plugin manifest parity', () => {
  it('keeps shared metadata identical across the Claude, Cursor, and catalog manifests', () => {
    for (const key of ['name', 'version', 'description', 'license', 'homepage', 'repository']) {
      expect(cursor[key], key).toBe(claude[key]);
    }
    expect(cursor.author).toEqual(claude.author);
    expect(cursor.keywords).toEqual(claude.keywords);
    expect(catalog.plugins[0]).toMatchObject({
      name: claude.name,
      version: claude.version,
      description: claude.description,
      displayName: cursor.displayName,
      logo: cursor.logo,
    });
    expect(claude.version).toBe(pkg.version);
  });

  it('declares the same stdio server with the same two inputs in both plugin formats', () => {
    expect(Object.keys(cursor.mcpServers)).toEqual(['memory']);
    expect(Object.keys(mcp.mcpServers)).toEqual(['memory']);
    expect(cursor.mcpServers.memory.command).toBe(mcp.mcpServers.memory.command);
    expect(cursor.mcpServers.memory.args).toEqual(mcp.mcpServers.memory.args);
    expect(Object.keys(cursor.mcpServers.memory.env).sort()).toEqual([
      'AUTOMEM_API_KEY',
      'AUTOMEM_API_URL',
    ]);
    expect(Object.keys(claude.userConfig).sort()).toEqual(['api_key', 'api_url']);
  });

  // npm treats any spec the current folder's package already satisfies (unpinned, ^x, or the
  // exact version) as the local project and looks for its bin on PATH. Started inside a clone
  // of this repo without a global install, that fails with `sh: mcp-automem: not found`. A
  // dist-tag is never satisfied locally, so npx always resolves the published package.
  it('pins the package to a dist-tag so npx works inside a clone of this repo', () => {
    expect(mcp.mcpServers.memory.args).toEqual(['-y', '@verygoodplugins/mcp-automem@latest']);
  });

  it('exposes every tool except delete_memory to Cursor and Grok Bot', () => {
    // A Bot that reads mail and web pages is prompt-injectable, and delete-by-tag has no
    // dry-run. Corrections still flow through update_memory and supersede.
    expect([...cursor.mcpServers.memory.enabledTools].sort()).toEqual(PLUGIN_ENABLED_TOOLS);
  });

  it('tells both configuration forms the URL is the REST base, not the /mcp endpoint', () => {
    for (const description of [
      claude.userConfig.api_url.description,
      cursor.variables.properties.AUTOMEM_API_URL.description,
    ]) {
      expect(description).toMatch(/REST/);
      expect(description).toMatch(/\/mcp/);
    }
  });

  it('declares Cursor-native hooks so the Claude hooks are not translated', () => {
    expect(cursor.hooks).toBe('./cursor/hooks.json');
    const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'cursor/hooks.json'), 'utf8'));
    expect(hooks.version).toBe(1);
    expect(Object.keys(hooks.hooks)).toEqual(['sessionStart']);
    expect(hooks.hooks.sessionStart).toEqual([
      { command: 'node "${CURSOR_PLUGIN_ROOT}/cursor/session-start.mjs"' },
    ]);
  });

  it('ships an always-on rule that derives the project slug from the workspace', () => {
    const rule = fs.readFileSync(path.join(PLUGIN, 'rules/automem.mdc'), 'utf8');
    expect(rule).toMatch(/^alwaysApply: true$/m);
    expect(rule).toContain('<workspace-folder-slug>');
    expect(rule).toContain('Cursor MCP server: `memory`');
    expect(rule).not.toContain('{{');
    expect(rule).toContain(`automem-template-version: ${pkg.version}`);
  });
});

describe('plugin session-start hook', () => {
  const SCRIPT = path.join(PLUGIN, 'cursor/session-start.mjs');

  function runHook(input: string): string {
    const result = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    return result.stdout;
  }

  function contextFor(input: unknown): string {
    const parsed = JSON.parse(runHook(JSON.stringify(input)));
    return parsed.additional_context;
  }

  it('injects two-phase recall gated by the workspace folder slug', () => {
    const context = contextFor({ workspace_roots: ['/Users/dev/My Proj'] });
    expect(context).toContain('recall_memory');
    expect(context).toContain('tags: ["preference"]');
    expect(context).toContain('tags: ["my-proj"]');
  });

  it('drops the tag gate when the workspace name collides with a common word', () => {
    const context = contextFor({ workspace_roots: ['/Users/dev/api'] });
    expect(context).not.toContain('tags: ["api"]');
    expect(context.match(/tags: \[/g)).toHaveLength(1);
  });

  it('drops the tag gate when no workspace root is given', () => {
    const context = contextFor({ conversation_id: 'c1' });
    expect(context.match(/tags: \[/g)).toHaveLength(1);
  });

  it('prints an empty object for malformed input', () => {
    expect(runHook('not json')).toBe('{}');
  });

  it('carries no version marker, because the marker tooling never pegs a .mjs', () => {
    expect(fs.readFileSync(SCRIPT, 'utf8')).not.toContain('automem-template-version');
  });
});

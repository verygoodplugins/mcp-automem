import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCursorSetup } from './cursor.js';
import {
  CURSOR_PLUGIN_NAME,
  bundledCursorPluginRoot,
  cursorLocalPluginDir,
  cursorPluginConnectionPath,
  detectCursorFileInstall,
  installCursorPlugin,
  readCursorPluginName,
  removeCursorLocalPlugin,
} from './cursor-plugin.js';

describe('Cursor local plugin install', () => {
  let root: string;
  let home: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-cursor-plugin-'));
    home = path.join(root, 'home');
    project = path.join(root, 'project');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    // removeCursorMemoryServers and cursorMcpConfigPath resolve from os.homedir().
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves the bundled plugin that ships the Cursor manifest', () => {
    const manifest = path.join(bundledCursorPluginRoot(), '.cursor-plugin', 'plugin.json');
    expect(JSON.parse(fs.readFileSync(manifest, 'utf8')).name).toBe(CURSOR_PLUGIN_NAME);
  });

  it('copies the plugin into ~/.cursor/plugins/local/automem as a real directory', () => {
    const result = installCursorPlugin({ homeDir: home, quiet: true });
    const dest = path.join(home, '.cursor', 'plugins', 'local', 'automem');

    expect(result.pluginDir).toBe(dest);
    expect(cursorLocalPluginDir(home)).toBe(dest);
    expect(fs.lstatSync(dest).isDirectory()).toBe(true);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(readCursorPluginName(dest)).toBe('automem');
    expect(fs.existsSync(path.join(dest, 'rules', 'automem.mdc'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'cursor', 'hooks.json'))).toBe(true);
    const bundledVersion = JSON.parse(
      fs.readFileSync(path.join(bundledCursorPluginRoot(), '.cursor-plugin', 'plugin.json'), 'utf8')
    ).version;
    expect(result.version).toBe(bundledVersion);
    expect(result.replaced).toBe(false);
    // Nothing but the plugin itself lands in the loader's scan directory.
    expect(fs.readdirSync(path.dirname(dest))).toEqual(['automem']);
    // Staging/old dirs are cleaned up from the plugins root as well.
    expect(fs.readdirSync(path.join(home, '.cursor', 'plugins'))).toEqual(['local']);
  });

  it('configures the local plugin with a private connection, without changing the bundled manifest', () => {
    const endpoint = 'https://memory.example';
    const apiKey = 'key-with-$-and-"quotes"';
    const bundled = fs.readFileSync(
      path.join(bundledCursorPluginRoot(), '.cursor-plugin', 'plugin.json'),
      'utf8'
    );
    const result = installCursorPlugin({
      homeDir: home,
      quiet: true,
      connection: { endpoint, apiKey },
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.pluginDir, '.cursor-plugin', 'plugin.json'), 'utf8')
    );
    const server = manifest.mcpServers.memory;
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['-y', '@verygoodplugins/mcp-automem@latest']);
    expect(server.env).toMatchObject({
      AUTOMEM_CONNECTION_FILE: '${CURSOR_PLUGIN_ROOT}/cursor/connection.json',
      AUTOMEM_CURSOR_REVISION: expect.any(String),
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
    });
    expect(manifest.variables).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain(apiKey);
    expect(JSON.stringify(manifest)).not.toContain(endpoint);
    const connection = cursorPluginConnectionPath(home);
    expect(JSON.parse(fs.readFileSync(connection, 'utf8'))).toEqual({ endpoint, apiKey });
    if (process.platform !== 'win32') expect(fs.statSync(connection).mode & 0o777).toBe(0o600);
    expect(
      fs.readFileSync(path.join(bundledCursorPluginRoot(), '.cursor-plugin', 'plugin.json'), 'utf8')
    ).toBe(bundled);
    expect(removeCursorLocalPlugin({ homeDir: home, quiet: true })).toBe(true);
    expect(fs.existsSync(connection)).toBe(false);
  });

  it('replaces the saved connection and does not inherit an old key for a new endpoint', () => {
    installCursorPlugin({
      homeDir: home,
      quiet: true,
      connection: { endpoint: 'https://old.example', apiKey: 'old-key' },
    });
    const manifestPath = path.join(cursorLocalPluginDir(home), '.cursor-plugin', 'plugin.json');
    const before = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).mcpServers.memory.env
      .AUTOMEM_CURSOR_REVISION;
    installCursorPlugin({
      homeDir: home,
      quiet: true,
      connection: { endpoint: 'https://new.example' },
    });
    const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).mcpServers.memory.env
      .AUTOMEM_CURSOR_REVISION;
    expect(after).not.toBe(before);
    expect(JSON.parse(fs.readFileSync(cursorPluginConnectionPath(home), 'utf8'))).toEqual({
      endpoint: 'https://new.example',
      apiKey: '',
    });
  });

  it('keeps the old plugin intact if a staged connection cannot be created', () => {
    installCursorPlugin({
      homeDir: home,
      quiet: true,
      connection: { endpoint: 'https://old.example', apiKey: 'old-key' },
    });
    const source = path.join(root, 'bad-bundle');
    fs.cpSync(bundledCursorPluginRoot(), source, { recursive: true });
    fs.writeFileSync(path.join(source, 'cursor', 'connection.json'), 'foreign file');
    expect(() =>
      installCursorPlugin({
        homeDir: home,
        sourceDir: source,
        quiet: true,
        connection: { endpoint: 'https://new.example', apiKey: 'new-key' },
      })
    ).toThrow();
    expect(JSON.parse(fs.readFileSync(cursorPluginConnectionPath(home), 'utf8'))).toEqual({
      endpoint: 'https://old.example',
      apiKey: 'old-key',
    });
  });

  it('replaces an older copy on re-run, dropping files the bundle no longer ships', () => {
    installCursorPlugin({ homeDir: home, quiet: true });
    const dest = cursorLocalPluginDir(home);
    const stale = path.join(dest, 'stale-from-old-release.txt');
    fs.writeFileSync(stale, 'old');

    const result = installCursorPlugin({ homeDir: home, quiet: true });

    expect(result.replaced).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
    expect(readCursorPluginName(dest)).toBe('automem');
    expect(fs.readdirSync(path.dirname(dest))).toEqual(['automem']);
    expect(fs.readdirSync(path.join(home, '.cursor', 'plugins'))).toEqual(['local']);
  });

  it('sweeps staging leftovers from an interrupted earlier run', () => {
    const pluginsRoot = path.join(home, '.cursor', 'plugins');
    fs.mkdirSync(path.join(pluginsRoot, '.automem-staging-123-1'), { recursive: true });
    fs.mkdirSync(path.join(pluginsRoot, '.automem-old-123-1'), { recursive: true });

    installCursorPlugin({ homeDir: home, quiet: true });

    expect(fs.readdirSync(pluginsRoot)).toEqual(['local']);
  });

  it('refuses to replace a symlinked destination and leaves the link alone', () => {
    const target = path.join(root, 'dev-checkout');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'keep.txt'), 'mine');
    const dest = cursorLocalPluginDir(home);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(target, dest, 'dir');

    expect(() => installCursorPlugin({ homeDir: home, quiet: true })).toThrow(/symlink/i);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('refuses to replace a directory that is not the AutoMem plugin and keeps its files', () => {
    const dest = cursorLocalPluginDir(home);
    fs.mkdirSync(path.join(dest, '.cursor-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(dest, '.cursor-plugin', 'plugin.json'),
      JSON.stringify({ name: 'someone-else' })
    );
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'mine');

    expect(() => installCursorPlugin({ homeDir: home, quiet: true })).toThrow(/not the AutoMem/);
    expect(() => installCursorPlugin({ homeDir: home, dryRun: true, quiet: true })).toThrow(
      /not the AutoMem/
    );
    expect(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8')).toBe('mine');
    expect(readCursorPluginName(dest)).toBe('someone-else');
  });

  it('refuses to replace a directory with no plugin manifest', () => {
    const dest = cursorLocalPluginDir(home);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'notes.md'), 'mine');

    expect(() => installCursorPlugin({ homeDir: home, quiet: true })).toThrow(/not the AutoMem/);
    expect(fs.readFileSync(path.join(dest, 'notes.md'), 'utf8')).toBe('mine');
  });

  it('writes nothing in dry-run mode, not even the plugins folder', () => {
    const result = installCursorPlugin({ homeDir: home, dryRun: true, quiet: true });
    expect(result.dryRun).toBe(true);
    expect(fs.existsSync(path.join(home, '.cursor'))).toBe(false);
  });

  it('removes only our own plugin directory, and nothing in dry-run mode', () => {
    expect(removeCursorLocalPlugin({ homeDir: home, quiet: true })).toBe(false);
    installCursorPlugin({ homeDir: home, quiet: true });
    const dest = cursorLocalPluginDir(home);

    expect(removeCursorLocalPlugin({ homeDir: home, dryRun: true, quiet: true })).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
    expect(removeCursorLocalPlugin({ homeDir: home, quiet: true })).toBe(true);
    expect(fs.existsSync(dest)).toBe(false);

    fs.mkdirSync(path.join(dest, '.cursor-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(dest, '.cursor-plugin', 'plugin.json'),
      JSON.stringify({ name: 'someone-else' })
    );
    expect(removeCursorLocalPlugin({ homeDir: home, quiet: true })).toBe(false);
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('reads no plugin name from a symlink, a missing manifest, or invalid JSON', () => {
    const dir = path.join(root, 'candidate');
    expect(readCursorPluginName(dir)).toBeUndefined();
    fs.mkdirSync(path.join(dir, '.cursor-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cursor-plugin', 'plugin.json'), '{not json');
    expect(readCursorPluginName(dir)).toBeUndefined();
    fs.writeFileSync(
      path.join(dir, '.cursor-plugin', 'plugin.json'),
      JSON.stringify({ name: 'automem' })
    );
    expect(readCursorPluginName(dir)).toBe('automem');
    const link = path.join(root, 'link');
    fs.symlinkSync(dir, link, 'dir');
    expect(readCursorPluginName(link)).toBeUndefined();
  });
});

describe('Cursor double-registration detection', () => {
  let root: string;
  let home: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-cursor-detect-'));
    home = path.join(root, 'home');
    project = path.join(root, 'project');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds nothing on a clean machine', () => {
    expect(detectCursorFileInstall({ homeDir: home, projectDir: project })).toEqual({
      paths: [],
      projectRegistrations: [],
      unreadable: [],
    });
  });

  it('detects a file install: the global mcp.json entry and the project rule', async () => {
    await applyCursorSetup({ projectDir: project, quiet: true, skipPrompts: true });

    const found = detectCursorFileInstall({ homeDir: home, projectDir: project });

    expect(found.paths).toEqual([
      path.join(home, '.cursor', 'mcp.json'),
      path.join(project, '.cursor', 'rules', 'automem.mdc'),
    ]);
    expect(found.unreadable).toEqual([]);
  });

  it('ignores foreign MCP servers and a rule file without the AutoMem marker', () => {
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'npx', args: ['-y', 'other-mcp'] } } })
    );
    fs.mkdirSync(path.join(project, '.cursor', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(project, '.cursor', 'rules', 'automem.mdc'), '# my own rule\n');

    expect(detectCursorFileInstall({ homeDir: home, projectDir: project }).paths).toEqual([]);
  });

  it('reports a project-level AutoMem MCP registration separately from the file install', () => {
    const projectMcp = path.join(project, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(projectMcp), { recursive: true });
    fs.writeFileSync(
      projectMcp,
      JSON.stringify({
        mcpServers: { mine: { command: 'npx', args: ['-y', '@verygoodplugins/mcp-automem'] } },
      })
    );

    const found = detectCursorFileInstall({ homeDir: home, projectDir: project });

    expect(found.paths).toEqual([]);
    expect(found.projectRegistrations).toEqual([projectMcp]);
  });

  it('reports an unparseable project mcp.json as unreadable', () => {
    const projectMcp = path.join(project, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(projectMcp), { recursive: true });
    fs.writeFileSync(projectMcp, '{broken');

    expect(detectCursorFileInstall({ homeDir: home, projectDir: project }).unreadable).toEqual([
      projectMcp,
    ]);
  });

  it('reports an unparseable mcp.json as unreadable instead of throwing', () => {
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), '{broken');

    const found = detectCursorFileInstall({ homeDir: home, projectDir: project });

    expect(found.paths).toEqual([]);
    expect(found.unreadable).toEqual([path.join(home, '.cursor', 'mcp.json')]);
  });
});

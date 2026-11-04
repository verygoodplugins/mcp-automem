import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAutoMemServerEntry, log } from './host-toolkit.js';
import { readCursorDocument } from './cursor-config.js';

/** The `name` in plugins/automem/.cursor-plugin/plugin.json, and the local folder name. */
export const CURSOR_PLUGIN_NAME = 'automem';

/** Marker the file-mode project rule carries (templates/cursor/automem.mdc.template). */
const CURSOR_RULE_MARKER = 'automem-mdc-version';

/** Staging and retired copies live beside `local/`, never inside the loader's scan folder. */
const SWAP_PREFIX = /^\.automem-(staging|old)-/;

/**
 * The plugin directory shipped in the npm package. Resolves the same way from
 * src/cli (tsx) and dist/cli (published build), like the Cursor templates do.
 */
export function bundledCursorPluginRoot(): string {
  return fileURLToPath(new URL('../../plugins/automem/', import.meta.url));
}

/** Cursor loads local plugins from `~/.cursor/plugins/local/<name>` (real directories only). */
export function cursorLocalPluginDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.cursor', 'plugins', 'local', CURSOR_PLUGIN_NAME);
}

function lstatOrUndefined(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target);
  } catch {
    return undefined;
  }
}

function readManifest(dir: string): { name?: unknown; version?: unknown } | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, '.cursor-plugin', 'plugin.json'), 'utf8')
    ) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The plugin name recorded in `<dir>/.cursor-plugin/plugin.json`, or undefined when the
 * directory is a symlink, the manifest is missing, or it does not parse. Callers use this
 * to decide whether a directory is ours to replace or remove, so it never follows links.
 */
export function readCursorPluginName(dir: string): string | undefined {
  const stat = lstatOrUndefined(dir);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return undefined;
  const name = readManifest(dir)?.name;
  return typeof name === 'string' ? name : undefined;
}

export interface CursorPluginInstallOptions {
  homeDir?: string;
  /** Override the bundled plugin directory (tests). */
  sourceDir?: string;
  dryRun?: boolean;
  quiet?: boolean;
}

export interface CursorPluginInstallResult {
  pluginDir: string;
  version?: string;
  /** True when an earlier copy was swapped out. */
  replaced: boolean;
  dryRun: boolean;
}

function sweepSwapLeftovers(pluginsRoot: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(pluginsRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SWAP_PREFIX.test(entry)) {
      fs.rmSync(path.join(pluginsRoot, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Copy the bundled plugin into `~/.cursor/plugins/local/automem`.
 *
 * The copy is built in a staging folder under `~/.cursor/plugins/` (same filesystem,
 * outside `local/` so Cursor never loads a half-written or second copy), then swapped
 * in: the old copy is renamed aside, the staging copy renamed into place, and only
 * then is the old copy deleted. A symlinked destination is refused, because it points
 * at something we did not create (typically a developer checkout).
 */
export function installCursorPlugin(
  options: CursorPluginInstallOptions = {}
): CursorPluginInstallResult {
  const sourceDir = options.sourceDir ?? bundledCursorPluginRoot();
  const pluginDir = cursorLocalPluginDir(options.homeDir);
  const localRoot = path.dirname(pluginDir);
  const pluginsRoot = path.dirname(localRoot);

  const manifest = readManifest(sourceDir);
  if (manifest?.name !== CURSOR_PLUGIN_NAME) {
    throw new Error(`The bundled AutoMem plugin is missing or invalid at ${sourceDir}.`);
  }
  const version = typeof manifest.version === 'string' ? manifest.version : undefined;

  const existing = lstatOrUndefined(pluginDir);
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `${pluginDir} is a symlink. Cursor only loads real directories, and the installer will not replace a link it did not create. Remove it and re-run.`
    );
  }
  if (existing && !existing.isDirectory()) {
    throw new Error(`${pluginDir} exists and is not a directory. Remove it and re-run.`);
  }
  // Only ever replace our own copy: a foreign plugin or user folder at this path
  // would otherwise be renamed aside and deleted with no backup.
  if (existing && readCursorPluginName(pluginDir) !== CURSOR_PLUGIN_NAME) {
    throw new Error(
      `${pluginDir} exists but is not the AutoMem plugin (no .cursor-plugin/plugin.json named "${CURSOR_PLUGIN_NAME}"). Move it aside and re-run.`
    );
  }

  if (options.dryRun) {
    log(`[DRY RUN] Would copy the AutoMem Cursor plugin to ${pluginDir}`, options.quiet);
    return { pluginDir, version, replaced: Boolean(existing), dryRun: true };
  }

  fs.mkdirSync(localRoot, { recursive: true });
  sweepSwapLeftovers(pluginsRoot);
  const stamp = `${process.pid}-${Date.now()}`;
  const staging = path.join(pluginsRoot, `.automem-staging-${stamp}`);
  const retired = path.join(pluginsRoot, `.automem-old-${stamp}`);
  try {
    fs.cpSync(sourceDir, staging, { recursive: true, dereference: true });
    if (existing) fs.renameSync(pluginDir, retired);
    try {
      fs.renameSync(staging, pluginDir);
    } catch (error) {
      // Put the previous copy back so a failed swap never leaves Cursor without one.
      if (existing) fs.renameSync(retired, pluginDir);
      throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(retired, { recursive: true, force: true });
  }

  log(
    `${existing ? 'Updated' : 'Installed'} the AutoMem Cursor plugin${version ? ` ${version}` : ''} at ${pluginDir}`,
    options.quiet
  );
  return { pluginDir, version, replaced: Boolean(existing), dryRun: false };
}

export interface CursorFileInstall {
  /** Files that register AutoMem through the file-mode installer. */
  paths: string[];
  /**
   * Project `.cursor/mcp.json` files with an AutoMem server. No installer writes these
   * (file mode refuses them) and `uninstall cursor` does not remove them, so they are
   * reported for removal by hand.
   */
  projectRegistrations: string[];
  /** Files that could not be parsed, so their state is unknown. */
  unreadable: string[];
}

function hasAutoMemServer(mcpPath: string): boolean {
  const doc = readCursorDocument(mcpPath, 'mcpServers');
  const servers = (doc.mcpServers ?? {}) as Record<string, unknown>;
  return Object.values(servers).some((entry) => isAutoMemServerEntry(entry));
}

/**
 * Detect a file-mode Cursor install (`mcp-automem cursor` / `--cursor-mode files`):
 * an AutoMem server in `~/.cursor/mcp.json`, or the marked project rule at
 * `<projectDir>/.cursor/rules/automem.mdc`. Running it next to the plugin would
 * register AutoMem twice. A project `.cursor/mcp.json` AutoMem server is reported
 * separately in `projectRegistrations`. Never throws: an unparseable mcp.json is reported as
 * unreadable, since plugin mode never needs to write it.
 */
export function detectCursorFileInstall(params: {
  homeDir: string;
  projectDir: string;
}): CursorFileInstall {
  const paths: string[] = [];
  const projectRegistrations: string[] = [];
  const unreadable: string[] = [];

  const mcpPath = path.join(params.homeDir, '.cursor', 'mcp.json');
  try {
    if (hasAutoMemServer(mcpPath)) paths.push(mcpPath);
  } catch {
    unreadable.push(mcpPath);
  }

  const projectMcpPath = path.join(params.projectDir, '.cursor', 'mcp.json');
  // When the project is the home directory this is the global file, already checked.
  if (path.resolve(projectMcpPath) !== path.resolve(mcpPath)) {
    try {
      if (hasAutoMemServer(projectMcpPath)) projectRegistrations.push(projectMcpPath);
    } catch {
      unreadable.push(projectMcpPath);
    }
  }

  const rulePath = path.join(params.projectDir, '.cursor', 'rules', 'automem.mdc');
  try {
    if (fs.readFileSync(rulePath, 'utf8').includes(CURSOR_RULE_MARKER)) paths.push(rulePath);
  } catch {
    // Missing rule: nothing to report.
  }

  return { paths, projectRegistrations, unreadable };
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

export interface CommonOptions {
  dryRun?: boolean;
  quiet?: boolean;
  targetDir?: string;
  projectName?: string;
  yes?: boolean;
}

export function log(message: string, quiet?: boolean): void {
  if (!quiet) {
    console.log(message);
  }
}

export function backupPath(filePath: string): string {
  let candidate = `${filePath}.bak`;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${filePath}.bak.${counter}`;
    counter += 1;
  }
  return candidate;
}

export interface WriteResult {
  status: 'created' | 'updated' | 'unchanged' | 'dry-run';
}

export function writeFileWithBackup(
  targetPath: string,
  content: string,
  // `secret: true` restricts the file (and its backup) to 0o600 — pass it for
  // secret-bearing files like a .env carrying an API key or server token.
  opts: Pick<CommonOptions, 'dryRun' | 'quiet'> & { secret?: boolean },
): WriteResult {
  if (opts.dryRun) {
    log(`[DRY RUN] Would write: ${targetPath}`, opts.quiet);
    return { status: 'dry-run' };
  }

  const mode = opts.secret ? 0o600 : undefined;
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const existed = fs.existsSync(targetPath);
  if (existed) {
    const current = fs.readFileSync(targetPath, 'utf8');
    if (current === content) {
      log(`✓ Unchanged: ${path.basename(targetPath)}`, opts.quiet);
      return { status: 'unchanged' };
    }
    const backup = backupPath(targetPath);
    fs.copyFileSync(targetPath, backup);
    if (mode !== undefined) {
      try {
        fs.chmodSync(backup, mode);
      } catch {
        // best-effort: a permission tightening failure must not abort the write
      }
    }
    log(`📦 Backup created: ${backup}`, opts.quiet);
  }

  fs.writeFileSync(targetPath, content, mode !== undefined ? { encoding: 'utf8', mode } : 'utf8');
  if (mode !== undefined) {
    // writeFileSync's `mode` only applies when the file is created; chmod ensures
    // an existing (possibly world-readable) file is tightened too.
    try {
      fs.chmodSync(targetPath, mode);
    } catch {
      // best-effort
    }
  }
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(targetPath)}`, opts.quiet);
  return { status: existed ? 'updated' : 'created' };
}

// Quote .env values that would otherwise break dotenv parsing — empty strings and
// anything outside a conservative safe set (so whitespace, #, quotes, and shell
// metacharacters like $ ; {} stay inert). Shared by the setup and install writers
// so a value serializes identically regardless of which command wrote it.
export function formatEnvValue(value: string): string {
  if (value === '' || /[^A-Za-z0-9_@/:.,+-]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

// Merge KEY=value updates into an existing .env body without clobbering unrelated
// keys, comments, or blank lines: existing keys are rewritten in place and new keys
// appended. Uses hasOwnProperty (not `key in updates`) so a pre-existing line whose
// key collides with an Object.prototype member (e.g. `constructor`, `toString`) is
// preserved verbatim instead of corrupted. Pure (no I/O) so callers own the write.
export function mergeEnvContent(existing: string, updates: Record<string, string>): string {
  const lines: Array<{ key?: string; line: string }> = [];
  if (existing) {
    for (const line of existing.split(/\r?\n/)) {
      if (!line.trim()) {
        lines.push({ line });
        continue;
      }
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
      if (match) {
        lines.push({ key: match[1], line });
      } else {
        lines.push({ line });
      }
    }
  }

  const updatedKeys = new Set<string>();
  for (const entry of lines) {
    if (entry.key && Object.prototype.hasOwnProperty.call(updates, entry.key)) {
      entry.line = `${entry.key}=${formatEnvValue(updates[entry.key])}`;
      updatedKeys.add(entry.key);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      lines.push({ key, line: `${key}=${formatEnvValue(value)}` });
    }
  }

  const content = lines.map((entry) => entry.line).join(os.EOL).replace(/\s+$/, '');
  return content.length ? `${content}${os.EOL}` : '';
}

export function readJsonFile<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function replaceTemplateVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`{{${escapedKey}}}`, 'g'), () => value);
  }
  return result;
}

export function detectProjectName(cwd: string = process.cwd()): string {
  // 1) package.json name
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return String(pkg.name).replace(/^@.*?\//, '');
    } catch {
      // Fall through
    }
  }
  // 2) git remote
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      cwd,
      encoding: 'utf8',
    }).trim();
    if (remote) {
      const match = remote.match(/\/([^/]+?)(\.git)?$/);
      if (match) return match[1];
    }
  } catch {
    // Fall through
  }
  // 3) directory name
  return path.basename(cwd);
}

export type ExtraFlag =
  | { kind: 'value'; set: (value: string) => void }
  | { kind: 'boolean'; set: () => void };

/**
 * Shared parser for the flags every host handler uses:
 *   --dir <path>, --name <value>, --dry-run, --quiet, --yes / -y
 *
 * Pass `extra` to register host-specific flags. Examples:
 *   { '--rules': { kind: 'value', set: (v) => (rulesPath = v) } }
 *   { '--clean-all': { kind: 'boolean', set: () => (cleanAll = true) } }
 *
 * Unknown flags are silently ignored, matching the existing handlers.
 */
export function parseCommonFlags(
  args: string[],
  extra: Record<string, ExtraFlag> = {},
): CommonOptions {
  const options: CommonOptions = {};

  const requireValue = (flag: string, i: number): string => {
    if (i + 1 >= args.length) {
      console.error(`Error: ${flag} requires a value`);
      process.exit(1);
    }
    return args[i + 1];
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
        options.targetDir = requireValue('--dir', i);
        i += 1;
        break;
      case '--name':
        options.projectName = requireValue('--name', i);
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      default: {
        const handler = Object.prototype.hasOwnProperty.call(extra, arg) ? extra[arg] : undefined;
        if (!handler) break;
        if (handler.kind === 'boolean') {
          handler.set();
        } else {
          const value = requireValue(arg, i);
          handler.set(value);
          i += 1;
        }
      }
    }
  }

  return options;
}

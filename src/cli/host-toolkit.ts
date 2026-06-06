import fs from 'fs';
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
  opts: Pick<CommonOptions, 'dryRun' | 'quiet'>,
): WriteResult {
  if (opts.dryRun) {
    log(`[DRY RUN] Would write: ${targetPath}`, opts.quiet);
    return { status: 'dry-run' };
  }

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
    log(`📦 Backup created: ${backup}`, opts.quiet);
  }

  fs.writeFileSync(targetPath, content, 'utf8');
  log(`✅ ${existed ? 'Updated' : 'Created'}: ${path.basename(targetPath)}`, opts.quiet);
  return { status: existed ? 'updated' : 'created' };
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

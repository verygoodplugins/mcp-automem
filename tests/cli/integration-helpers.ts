import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect } from 'vitest';
import { parse as parseYaml } from 'yaml';

export type TempHome = {
  home: string;
  cleanup: () => void;
};

export function createTempHome(prefix: string): TempHome {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    home,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

export function expectNoFiles(paths: string[]): void {
  for (const filePath of paths) {
    expect(fs.existsSync(filePath), `${filePath} should not exist`).toBe(false);
  }
}

export function expectOutsideRealHermesHome(paths: string[]): void {
  const realHermesHome = path.join(os.homedir(), '.hermes');
  for (const filePath of paths) {
    const resolved = path.resolve(filePath);
    // Reject both ~/.hermes itself and anything under it.
    const insideRealHome = resolved === realHermesHome || resolved.startsWith(`${realHermesHome}${path.sep}`);
    expect(insideRealHome, `${filePath} must not touch the real ~/.hermes`).toBe(false);
  }
}

export function readFiles(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((filePath) => [filePath, fs.readFileSync(filePath, 'utf8')]));
}

export function expectFilesUnchanged(before: Record<string, string>): void {
  for (const [filePath, content] of Object.entries(before)) {
    expect(fs.readFileSync(filePath, 'utf8')).toBe(content);
  }
}

export function listBackups(filePath: string): string[] {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name === `${base}.bak` || name.startsWith(`${base}.bak.`))
    .map((name) => path.join(dir, name))
    .sort();
}

export function readMcpServerSummary(configPath: string): Record<
  string,
  { command?: string; args: string[]; envKeys: string[] }
> {
  const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
    mcp_servers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
  } | null;
  const servers = parsed?.mcp_servers ?? {};
  return Object.fromEntries(
    Object.entries(servers).map(([name, entry]) => [
      name,
      {
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args : [],
        envKeys: Object.keys(entry.env ?? {}).sort(),
      },
    ])
  );
}

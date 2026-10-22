#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const output = join(root, 'artifacts', 'mcp-automem.mcpb');
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
rmSync(`${output}.sha256`, { force: true });
if (manifest.version !== pkg.version) {
  throw new Error('Desktop extension manifest version must match package.json');
}
if (manifest.compatibility?.runtimes?.node !== pkg.engines.node) {
  throw new Error('Desktop extension Node runtime must match package.json engines');
}

// Never pack the developer checkout: only distribution files and locked production
// dependencies belong in the bundle. Keep staging outside the repo so it cannot
// accidentally resolve dependencies or credentials from the developer environment.
const staging = mkdtempSync(join(tmpdir(), 'automem-desktop-'));
try {
  for (const file of ['package.json', 'package-lock.json', ...pkg.files]) {
    cpSync(join(root, file), join(staging, file), {
      recursive: true,
      filter: (source) => !source.endsWith('.map') && !source.endsWith('.d.ts'),
    });
  }
  // npm's CLI is provided when this script is invoked through npm run. Using
  // Node directly avoids .cmd/shell quoting differences on Windows.
  if (!process.env.npm_execpath) throw new Error('Run this script with npm run build:extension');
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: staging, stdio: 'inherit' }
  );
  execFileSync(
    process.execPath,
    // Keep the packaging CLI pinned and outside the application's dependency tree.
    [
      process.env.npm_execpath,
      'exec',
      '--yes',
      '--package=@anthropic-ai/mcpb@2.1.2',
      '--',
      'mcpb',
      'pack',
      staging,
      output,
    ],
    { cwd: staging, stdio: 'inherit' }
  );
  const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(`${output}.sha256`, `${digest}  mcp-automem.mcpb\n`);
  console.log(`Desktop extension: ${output}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

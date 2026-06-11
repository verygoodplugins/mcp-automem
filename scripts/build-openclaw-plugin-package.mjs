#!/usr/bin/env node

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ROOT = join(REPO_ROOT, 'dist');
const OUTPUT_ROOT = join(DIST_ROOT, 'openclaw-plugin-package');
const OUTPUT_DIST = join(OUTPUT_ROOT, 'dist');

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const pluginManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'openclaw.plugin.json'), 'utf8'));
const runtimeFiles = [
  'openclaw-plugin.js',
  'openclaw-startup-profile.js',
  'automem-client.js',
  'types.js',
  'memory-policy/shared.js',
];

for (const filename of runtimeFiles) {
  const sourcePath = join(DIST_ROOT, filename);
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing OpenClaw plugin runtime file: ${sourcePath}`);
  }
}

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_DIST, { recursive: true });

writeFileSync(
  join(OUTPUT_ROOT, 'package.json'),
  `${JSON.stringify(
    {
      name: pluginManifest.id,
      version: pkg.version,
      type: 'module',
      private: true,
      openclaw: {
        extensions: ['./dist/openclaw-plugin.js'],
      },
    },
    null,
    2
  )}\n`
);

writeFileSync(join(OUTPUT_ROOT, 'openclaw.plugin.json'), `${JSON.stringify(pluginManifest, null, 2)}\n`);

for (const filename of runtimeFiles) {
  const targetPath = join(OUTPUT_DIST, filename);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(join(DIST_ROOT, filename), targetPath);
}

chmodSync(join(DIST_ROOT, 'index.js'), 0o755);
console.log(`✓ staged lean OpenClaw plugin package in ${join('dist', 'openclaw-plugin-package')}`);

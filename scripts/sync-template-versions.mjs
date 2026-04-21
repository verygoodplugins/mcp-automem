#!/usr/bin/env node
// Pegs every <!-- automem-template-version: x.y.z --> marker to package.json's version.
// Runs as the `prebuild` step so npm run build (CI + publish) keeps templates in sync.
// We never ship a template-prose change without also bumping the package, so one version
// number is the source of truth for both.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = /<!--\s*automem-template-version:\s*([\d.]+)\s*-->/g;

const pkgVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

// Use git to enumerate tracked files so we don't walk node_modules / dist / ad-hoc dirs.
const trackedFiles = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => /\.(md|mdc|template)$/.test(f));

let touched = 0;
let scanned = 0;

for (const rel of trackedFiles) {
  const abs = join(REPO_ROOT, rel);
  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  if (!content.includes('automem-template-version')) {
    continue;
  }
  scanned += 1;
  let changed = false;
  const next = content.replace(MARKER, (match, current) => {
    if (current === pkgVersion) return match;
    changed = true;
    return `<!-- automem-template-version: ${pkgVersion} -->`;
  });
  if (changed) {
    writeFileSync(abs, next);
    touched += 1;
    console.log(`  bumped ${relative(REPO_ROOT, abs)}`);
  }
}

console.log(
  touched === 0
    ? `✓ template versions already at ${pkgVersion} (${scanned} file${scanned === 1 ? '' : 's'} scanned)`
    : `✓ pegged ${touched} template${touched === 1 ? '' : 's'} to ${pkgVersion}`
);

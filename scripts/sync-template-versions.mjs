#!/usr/bin/env node
// Pegs every <!-- automem-template-version: x.y.z --> and <!-- automem-mdc-version: x.y.z -->
// marker to package.json's version, and appends the Release Please `generic` annotation that
// lets the release PR bump the markers in the same commit as package.json (see the
// `extra-files` list in release-please-config.json).
// Runs as the `prebuild` step so npm run build (CI + publish) keeps templates in sync.
// We never ship a template-prose change without also bumping the package, so one version
// number is the source of truth for both.
//
// The annotation goes in a separate trailing comment so the marker comment itself stays
// byte-identical for the `<!--\s*...\s*-->` parsers in src/cli/cursor.ts and
// tests/cli/smoke.test.ts. Matching the optional annotation here is what keeps re-runs
// idempotent instead of appending a second copy.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANNOTATION = '<!-- x-release-please-version -->';
// `[ \t]*` rather than `\s*` before the annotation: a newline must not be swallowed,
// or two adjacent marker lines would collapse into one.
const MARKER =
  /<!--\s*automem-(template|mdc)-version:\s*([\d.]+)\s*-->(?:[ \t]*<!--\s*x-release-please-version\s*-->)?/g;
const TEMPLATE_FILE_RE = /\.(md|mdc|template)$/;
const FALLBACK_ROOTS = ['templates', 'skills', 'plugins'];
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist']);

const pkgVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

function walkTemplateFiles(rootRel) {
  const rootAbs = join(REPO_ROOT, rootRel);
  if (!existsSync(rootAbs)) return [];

  const files = [];
  // Iterative depth-first traversal using an explicit stack to avoid recursion limits.
  const stack = [rootRel];

  while (stack.length > 0) {
    const currentRel = stack.pop();
    const currentAbs = join(REPO_ROOT, currentRel);

    for (const entry of readdirSync(currentAbs, { withFileTypes: true })) {
      const entryRel = join(currentRel, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          stack.push(entryRel);
        }
        continue;
      }
      if (entry.isFile() && TEMPLATE_FILE_RE.test(entryRel)) {
        files.push(entryRel);
      }
    }
  }

  return files;
}

function listCandidateFiles() {
  try {
    // Prefer git-tracked files so we match repository contents when git is available.
    return execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => TEMPLATE_FILE_RE.test(f));
  } catch {
    // Fallback for tarballs/zips or environments without git.
    return FALLBACK_ROOTS.flatMap((root) => walkTemplateFiles(root));
  }
}

const trackedFiles = listCandidateFiles();

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
  if (!/automem-(template|mdc)-version/.test(content)) {
    continue;
  }
  scanned += 1;
  let changed = false;
  const next = content.replace(MARKER, (match, kind) => {
    const pegged = `<!-- automem-${kind}-version: ${pkgVersion} --> ${ANNOTATION}`;
    if (match === pegged) return match;
    changed = true;
    return pegged;
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

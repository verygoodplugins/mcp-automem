import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/desktop-extension.yml', 'utf8'));
const validateRelease = workflow.jobs.publish.steps.find(
  (step: { name?: string }) => step.name === 'Verify release tag and package version'
).run;
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'automem-release-tag-'));
  directories.push(directory);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  git('init', '--quiet');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.17.0' }));
  git('add', 'package.json');
  git('commit', '--quiet', '-m', 'Initial test release');
  git('tag', 'mcp-automem-v0.17.0');
  const validate = (tag = 'mcp-automem-v0.17.0') =>
    execFileSync('bash', ['-e', '-c', validateRelease], {
      cwd: directory,
      env: { ...process.env, RELEASE_TAG: tag },
      stdio: 'pipe',
    });
  return { directory, git, validate };
}

describe('Desktop extension release identity', () => {
  it('accepts the checked-out release tag when its package version agrees', () => {
    expect(() => fixture().validate()).not.toThrow();
  });

  it('rejects a package version mismatch before installing or publishing', () => {
    const { directory, validate } = fixture();
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.18.0' }));
    expect(() => validate()).toThrow(/does not match package version/);
  });

  it('requires a tag, even when a branch has the requested release name', () => {
    const { git, validate } = fixture();
    git('tag', '-d', 'mcp-automem-v0.17.0');
    git('branch', 'mcp-automem-v0.17.0');
    expect(() => validate()).toThrow();
  });

  it('rejects a checkout that has moved past the tagged commit', () => {
    const { git, validate } = fixture();
    git('commit', '--allow-empty', '--quiet', '-m', 'Later commit');
    expect(() => validate()).toThrow(/does not match the release tag commit/);
  });

  it.each(['main', '--help', 'mcp-automem-v0.17.0\nother'])('rejects malformed tag %j', (tag) => {
    expect(() => fixture().validate(tag)).toThrow(/Expected a release tag/);
  });
});

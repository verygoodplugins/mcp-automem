/**
 * Tests for templates/claude-code/hooks/capture-build-result.sh
 *
 * Verifies:
 *   - The matcher captures real build commands and only real build commands.
 *   - Queue entries use BARE tags with no namespace prefixes.
 *   - Language hint derives from the build tool (npm → typescript, cargo → rust, …).
 *   - The previous `grep -c warning || echo 0` + `grep -c error || echo 0` bug
 *     (which produced "0\n0" and triggered bash integer-expression warnings)
 *     is fixed — stderr must be clean on a zero-error, zero-warning build.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, findNamespaceTags, runCaptureHook, VALID_TYPES } from './helpers';

describe('capture-build-result.sh', () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length) cleanup(homes.pop()!);
  });

  function run(input: Parameters<typeof runCaptureHook>[1]) {
    const result = runCaptureHook('capture-build-result.sh', input);
    homes.push(result.home);
    return result;
  }

  describe('matcher', () => {
    it.each([
      ['npm run build', 'npm run build'],
      ['yarn build', 'yarn build'],
      ['pnpm build', 'pnpm build'],
      ['cargo build', 'cargo build --release'],
      ['go build', 'go build ./...'],
      ['make', 'make all'],
    ])('captures: %s', (_label, command) => {
      const result = run({ command, exitCode: 0, output: 'Built in 2.5s, size: 100 KB' });
      expect(result.queue).toHaveLength(1);
    });

    it.each([
      ['npm test (not build)', 'npm test'],
      ['npm install (not build)', 'npm install'],
      ['ls (unrelated)', 'ls -la'],
    ])('skips: %s', (_label, command) => {
      const result = run({ command });
      expect(result.queue).toHaveLength(0);
    });
  });

  describe('tag emission', () => {
    it('emits bare tags for npm build — infers typescript', () => {
      const result = run({
        command: 'npm run build',
        exitCode: 0,
        output: 'Built in 3s, size: 250 KB',
        cwd: '/tmp/frontend-app',
      });
      expect(result.queue).toHaveLength(1);
      const { tags, type } = result.queue[0];
      expect(findNamespaceTags(tags)).toEqual([]);
      expect(tags).toContain('build');
      expect(tags).toContain('npm');
      expect(tags).toContain('typescript');
      expect(tags).toContain('frontend-app');
      expect(VALID_TYPES).toContain(type);
    });

    it('infers rust from cargo', () => {
      const result = run({
        command: 'cargo build --release',
        exitCode: 0,
        output: 'Compiling mycrate v0.1.0\n    Finished release in 12.34s',
        cwd: '/tmp/rust-crate',
      });
      expect(result.queue[0].tags).toContain('rust');
      expect(result.queue[0].tags).toContain('cargo');
    });

    it('infers go from go build', () => {
      const result = run({
        command: 'go build ./cmd/server',
        exitCode: 0,
        output: '',
        cwd: '/tmp/go-service',
      });
      expect(result.queue[0].tags).toContain('go');
    });

    it('adds "failure" tag on non-zero exit', () => {
      const result = run({
        command: 'npm run build',
        exitCode: 1,
        output: 'ERROR: Cannot find module',
      });
      expect(result.queue[0].tags).toContain('failure');
    });
  });

  describe('bash cleanliness — no integer-expression warnings', () => {
    it('stderr is clean on a zero-warning, zero-error build', () => {
      const result = run({
        command: 'npm run build',
        exitCode: 0,
        output: 'Built in 3s, size: 250 KB',
      });
      expect(result.stderr).not.toMatch(/integer expression expected/);
      expect(result.stderr).not.toMatch(/\[: 0\s/);
    });

    it('stderr is clean when the build output contains the word "warning"', () => {
      const result = run({
        command: 'npm run build',
        exitCode: 0,
        output: 'Built in 3s\nwarning: deprecated API usage\n',
      });
      expect(result.stderr).not.toMatch(/integer expression expected/);
    });
  });
});

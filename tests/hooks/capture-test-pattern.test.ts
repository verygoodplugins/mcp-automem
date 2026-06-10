/**
 * Tests for templates/claude-code/hooks/capture-test-pattern.sh
 *
 * Verifies matcher accuracy and bare-tag emission. Uses the same pattern as
 * the build-result tests — an isolated HOME per invocation, inspection of the
 * resulting JSONL queue entry.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, findNamespaceTags, runCaptureHook, VALID_TYPES } from './helpers';

describe('capture-test-pattern.sh', () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length) cleanup(homes.pop()!);
  });

  function run(input: Parameters<typeof runCaptureHook>[1]) {
    const result = runCaptureHook('capture-test-pattern.sh', input);
    homes.push(result.home);
    return result;
  }

  describe('matcher', () => {
    // Output must be parseable for the framework: a passing run that parses
    // zero tests is skipped by the noise guard (see its own describe below).
    it.each([
      ['pytest', 'pytest tests/', '42 passed in 1.3s', 0],
      ['npm test', 'npm test', 'Tests: 42 passed', 0],
      ['yarn test', 'yarn test', 'Tests: 42 passed', 0],
      ['jest', 'jest --coverage', 'Tests: 42 passed', 0],
      ['vitest', 'vitest run', 'Tests: 42 passed', 0],
      ['go test', 'go test ./...', 'ok\texample.com/pkg\t0.4s\nPASS', 0],
      ['cargo test (failure)', 'cargo test --release', 'test result: FAILED. 0 passed; 1 failed', 1],
    ])('captures: %s', (_label, command, output, exitCode) => {
      const result = run({ command, exitCode, output });
      expect(result.queue).toHaveLength(1);
    });

    it.each([
      ['npm run build (not a test)', 'npm run build'],
      ['ls (unrelated)', 'ls'],
    ])('skips: %s', (_label, command) => {
      const result = run({ command });
      expect(result.queue).toHaveLength(0);
    });
  });

  describe('zero-parse noise guard', () => {
    it('skips a passing run whose output parses zero tests', () => {
      // e.g. output truncated by `| tail` so counts never appear — queueing
      // would store a "Test suite passed: 0 tests" memory, which is noise.
      const result = run({ command: 'npm test', exitCode: 0, output: 'output elided' });
      expect(result.queue).toHaveLength(0);
    });

    it('still captures a failing run even when counts are unparseable', () => {
      const result = run({ command: 'npm test', exitCode: 1, output: 'something exploded' });
      expect(result.queue).toHaveLength(1);
    });
  });

  describe('tag emission', () => {
    it('emits bare tags for pytest — infers python', () => {
      const result = run({
        command: 'pytest tests/',
        exitCode: 0,
        output: '42 passed in 1.3s',
        cwd: '/tmp/py-project',
      });
      const { tags, type } = result.queue[0];
      expect(findNamespaceTags(tags)).toEqual([]);
      expect(tags).toContain('test');
      expect(tags).toContain('pytest');
      expect(tags).toContain('python');
      expect(tags).toContain('py-project');
      expect(VALID_TYPES).toContain(type);
    });

    it('rewrites jest/vitest framework slash to hyphen', () => {
      const result = run({
        command: 'npm test',
        exitCode: 0,
        output: 'Tests: 10 passed',
        cwd: '/tmp/ts-app',
      });
      const { tags } = result.queue[0];
      expect(findNamespaceTags(tags)).toEqual([]);
      // Slash in framework would be misread by the prefix index, so the hook
      // must flatten it.
      expect(tags).not.toContain('jest/vitest');
      expect(tags).toContain('jest-vitest');
      expect(tags).toContain('typescript');
    });

    it('adds "failure" tag when any test fails', () => {
      const result = run({
        command: 'pytest',
        exitCode: 1,
        output: '3 failed, 10 passed',
      });
      expect(result.queue[0].tags).toContain('failure');
    });
  });
});

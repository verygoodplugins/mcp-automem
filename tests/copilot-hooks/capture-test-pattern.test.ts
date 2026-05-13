/**
 * Execution tests for templates/copilot/scripts/capture-test-pattern.{sh,ps1}
 *
 * Both bash and pwsh variants are tested. Each describe block is skipped when
 * the required interpreter is not available.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup, findNamespaceTags, hasBash, hasPwsh,
  runCaptureHook, VALID_TYPES, type Shell,
} from './helpers';

function testCaptureSuite(shell: Shell) {
  const homes: string[] = [];
  afterEach(() => { while (homes.length) cleanup(homes.pop()!); });

  function run(input: Parameters<typeof runCaptureHook>[2]) {
    const result = runCaptureHook(shell, 'capture-test-pattern', input);
    homes.push(result.home);
    return result;
  }

  describe('matcher', () => {
    it.each([
      ['pytest', 'pytest tests/'],
      ['npm test', 'npm test'],
      ['yarn test', 'yarn test'],
      ['jest', 'jest --coverage'],
      ['vitest', 'vitest run'],
      ['go test', 'go test ./...'],
      ['cargo test', 'cargo test --release'],
      ['dotnet test', 'dotnet test'],
    ])('captures: %s', (_label, command) => {
      const result = run({ command, exitCode: 0, output: '42 passed in 1s' });
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

  describe('tag emission', () => {
    it('emits bare tags for pytest -- infers python', () => {
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
      expect(tags).toContain('py-project');
      expect(VALID_TYPES).toContain(type);
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
}

describe.skipIf(!hasBash())('capture-test-pattern.sh (bash)', () => {
  testCaptureSuite('bash');
});

describe.skipIf(!hasPwsh())('capture-test-pattern.ps1 (pwsh)', () => {
  testCaptureSuite('pwsh');
});

import type { Reporter, TestModule } from 'vitest/node';

/** Required service checks must never pass with an empty or skipped suite. */
export default class IntegrationReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const tests = modules.flatMap((module) => [...module.children.allTests()]);
    if (tests.length === 0 || tests.some((test) => test.result().state === 'skipped')) {
      process.exitCode = 1;
      console.error('Required AutoMem integration suite must execute tests without skips');
    }
  }
}

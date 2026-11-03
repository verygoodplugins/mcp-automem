import { defineConfig } from 'vitest/config';
import IntegrationReporter from './scripts/integration-reporter.js';

/**
 * Integration test configuration.
 * Runs tests against real AutoMem service.
 *
 * Usage: npx vitest run --config vitest.integration.config.ts
 * Requires: AutoMem service at AUTOMEM_TEST_API_URL (default: http://localhost:8001)
 */
export default defineConfig({
  test: {
    globals: true,
    reporters:
      process.env.AUTOMEM_REQUIRE_SERVICE === '1' || process.env.CI === 'true'
        ? ['default', new IntegrationReporter()]
        : ['default'],
    environment: 'node',
    include: ['tests/integration/automem-service.test.ts'],
    testTimeout: 30000, // Integration tests may be slower
    hookTimeout: 10000,
  },
});

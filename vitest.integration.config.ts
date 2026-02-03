import { defineConfig } from 'vitest/config';

/**
 * Integration test configuration.
 * Runs tests against real AutoMem service.
 *
 * Usage: npx vitest run --config vitest.integration.config.ts
 * Requires: AutoMem service at AUTOMEM_TEST_ENDPOINT (default: http://localhost:8001)
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/automem-service.test.ts'],
    testTimeout: 30000, // Integration tests may be slower
    hookTimeout: 10000,
  },
});

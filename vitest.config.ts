import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Default: exclude integration tests (they need real service)
    // Run integration tests with: npm run test:integration
    exclude: [
      'node_modules/**',
      'dist/**',
      'tests/integration/automem-service.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/', '*.config.*'],
    },
  },
});

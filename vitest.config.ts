import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Setting `exclude` REPLACES vitest's defaults, so everything that must stay out of
    // the run has to be listed here — including the recursive `**/` forms, or a nested
    // copy of the repo brings its own node_modules and dist back into scope.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Agent worktrees under .claude/worktrees/ are full checkouts of this repo. Without
      // this, `npm test` from the main checkout globs every suite twice — once from the
      // real tree and once from each worktree's (stale) copy — and reports failures for
      // code that is not the code under test.
      '**/.claude/**',
      // Integration tests need a real service; run them with `npm run test:integration`.
      'tests/integration/automem-service.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/', '*.config.*'],
    },
  },
});

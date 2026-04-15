import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest config fragment — coverage thresholds and reporters.
 *
 * Each package extends this via `defineConfig({ ...sharedConfig.test, ... })`.
 *
 * Thresholds are intentionally modest for V1: we want a safety net against
 * regression, not a blocker for shipping. Raise over time as the codebase
 * stabilizes.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.config.ts',
        '**/*.config.js',
        '**/coverage/**',
      ],
      // V1 thresholds — raise as coverage grows
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 40,
        statements: 40,
      },
    },
  },
});

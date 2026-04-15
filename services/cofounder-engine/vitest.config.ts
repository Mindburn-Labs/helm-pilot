import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'dist/**',
        'node_modules/**',
        'src/__tests__/**',
        '**/*.test.ts',
        '**/*.config.ts',
        'coverage/**',
      ],
    },
  },
});

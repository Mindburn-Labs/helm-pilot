import { defineConfig } from '@playwright/test';

/**
 * Playwright config for HELM Pilot E2E tests.
 *
 * Tests expect a running gateway on BASE_URL (default http://localhost:3100).
 * In CI, the workflow spins up postgres + gateway via docker-compose before running.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // auth tests share a user — serialize
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Web server config omitted — tests assume the gateway is already running
  // (started manually, by docker-compose, or by the launch-gate script).
});

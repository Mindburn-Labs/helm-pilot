import { test, expect } from '@playwright/test';

test.describe('Security Headers', () => {
  test('X-Content-Type-Options: nosniff is set', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options is present', async ({ request }) => {
    const response = await request.get('/health');
    const xfo = response.headers()['x-frame-options'];
    expect(xfo).toBeDefined();
    expect(['DENY', 'SAMEORIGIN']).toContain(xfo);
  });

  test('security headers are present on API routes', async ({ request }) => {
    const response = await request.get('/api/tasks');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBeDefined();
  });
});

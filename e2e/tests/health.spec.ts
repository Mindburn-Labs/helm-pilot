import { test, expect } from '@playwright/test';

test.describe('Health & Public Endpoints', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBeLessThanOrEqual(503); // 200 or 503
    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('service', 'pilot');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('checks');
    expect(body.checks).toHaveProperty('db');
  });

  test('root endpoint returns metadata', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('name', 'pilot');
    expect(body).toHaveProperty('version');
  });

  test('metrics endpoint serves Prometheus format', async ({ request }) => {
    const response = await request.get('/metrics');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('pilot_http_requests_total');
    expect(text).toContain('# TYPE');
  });

  test('security headers are present on health endpoint', async ({ request }) => {
    const response = await request.get('/health');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    // Hono's secureHeaders sets X-Frame-Options (via secure-headers middleware)
    expect(headers['x-frame-options']).toBeDefined();
  });

  test('request correlation ID is echoed in response', async ({ request }) => {
    const response = await request.get('/health');
    const headers = response.headers();
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('provided X-Request-Id is preserved', async ({ request }) => {
    const customId = '11111111-2222-3333-4444-555555555555';
    const response = await request.get('/health', {
      headers: { 'X-Request-Id': customId },
    });
    expect(response.headers()['x-request-id']).toBe(customId);
  });

  test('404 for unknown routes', async ({ request }) => {
    const response = await request.get('/nonexistent-route');
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('invalid JSON in request body returns 400', async ({ request }) => {
    const response = await request.post('/api/auth/email/request', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not valid json{{',
    });
    expect(response.status()).toBe(400);
  });
});

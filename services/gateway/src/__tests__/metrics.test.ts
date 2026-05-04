import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { metricsEndpoint } from '../middleware/metrics.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function app() {
  const hono = new Hono();
  hono.get('/metrics', metricsEndpoint());
  return hono;
}

describe('metricsEndpoint', () => {
  it('blocks production metrics when no token or explicit public override is configured', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['METRICS_AUTH_TOKEN'];
    delete process.env['METRICS_ALLOW_PUBLIC'];

    const res = await app().request('/metrics');

    expect(res.status).toBe(404);
  });

  it('requires the configured metrics token', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['METRICS_AUTH_TOKEN'] = 'secret-token';

    const missing = await app().request('/metrics');
    const wrong = await app().request('/metrics', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const ok = await app().request('/metrics', {
      headers: { Authorization: 'Bearer secret-token' },
    });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(403);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('pilot_');
  });
});

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bodyLimit } from '../../middleware/body-limit.js';

function makeApp(limit: number) {
  const app = new Hono();
  app.use('*', bodyLimit(limit));
  app.post('/x', async (c) => c.json({ ok: true }));
  app.get('/x', async (c) => c.json({ ok: true }));
  return app;
}

describe('bodyLimit middleware', () => {
  it('allows POST under the limit', async () => {
    const app = makeApp(1000);
    const res = await app.fetch(new Request('http://x/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '500' },
      body: 'x'.repeat(500),
    }));
    expect(res.status).toBe(200);
  });

  it('returns 413 when Content-Length exceeds limit', async () => {
    const app = makeApp(1000);
    const res = await app.fetch(new Request('http://x/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '5000' },
      body: 'x'.repeat(5000),
    }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('maxBytes', 1000);
  });

  it('skips GET requests', async () => {
    const app = makeApp(10);
    const res = await app.fetch(new Request('http://x/x', { method: 'GET' }));
    expect(res.status).toBe(200);
  });

  it('allows requests with no Content-Length header (streaming fallback)', async () => {
    const app = makeApp(1000);
    const res = await app.fetch(new Request('http://x/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }));
    // No Content-Length → middleware lets through; downstream parser still enforces
    expect(res.status).toBe(200);
  });

  it('ignores invalid Content-Length', async () => {
    const app = makeApp(1000);
    const res = await app.fetch(new Request('http://x/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': 'not-a-number' },
    }));
    expect(res.status).toBe(200);
  });
});

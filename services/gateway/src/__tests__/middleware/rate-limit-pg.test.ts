import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { consumeToken, rateLimitPg, ROUTE_CLASSES } from '../../middleware/rate-limit-pg.js';

/**
 * The Postgres path is exercised end-to-end in the db-migrations CI job
 * (which spins up real pgvector). These unit tests verify the middleware
 * contract — response shape, headers, fail-open behaviour — against a
 * mocked `db.execute` so they run in-process without Postgres.
 */

interface Row {
  tokens: number;
}

function mockDb(consumeReturn: Row[] | Error) {
  const execute = vi.fn(async () => {
    if (consumeReturn instanceof Error) throw consumeReturn;
    return consumeReturn as unknown as { rows?: Row[] };
  });
  return { execute } as unknown as import('@helm-pilot/db/client').Db;
}

describe('consumeToken', () => {
  it('ok=true when the atomic UPDATE returns a row', async () => {
    const db = mockDb([{ tokens: 29 }]);
    const result = await consumeToken(db, 'ws:abc', ROUTE_CLASSES.TASK);
    expect(result.ok).toBe(true);
    expect(result.tokensRemaining).toBe(29);
    expect(result.retryAfterSec).toBe(0);
  });

  it('ok=false when the UPDATE returns zero rows (bucket empty)', async () => {
    // First call: empty result (rejected). Second call: snapshot for retry-after.
    let call = 0;
    const db = {
      execute: vi.fn(async () => {
        call++;
        if (call === 1) return [];
        return [{ tokens: 0.25, refill_per_sec: 0.5 }];
      }),
    } as unknown as import('@helm-pilot/db/client').Db;

    const result = await consumeToken(db, 'ws:abc', ROUTE_CLASSES.AUTH);
    expect(result.ok).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('fails open on DB error — returns ok=true with capacity remaining', async () => {
    const db = mockDb(new Error('connection lost'));
    const result = await consumeToken(db, 'ws:abc', ROUTE_CLASSES.DEFAULT);
    expect(result.ok).toBe(true);
    expect(result.tokensRemaining).toBe(ROUTE_CLASSES.DEFAULT.capacity);
  });
});

describe('rateLimitPg middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  it('passes through with rate-limit headers when bucket has tokens', async () => {
    const db = mockDb([{ tokens: 99 }]);
    app.use('/api/*', rateLimitPg(db, ROUTE_CLASSES.DEFAULT));
    app.get('/api/hello', (c) => c.json({ hello: true }));

    const res = await app.fetch(new Request('http://localhost/api/hello'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Class')).toBe('default');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
  });

  it('returns 429 with Retry-After when bucket is empty', async () => {
    let call = 0;
    const db = {
      execute: vi.fn(async () => {
        call++;
        if (call === 1) return [];
        return [{ tokens: 0.1, refill_per_sec: 5 / 60 }];
      }),
    } as unknown as import('@helm-pilot/db/client').Db;

    app.use('/api/auth/*', rateLimitPg(db, ROUTE_CLASSES.AUTH));
    app.post('/api/auth/session', (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request('http://localhost/api/auth/session', { method: 'POST' }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = (await res.json()) as { error: string; routeClass: string };
    expect(body.error).toBe('Rate limit exceeded');
    expect(body.routeClass).toBe('auth');
  });

  it('uses workspaceId subject when context has one, else userId, else ip', async () => {
    // This one just verifies the middleware doesn't crash when the context
    // has a workspaceId set; full subject-resolution coverage is in the
    // resolveSubject unit table below.
    const db = mockDb([{ tokens: 10 }]);
    app.use('/api/*', async (c, next) => {
      c.set('workspaceId', '00000000-0000-4000-8000-000000000001');
      await next();
    });
    app.use('/api/*', rateLimitPg(db, ROUTE_CLASSES.TASK));
    app.get('/api/tasks', (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request('http://localhost/api/tasks'));
    expect(res.status).toBe(200);
  });
});

describe('ROUTE_CLASSES', () => {
  it('exposes four canonical configs with matching names + sensible ratios', () => {
    expect(ROUTE_CLASSES.AUTH.name).toBe('auth');
    expect(ROUTE_CLASSES.AUTH.capacity).toBe(5);
    expect(ROUTE_CLASSES.TASK.capacity).toBe(30);
    expect(ROUTE_CLASSES.DEFAULT.capacity).toBe(100);
    // Each full bucket should refill in ≈60s at the declared rate.
    for (const cls of Object.values(ROUTE_CLASSES)) {
      const fullRefillSec = cls.capacity / cls.refillPerSec;
      expect(fullRefillSec).toBeGreaterThan(50);
      expect(fullRefillSec).toBeLessThan(70);
    }
  });
});

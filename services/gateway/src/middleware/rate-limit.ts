import { type Context, type MiddlewareHandler, type Next } from 'hono';
import { createLogger } from '@pilot/shared/logger';

const log = createLogger('rate-limit');

// ─── Store Interface ───

interface RateLimitStore {
  /** Increment counter and return current count + TTL (seconds). */
  increment(key: string, windowMs: number): Promise<{ count: number; retryAfter: number }>;
}

// ─── In-Memory Store (single-process default) ───

interface MemoryEntry {
  count: number;
  resetAt: number;
}

class MemoryStore implements RateLimitStore {
  private readonly store = new Map<string, MemoryEntry>();

  constructor() {
    // Cleanup stale entries every minute
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.resetAt < now) this.store.delete(key);
      }
    }, 60_000).unref();
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; retryAfter: number }> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return { count: 1, retryAfter: Math.ceil(windowMs / 1000) };
    }
    entry.count++;
    return { count: entry.count, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
}

// ─── Redis Store (distributed) ───

// Minimal structural type for ioredis — avoids a direct dependency.
type RedisLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  multi(): any;
};

class RedisStore implements RateLimitStore {
  constructor(private readonly redis: RedisLike, private readonly keyPrefix = 'ratelimit:') {}

  async increment(key: string, windowMs: number): Promise<{ count: number; retryAfter: number }> {
    const fullKey = `${this.keyPrefix}${key}`;
    // Atomic: INCR + PEXPIRE + PTTL in one round-trip
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: Array<[Error | null, unknown]> | null = (await (this.redis as any)
      .multi()
      .incr(fullKey)
      .pexpire(fullKey, windowMs)
      .pttl(fullKey)
      .exec());

    if (!results) {
      // Redis error — fail open (don't block requests)
      return { count: 0, retryAfter: 0 };
    }

    const count = Number(results[0]?.[1] ?? 0);
    const ttlMs = Number(results[2]?.[1] ?? windowMs);
    return { count, retryAfter: Math.max(1, Math.ceil(ttlMs / 1000)) };
  }
}

// ─── Store Factory ───

let sharedStore: RateLimitStore | null = null;

/**
 * Configure a shared Redis client for rate limiting.
 * Falls back to in-memory if Redis is unavailable.
 */
export function configureRateLimit(redis: RedisLike | null) {
  if (redis) {
    sharedStore = new RedisStore(redis);
    log.info('Rate limiter using Redis backend');
  } else {
    sharedStore = new MemoryStore();
    log.info('Rate limiter using in-memory store');
  }
}

function getStore(): RateLimitStore {
  if (!sharedStore) sharedStore = new MemoryStore();
  return sharedStore;
}

/** Reset the shared store — used by tests to isolate state between cases. */
export function _resetRateLimitForTests(): void {
  sharedStore = new MemoryStore();
}

// ─── Middleware ───

/**
 * Rate limit middleware — sliding window counter.
 *
 * Uses the shared store (Redis if configured, in-memory otherwise).
 * Identifies clients by authenticated userId, then x-forwarded-for IP, then 'anonymous'.
 */
export function rateLimit(opts: { windowMs?: number; max?: number; keyPrefix?: string } = {}): MiddlewareHandler {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 100;
  const prefix = opts.keyPrefix ?? '';

  return async (c: Context, next: Next) => {
    const identifier = c.get('userId') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anonymous';
    const key = `${prefix}${identifier}`;

    const { count, retryAfter } = await getStore().increment(key, windowMs);

    // Set standard rate limit headers
    c.res.headers.set('X-RateLimit-Limit', String(max));
    c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, max - count)));

    if (count > max) {
      c.res.headers.set('Retry-After', String(retryAfter));
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    await next();
  };
}

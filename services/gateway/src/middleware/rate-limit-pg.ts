import { sql } from 'drizzle-orm';
import { type Context, type MiddlewareHandler, type Next } from 'hono';
import { type Db } from '@pilot/db/client';
import { createLogger } from '@pilot/shared/logger';

const log = createLogger('rate-limit-pg');

/**
 * Tenant-partitioned token-bucket rate limiter backed by Postgres.
 *
 * The bucket for each (subject, routeClass) is upserted on demand. The
 * consume operation is a single SQL statement that:
 *
 *   1. Refills the bucket based on wall-clock delta since `last_refill_at`,
 *      capped at `capacity`.
 *   2. Succeeds-with-row only when the refilled level is ≥ 1, decrementing
 *      the level by 1 atomically.
 *   3. Returns 0 rows (→ 429) when the bucket is empty.
 *
 * Postgres MVCC serializes concurrent updates on the same primary key so
 * two parallel requests can never both drain the last token — one will see
 * the other's decremented value on its `WHERE tokens + refill >= 1` check
 * and be rejected.
 *
 * Fail-open policy: DB errors (connection lost, timeout) are logged and
 * the request is allowed through. Rejecting legitimate traffic during a
 * transient DB outage is a worse failure mode than a brief bypass of the
 * limiter; aggressive-tenant protection resumes automatically when the DB
 * recovers.
 */

export type Subject = string;

export interface RateLimitBucketConfig {
  /** Maximum burst size. Also the bucket capacity. */
  capacity: number;
  /** Sustained refill rate. `capacity / refillPerSec` ~= full-bucket period. */
  refillPerSec: number;
}

export interface RouteClassConfig extends RateLimitBucketConfig {
  /** Label surfaced in `X-RateLimit-Class` and the buckets table. */
  name: string;
}

export interface RateLimitConsumeResult {
  ok: boolean;
  tokensRemaining: number;
  capacity: number;
  /** Seconds until the bucket holds at least 1 token again. 0 when ok=true. */
  retryAfterSec: number;
}

/**
 * Attempt to consume a single token from the `(subject, routeClass)` bucket.
 *
 * Implementation notes:
 *   - The INSERT creates the bucket at capacity-1 (reserving the current
 *     request's token in the same statement).
 *   - ON CONFLICT performs the refill + decrement atomically.
 *   - The `WHERE` inside the ON CONFLICT branch conditionally rejects when
 *     the refilled level is still < 1, leaving the row untouched so the
 *     application layer can surface 429.
 */
export async function consumeToken(
  db: Db,
  subject: Subject,
  cfg: RouteClassConfig,
): Promise<RateLimitConsumeResult> {
  try {
    const result = await db.execute<{ tokens: number }>(sql`
      INSERT INTO "ratelimit_buckets" (
        "subject", "route_class", "tokens", "capacity",
        "refill_per_sec", "last_refill_at", "updated_at"
      )
      VALUES (
        ${subject}, ${cfg.name},
        ${cfg.capacity - 1}, ${cfg.capacity}, ${cfg.refillPerSec},
        now(), now()
      )
      ON CONFLICT ("subject", "route_class") DO UPDATE SET
        "tokens" = LEAST(
          "ratelimit_buckets"."capacity",
          "ratelimit_buckets"."tokens"
            + EXTRACT(EPOCH FROM (now() - "ratelimit_buckets"."last_refill_at"))
              * "ratelimit_buckets"."refill_per_sec"
        ) - 1,
        "last_refill_at" = now(),
        "updated_at" = now(),
        "capacity" = EXCLUDED."capacity",
        "refill_per_sec" = EXCLUDED."refill_per_sec"
      WHERE LEAST(
        "ratelimit_buckets"."capacity",
        "ratelimit_buckets"."tokens"
          + EXTRACT(EPOCH FROM (now() - "ratelimit_buckets"."last_refill_at"))
            * "ratelimit_buckets"."refill_per_sec"
      ) >= 1
      RETURNING "tokens"
    `);

    // `postgres` returns rows as an array-like. Drizzle's execute returns the
    // query result; we count rows to discriminate allow vs deny.
    const rows = result as unknown as Array<{ tokens: number }>;
    if (rows.length === 0) {
      // Row exists but refilled level is still below 1 → rejected. Compute
      // the wait by querying the current state for a retry-after hint.
      const snapshot = await db.execute<{ tokens: number; refill_per_sec: number }>(sql`
        SELECT "tokens", "refill_per_sec" FROM "ratelimit_buckets"
        WHERE "subject" = ${subject} AND "route_class" = ${cfg.name}
      `);
      const snapRows = snapshot as unknown as Array<{ tokens: number; refill_per_sec: number }>;
      const state = snapRows[0];
      const deficit = 1 - (state?.tokens ?? 0);
      const retryAfterSec = state?.refill_per_sec
        ? Math.max(1, Math.ceil(deficit / state.refill_per_sec))
        : 1;
      return { ok: false, tokensRemaining: 0, capacity: cfg.capacity, retryAfterSec };
    }

    const tokensRemaining = Math.max(0, Number(rows[0]?.tokens ?? 0));
    return { ok: true, tokensRemaining, capacity: cfg.capacity, retryAfterSec: 0 };
  } catch (err) {
    log.error({ err, subject, routeClass: cfg.name }, 'rate-limit DB error — failing open');
    return { ok: true, tokensRemaining: cfg.capacity, capacity: cfg.capacity, retryAfterSec: 0 };
  }
}

/**
 * Resolve the rate-limit subject from the Hono context. Prefers the
 * workspaceId (so per-tenant ceilings apply to all a founder's devices),
 * falls back to userId, then to the forwarded IP, then to 'anonymous'.
 */
function resolveSubject(c: Context): Subject {
  const workspaceId = c.get('workspaceId') as string | undefined;
  if (workspaceId) return `ws:${workspaceId}`;
  const userId = c.get('userId') as string | undefined;
  if (userId) return `u:${userId}`;
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) return `ip:${ip}`;
  return 'anon';
}

export interface RateLimitPgOptions extends RouteClassConfig {}

/**
 * Hono middleware factory. Each configured route gets its own RouteClass
 * so ceilings don't bleed across families (auth vs task vs default).
 */
export function rateLimitPg(db: Db, opts: RateLimitPgOptions): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const subject = resolveSubject(c);
    const result = await consumeToken(db, subject, opts);

    c.res.headers.set('X-RateLimit-Class', opts.name);
    c.res.headers.set('X-RateLimit-Limit', String(opts.capacity));
    c.res.headers.set('X-RateLimit-Remaining', String(Math.floor(result.tokensRemaining)));

    if (!result.ok) {
      c.res.headers.set('Retry-After', String(result.retryAfterSec));
      return c.json(
        {
          error: 'Rate limit exceeded',
          routeClass: opts.name,
          retryAfterSec: result.retryAfterSec,
        },
        429,
      );
    }

    await next();
  };
}

// ─── Canonical route-class configs ────────────────────────────────────────
// Centralizing these in one place lets the gateway wire them consistently.
// Per-tenant hard ceilings live here; operators tune them via PR, not env.

export const ROUTE_CLASSES = {
  AUTH: { name: 'auth', capacity: 5, refillPerSec: 5 / 60 } satisfies RouteClassConfig,
  CONNECTOR_OAUTH: {
    name: 'connector_oauth',
    capacity: 10,
    refillPerSec: 10 / 60,
  } satisfies RouteClassConfig,
  TASK: { name: 'task', capacity: 30, refillPerSec: 30 / 60 } satisfies RouteClassConfig,
  DEFAULT: { name: 'default', capacity: 100, refillPerSec: 100 / 60 } satisfies RouteClassConfig,
} as const;

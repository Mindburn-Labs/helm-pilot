import type PgBoss from 'pg-boss';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '@pilot/db/client';
import { createLogger } from '@pilot/shared/logger';
import type { OAuthFlowManager } from './oauth.js';

const log = createLogger('connectors.refresh');

/**
 * OAuth token refresh background worker (Phase 13, Track B).
 *
 * Two pg-boss queues:
 *   - `connectors.refresh.tick`    — cron, fires every 60s, queries eligible
 *                                    grants and enqueues one `.grant` job
 *                                    per eligible grant.
 *   - `connectors.refresh.grant`   — worker, one invocation per grant. Uses
 *                                    a pg advisory lock so concurrent ticks
 *                                    of the same grant collapse into one
 *                                    network call. Routes outcomes:
 *                                      success  → reset attempts, clear err
 *                                      transient → bump attempts, log err
 *                                      permanent → set needs_reauth, notify
 *
 * Thresholds (SOTA, April 2026):
 *   PROACTIVE_WINDOW_MS = 30 * 60 * 1000     // refresh if expires <30m
 *   PERMANENT_AFTER_ATTEMPTS = 3             // set needs_reauth after 3 fails
 *   TICK_BATCH_LIMIT = 50                    // cap fan-out per tick
 */

export const PROACTIVE_WINDOW_MS = 30 * 60 * 1000;
export const PERMANENT_AFTER_ATTEMPTS = 3;
export const TICK_BATCH_LIMIT = 50;

const TICK_QUEUE = 'connectors.refresh.tick';
const GRANT_QUEUE = 'connectors.refresh.grant';
const TICK_CRON = '*/1 * * * *'; // every minute

export interface RefreshNotifier {
  reauthRequired(workspaceId: string, connectorName: string): Promise<void>;
}

export interface RefreshDeps {
  db: Db;
  oauth: OAuthFlowManager;
  notifier?: RefreshNotifier;
  now?: () => Date; // injectable for tests
}

/**
 * Register the refresh worker on an existing pg-boss instance. Idempotent —
 * safe to call on every gateway boot.
 */
export async function registerRefreshJobs(
  boss: PgBoss,
  deps: RefreshDeps,
): Promise<void> {
  // ─── Tick: enqueue grant jobs for rows approaching expiry ───
  await boss.createQueue(TICK_QUEUE).catch(() => {});
  await boss.createQueue(GRANT_QUEUE).catch(() => {});

  boss.work(TICK_QUEUE, async () => {
    const eligible = await selectEligibleGrants(deps);
    if (eligible.length === 0) return;
    log.info({ count: eligible.length }, 'Enqueueing refresh jobs');
    for (const row of eligible) {
      await boss.send(
        GRANT_QUEUE,
        { grantId: row.grantId, connectorId: row.connectorId },
        // singletonKey collapses repeat enqueues of the same grant within the
        // 60s window — at most one grant job per grant in flight.
        { singletonKey: `refresh:${row.grantId}` },
      );
    }
  });

  // ─── Grant: actually refresh one grant ───
  boss.work(
    GRANT_QUEUE,
    async (jobs: PgBoss.Job<{ grantId: string; connectorId: string }>[]) => {
      for (const job of jobs) {
        const { grantId, connectorId } = job.data;
        try {
          await refreshOneGrant(grantId, connectorId, deps);
        } catch (err) {
          // Non-fatal — pg-boss will retry per its own policy.
          log.error({ err, grantId }, 'Refresh handler crashed');
        }
      }
    },
  );

  try {
    await boss.schedule(TICK_QUEUE, TICK_CRON, {}, { tz: 'UTC' });
  } catch (err) {
    log.warn({ err }, 'Failed to schedule refresh tick — continuing');
  }

  log.info({ cron: TICK_CRON }, 'Connector token refresh worker registered');
}

async function selectEligibleGrants(deps: RefreshDeps): Promise<
  Array<{ grantId: string; connectorId: string; workspaceId: string }>
> {
  const now = (deps.now?.() ?? new Date()).getTime();
  const threshold = new Date(now + PROACTIVE_WINDOW_MS);

  const { connectorGrants, connectorTokens } = await import(
    '@pilot/db/schema'
  );

  // Join grants → tokens; filter on both sides.
  const rows = await deps.db
    .select({
      grantId: connectorGrants.id,
      connectorId: connectorGrants.connectorId,
      workspaceId: connectorGrants.workspaceId,
    })
    .from(connectorGrants)
    .innerJoin(connectorTokens, eq(connectorTokens.grantId, connectorGrants.id))
    .where(
      and(
        eq(connectorGrants.isActive, true),
        eq(connectorGrants.needsReauth, false),
        lt(connectorTokens.expiresAt, threshold),
      ),
    )
    .limit(TICK_BATCH_LIMIT);

  return rows;
}

async function refreshOneGrant(
  grantId: string,
  connectorId: string,
  deps: RefreshDeps,
): Promise<void> {
  const { connectorGrants, connectors } = await import('@pilot/db/schema');

  // Serialize concurrent refreshes of the same grant via pg advisory lock.
  // `pg_try_advisory_xact_lock` returns false if another session holds it —
  // we skip this invocation rather than block the worker.
  const lockKey = `refresh:${grantId}`;
  const lockResult = (await deps.db.execute(
    sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`,
  )) as unknown as
    | { rows?: Array<{ acquired: boolean }> }
    | Array<{ acquired: boolean }>;
  const acquired = Array.isArray(lockResult)
    ? lockResult[0]?.acquired
    : lockResult.rows?.[0]?.acquired;
  if (acquired !== true) {
    log.info({ grantId }, 'Another worker holds the grant lock — skipping');
    return;
  }

  const access = await deps.oauth.refreshToken(grantId, connectorId);

  if (access) {
    // Success: clear error + reset attempts.
    await deps.db
      .update(connectorGrants)
      .set({
        refreshAttempts: 0,
        lastRefreshError: null,
        needsReauth: false,
      })
      .where(eq(connectorGrants.id, grantId));
    log.info({ grantId, connectorId }, 'Grant refreshed');
    return;
  }

  // Failure: bump attempts + classify.
  const [existing] = await deps.db
    .select({
      refreshAttempts: connectorGrants.refreshAttempts,
      workspaceId: connectorGrants.workspaceId,
    })
    .from(connectorGrants)
    .where(eq(connectorGrants.id, grantId))
    .limit(1);

  const attempts = (existing?.refreshAttempts ?? 0) + 1;
  const permanent = attempts >= PERMANENT_AFTER_ATTEMPTS;
  const errorMsg = permanent
    ? `Refresh failed after ${attempts} attempts — grant marked for re-auth`
    : `Refresh failed (attempt ${attempts}/${PERMANENT_AFTER_ATTEMPTS})`;

  await deps.db
    .update(connectorGrants)
    .set({
      refreshAttempts: attempts,
      lastRefreshError: errorMsg,
      needsReauth: permanent,
    })
    .where(eq(connectorGrants.id, grantId));

  if (permanent && existing?.workspaceId && deps.notifier) {
    // Fetch connector name for the notification copy.
    const [conn] = await deps.db
      .select({ name: connectors.name })
      .from(connectors)
      .where(eq(connectors.id, connectorId))
      .limit(1);
    if (conn?.name) {
      try {
        await deps.notifier.reauthRequired(existing.workspaceId, conn.name);
      } catch (err) {
        log.warn({ err, grantId }, 'Failed to send re-auth notification');
      }
    }
  }

  log.warn({ grantId, connectorId, attempts, permanent }, errorMsg);
}

/**
 * Fetch the list of grants that currently need re-auth for a workspace.
 * Used by the Mini App + web re-auth banners.
 */
export async function listReauthRequired(
  db: Db,
  workspaceId: string,
): Promise<
  Array<{ grantId: string; connectorName: string; lastError: string | null }>
> {
  const { connectorGrants, connectors } = await import('@pilot/db/schema');
  const rows = await db
    .select({
      grantId: connectorGrants.id,
      connectorName: connectors.name,
      lastError: connectorGrants.lastRefreshError,
    })
    .from(connectorGrants)
    .innerJoin(connectors, eq(connectors.id, connectorGrants.connectorId))
    .where(
      and(
        eq(connectorGrants.workspaceId, workspaceId),
        eq(connectorGrants.needsReauth, true),
      ),
    );
  return rows;
}

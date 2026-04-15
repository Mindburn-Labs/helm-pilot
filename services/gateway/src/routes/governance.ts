import { Hono } from 'hono';
import { and, desc, eq, lt } from 'drizzle-orm';
import { evidencePacks, helmHealthSnapshots } from '@helm-pilot/db/schema';
import { HelmClient } from '@helm-pilot/helm-client';
import { type GatewayDeps } from '../index.js';

/**
 * Governance admin surface.
 *
 * Exposes the founder-facing receipt trail backed by HELM. Every row returned
 * here corresponds to a real Guardian decision; rows are materialized by the
 * orchestrator's HelmClient.onReceipt callback (see services/orchestrator).
 *
 * All endpoints require authenticated access — the gateway's `requireAuth`
 * middleware applies to the whole /api/* surface.
 */
export function governanceRoutes(deps: GatewayDeps) {
  const app = new Hono();
  const helm = deps.helmClient;

  // GET /api/governance/status
  // Reports current HELM sidecar health and the most recent snapshots. Safe
  // for dashboards to poll every few seconds (no HELM traffic on the poll
  // itself — we only read the cached snapshot table).
  app.get('/status', async (c) => {
    // Latest recorded snapshot
    const [latest] = await deps.db
      .select()
      .from(helmHealthSnapshots)
      .orderBy(desc(helmHealthSnapshots.checkedAt))
      .limit(1);

    // Live probe (short timeout) — optional, only when client is configured
    let live: { ok: boolean; latencyMs: number; version?: string; error?: string } | null = null;
    if (helm) {
      const snap = await helm.health();
      live = {
        ok: snap.gatewayOk,
        latencyMs: snap.latencyMs,
        version: snap.version,
        error: snap.error,
      };
    }

    return c.json({
      helmConfigured: Boolean(helm),
      live,
      latestSnapshot: latest ?? null,
    });
  });

  // GET /api/governance/receipts
  // Paginated list of local evidence packs for the authenticated workspace.
  // Supports cursor pagination via `?before=<isoDate>&limit=<n>`.
  app.get('/receipts', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const before = c.req.query('before');
    const limit = Math.min(Number(c.req.query('limit') ?? '25'), 100);

    const beforeDate = before ? new Date(before) : null;
    const predicate = beforeDate
      ? and(eq(evidencePacks.workspaceId, workspaceId), lt(evidencePacks.receivedAt, beforeDate))
      : eq(evidencePacks.workspaceId, workspaceId);

    const rows = await deps.db
      .select()
      .from(evidencePacks)
      .where(predicate)
      .orderBy(desc(evidencePacks.receivedAt))
      .limit(limit);

    const nextCursor =
      rows.length === limit ? rows[rows.length - 1]!.receivedAt.toISOString() : null;

    return c.json({
      receipts: rows.map(toReceiptDto),
      nextCursor,
    });
  });

  // GET /api/governance/receipts/:decisionId
  // Single receipt — signed blob included so clients can verify offline.
  app.get('/receipts/:decisionId', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const decisionId = c.req.param('decisionId');
    const [row] = await deps.db
      .select()
      .from(evidencePacks)
      .where(and(eq(evidencePacks.workspaceId, workspaceId), eq(evidencePacks.decisionId, decisionId)))
      .limit(1);

    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ receipt: toReceiptDto(row), signedBlob: row.signedBlob });
  });

  return app;
}

type EvidenceRow = typeof evidencePacks.$inferSelect;

function toReceiptDto(row: EvidenceRow) {
  return {
    id: row.id,
    decisionId: row.decisionId,
    taskRunId: row.taskRunId,
    verdict: row.verdict,
    reasonCode: row.reasonCode,
    policyVersion: row.policyVersion,
    decisionHash: row.decisionHash,
    action: row.action,
    resource: row.resource,
    principal: row.principal,
    receivedAt: row.receivedAt,
    verifiedAt: row.verifiedAt,
  };
}

export type GovernanceDeps = { helmClient?: HelmClient };

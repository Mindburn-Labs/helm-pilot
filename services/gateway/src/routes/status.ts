import { Hono } from 'hono';
import { and, count, eq } from 'drizzle-orm';
import {
  approvals,
  connectorGrants,
  connectorSessions,
  crawlRuns,
  ingestionRecords,
  operators,
  tasks,
  workspaces,
} from '@helm-pilot/db/schema';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

export function statusRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const [workspace] = await deps.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) return c.json({ error: 'Workspace not found' }, 404);

    const taskCounts = await Promise.all([
      deps.db.select({ count: count() }).from(tasks).where(eq(tasks.workspaceId, workspaceId)),
      deps.db.select({ count: count() }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'running'))),
      deps.db.select({ count: count() }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'queued'))),
      deps.db.select({ count: count() }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'completed'))),
      deps.db.select({ count: count() }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'failed'))),
      deps.db.select({ count: count() }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'awaiting_approval'))),
      deps.db.select({ count: count() }).from(operators).where(eq(operators.workspaceId, workspaceId)),
      deps.db.select({ count: count() }).from(approvals).where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.status, 'pending'))),
      deps.db.select({ count: count() }).from(connectorGrants).where(eq(connectorGrants.workspaceId, workspaceId)),
      deps.db.select({ count: count() }).from(crawlRuns).where(eq(crawlRuns.workspaceId, workspaceId)),
      deps.db.select({ count: count() }).from(crawlRuns).where(and(eq(crawlRuns.workspaceId, workspaceId), eq(crawlRuns.status, 'running'))),
      deps.db.select({ count: count() }).from(ingestionRecords).where(eq(ingestionRecords.status, 'parsed')),
      deps.db.select({ count: count() }).from(connectorSessions),
    ]);

    const asNumber = (value: unknown) => Number(value ?? 0);

    return c.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        currentMode: workspace.currentMode,
      },
      tasks: {
        total: asNumber(taskCounts[0][0]?.count),
        running: asNumber(taskCounts[1][0]?.count),
        queued: asNumber(taskCounts[2][0]?.count),
        completed: asNumber(taskCounts[3][0]?.count),
        failed: asNumber(taskCounts[4][0]?.count),
        awaitingApproval: asNumber(taskCounts[5][0]?.count),
      },
      operators: asNumber(taskCounts[6][0]?.count),
      pendingApprovals: asNumber(taskCounts[7][0]?.count),
      connectors: asNumber(taskCounts[8][0]?.count),
      crawl: {
        totalRuns: asNumber(taskCounts[9][0]?.count),
        running: asNumber(taskCounts[10][0]?.count),
        parsedIngestions: asNumber(taskCounts[11][0]?.count),
        activeSessions: asNumber(taskCounts[12][0]?.count),
      },
    });
  });

  return app;
}

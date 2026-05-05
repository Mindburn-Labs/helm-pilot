import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import {
  opportunities,
  opportunityClusters,
  opportunityClusterMembers,
  opportunityScores,
  opportunityTags,
} from '@pilot/db/schema';
import { CreateOpportunityInput } from '@pilot/shared/schemas';
import { getCapabilityRecord } from '@pilot/shared/capabilities';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, workspaceIdMismatch } from '../lib/workspace.js';

export function opportunityRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const limit = Number(c.req.query('limit') ?? '50');
    const rows = await deps.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.workspaceId, workspaceId))
      .orderBy(desc(opportunities.discoveredAt))
      .limit(Math.min(limit, 100));

    return c.json(rows);
  });

  app.get('/:id', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const { id } = c.req.param();

    const [opp] = await deps.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), eq(opportunities.workspaceId, workspaceId)))
      .limit(1);

    if (!opp) {
      return c.json({ error: 'Not found' }, 404);
    }

    const scores = await deps.db
      .select()
      .from(opportunityScores)
      .where(eq(opportunityScores.opportunityId, id));

    const tags = await deps.db
      .select()
      .from(opportunityTags)
      .where(eq(opportunityTags.opportunityId, id));

    return c.json({ ...opp, scores, tags });
  });

  app.post('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const raw = await c.req.json();
    if (workspaceIdMismatch(c, raw.workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }
    const parsed = CreateOpportunityInput.safeParse({
      ...raw,
      workspaceId,
    });

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const body = parsed.data;
    const [opp] = await deps.db
      .insert(opportunities)
      .values({
        source: body.source,
        sourceUrl: body.sourceUrl,
        title: body.title,
        description: body.description,
        workspaceId: body.workspaceId,
        status: 'discovered',
      })
      .returning();

    return c.json(opp, 201);
  });

  // ─── Batch score — enqueue scoring for all unscored opportunities ───
  app.post('/batch-score', async (c) => {
    const capability = getCapabilityRecord('opportunity_scoring');
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.orchestrator.boss) {
      return c.json({ error: 'Background job system unavailable', capability }, 503);
    }

    const unscored = await deps.db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.status, 'discovered')),
      );

    let enqueued = 0;
    for (const { id } of unscored) {
      await deps.orchestrator.boss.send('opportunity.score', { opportunityId: id });
      enqueued++;
    }

    return c.json({ enqueued, total: unscored.length, capability }, 202);
  });

  // ─── Trigger cluster rebuild for the workspace ───
  app.post('/cluster', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.orchestrator.boss) return c.json({ error: 'Background job system unavailable' }, 503);

    const jobId = await deps.orchestrator.boss.send('pipeline.cluster', { workspaceId });
    return c.json({ queued: true, jobId }, 202);
  });

  // ─── List clusters for the workspace ───
  app.get('/clusters', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const clusters = await deps.db
      .select()
      .from(opportunityClusters)
      .where(eq(opportunityClusters.workspaceId, workspaceId))
      .orderBy(desc(opportunityClusters.avgScore));

    return c.json(clusters);
  });

  // ─── List cluster members with their opportunities ───
  app.get('/clusters/:clusterId/members', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const { clusterId } = c.req.param();
    const [cluster] = await deps.db
      .select()
      .from(opportunityClusters)
      .where(
        and(
          eq(opportunityClusters.id, clusterId),
          eq(opportunityClusters.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

    const members = await deps.db
      .select()
      .from(opportunityClusterMembers)
      .where(eq(opportunityClusterMembers.clusterId, clusterId));

    // Hydrate with opportunity data
    const oppIds = members.map((m) => m.opportunityId);
    const opps =
      oppIds.length > 0
        ? await deps.db
            .select()
            .from(opportunities)
            .where(eq(opportunities.workspaceId, workspaceId))
        : [];

    const oppMap = new Map(opps.map((o) => [o.id, o]));

    const hydrated = members.map((m) => ({
      ...m,
      opportunity: oppMap.get(m.opportunityId) ?? null,
    }));

    return c.json({ cluster, members: hydrated });
  });

  app.post('/:id/score', async (c) => {
    const capability = getCapabilityRecord('opportunity_scoring');
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const { id } = c.req.param();
    const [opp] = await deps.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, id))
      .limit(1);

    if (!opp || opp.workspaceId !== workspaceId) {
      return c.json({ error: 'Opportunity not found' }, 404);
    }

    await deps.db
      .update(opportunities)
      .set({ status: 'scoring' })
      .where(and(eq(opportunities.id, id), eq(opportunities.workspaceId, workspaceId)));

    if (!deps.orchestrator.boss) {
      return c.json({ error: 'Background job system unavailable', capability }, 503);
    }

    await deps.orchestrator.boss.send('opportunity.score', { opportunityId: id });
    return c.json({ queued: true, opportunityId: id, status: 'scoring', capability }, 202);
  });

  return app;
}

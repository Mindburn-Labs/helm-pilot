import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { opportunities, opportunityScores, opportunityTags } from '@helm-pilot/db/schema';
import { CreateOpportunityInput } from '@helm-pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

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
    const { id } = c.req.param();

    const [opp] = await deps.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, id))
      .limit(1);

    if (!opp || (workspaceId && opp.workspaceId !== workspaceId)) {
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
    const raw = await c.req.json();
    const parsed = CreateOpportunityInput.safeParse({
      ...raw,
      workspaceId: raw.workspaceId ?? workspaceId,
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

  app.post('/:id/score', async (c) => {
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
      .where(eq(opportunities.id, id));

    if (!deps.orchestrator.boss) {
      return c.json({ error: 'Background job system unavailable' }, 503);
    }

    await deps.orchestrator.boss.send('opportunity.score', { opportunityId: id });
    return c.json({ queued: true, opportunityId: id, status: 'scoring' }, 202);
  });

  return app;
}

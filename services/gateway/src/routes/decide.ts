import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { opportunities } from '@pilot/db/schema';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

/**
 * Decision Court routes (Phase 4).
 *
 * POST /api/decide/court  — run an adversarial decision court on selected opportunities
 */
export function decideRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.post('/court', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const body = (await c.req.json().catch(() => ({}))) as {
      opportunityIds?: string[];
      founderContext?: string;
    };

    if (!Array.isArray(body.opportunityIds) || body.opportunityIds.length < 1) {
      return c.json({ error: 'opportunityIds must contain at least one id' }, 400);
    }

    // Fetch opportunity data for the shortlist (workspace-scoped)
    const shortlist = [];
    for (const oppId of body.opportunityIds) {
      const [opp] = await deps.db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.id, oppId), eq(opportunities.workspaceId, workspaceId)))
        .limit(1);
      if (opp) {
        shortlist.push({ id: opp.id, title: opp.title, description: opp.description });
      }
    }

    if (shortlist.length === 0) {
      return c.json({ error: 'No valid opportunities found in this workspace' }, 404);
    }

    const { DecisionCourt } = await import('@pilot/decision-court');
    const court = new DecisionCourt();

    try {
      const result = await court.runCourt({
        shortlist,
        systemContext: body.founderContext,
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Decision court failed';
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

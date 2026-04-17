import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { tasks } from '@helm-pilot/db/schema';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

/**
 * Conductor route (Phase 12).
 *
 * POST /api/orchestrator/conduct
 *   Run an agent loop with subagent.spawn / subagent.parallel enabled.
 *   Body: { taskId, context, iterationBudget?, operatorId? }
 *
 * GET  /api/orchestrator/subagents
 *   List available subagent definitions loaded from packs/subagents/*.md.
 */
export function conductRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/subagents', async (c) => {
    if (!deps.orchestrator.conductor) {
      return c.json({ subagents: [], error: 'no_registry_configured' }, 200);
    }
    const list = deps.orchestrator.conductor.list().map((def) => ({
      name: def.name,
      description: def.description,
      version: def.version,
      operatorRole: def.operatorRole,
      maxRiskClass: def.maxRiskClass,
      execution: def.execution,
      allowedTools: def.toolScope.allowedTools,
      iterationBudget: def.iterationBudget,
    }));
    return c.json({ subagents: list });
  });

  app.post('/conduct', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const body = (await c.req.json().catch(() => ({}))) as {
      taskId?: string;
      operatorId?: string;
      context?: string;
      iterationBudget?: number;
    };

    if (!body.taskId || typeof body.taskId !== 'string') {
      return c.json({ error: 'taskId is required' }, 400);
    }
    if (!body.context || typeof body.context !== 'string') {
      return c.json({ error: 'context is required' }, 400);
    }

    // Verify the task belongs to this workspace (tenancy gate).
    const [task] = await deps.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, body.taskId), eq(tasks.workspaceId, workspaceId)))
      .limit(1);
    if (!task) {
      return c.json({ error: 'Task not found in this workspace' }, 404);
    }

    try {
      const result = await deps.orchestrator.runConduct({
        taskId: body.taskId,
        workspaceId,
        operatorId: body.operatorId,
        context: body.context,
        iterationBudget: body.iterationBudget,
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Conduct run failed';
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

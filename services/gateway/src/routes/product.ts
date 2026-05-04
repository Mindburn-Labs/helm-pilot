import { Hono } from 'hono';
import { ProductFactory } from '@pilot/product-factory';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

export function productRoutes(deps: GatewayDeps) {
  const factory = new ProductFactory(deps.db);
  const app = new Hono();

  // GET /api/product/plans?workspaceId=...
  app.get('/plans', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const plans = await factory.listPlans(workspaceId);
    return c.json(plans);
  });

  // GET /api/product/plans/:id
  app.get('/plans/:id', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const plan = await factory.getPlan(c.req.param('id'), workspaceId);
    if (!plan) return c.json({ error: 'Not found' }, 404);
    return c.json(plan);
  });

  // POST /api/product/plans
  app.post('/plans', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const body = await c.req.json();
    const plan = await factory.createPlan(workspaceId, body.title, body.description);
    return c.json(plan, 201);
  });

  // POST /api/product/plans/:id/milestones
  app.post('/plans/:id/milestones', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const plan = await factory.getPlan(c.req.param('id'), workspaceId);
    if (!plan) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json();
    const ms = await factory.addMilestone(
      c.req.param('id'),
      body.title,
      body.description,
      workspaceId,
    );
    if (!ms) return c.json({ error: 'Not found' }, 404);
    return c.json(ms, 201);
  });

  // GET /api/product/summary?workspaceId=...
  app.get('/summary', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const summary = await factory.getWorkspaceSummary(workspaceId);
    return c.json(summary);
  });

  return app;
}

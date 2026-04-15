import { Hono } from 'hono';
import { LaunchEngine } from '@helm-pilot/launch-engine';
import { type GatewayDeps } from '../index.js';

export function launchRoutes(deps: GatewayDeps) {
  const engine = new LaunchEngine(deps.db);
  const app = new Hono();

  // GET /api/launch/artifacts?workspaceId=...
  app.get('/artifacts', async (c) => {
    const workspaceId = c.get('workspaceId') ?? c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const list = await engine.listArtifacts(workspaceId);
    return c.json(list);
  });

  // GET /api/launch/artifacts/:id
  app.get('/artifacts/:id', async (c) => {
    const artifact = await engine.getArtifact(c.req.param('id'));
    if (!artifact) return c.json({ error: 'Not found' }, 404);
    return c.json(artifact);
  });

  // GET /api/launch/deployments?workspaceId=...
  app.get('/deployments', async (c) => {
    const workspaceId = c.get('workspaceId') ?? c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const list = await engine.listDeployments(workspaceId);
    return c.json(list);
  });

  // GET /api/launch/targets?workspaceId=...
  app.get('/targets', async (c) => {
    const workspaceId = c.get('workspaceId') ?? c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const targets = await engine.listDeployTargets(workspaceId);
    return c.json(targets);
  });

  // POST /api/launch/targets — Create a deploy target
  app.post('/targets', async (c) => {
    const body = await c.req.json();
    const { workspaceId, name, provider, config } = body as {
      workspaceId: string;
      name: string;
      provider: string;
      config?: Record<string, unknown>;
    };
    if (!workspaceId || !name || !provider) {
      return c.json({ error: 'workspaceId, name, and provider required' }, 400);
    }
    const target = await engine.createDeployTarget(workspaceId, { name, provider, config });
    return c.json(target, 201);
  });

  // POST /api/launch/deployments — Record a new deployment
  app.post('/deployments', async (c) => {
    const body = await c.req.json();
    const { workspaceId, targetId, artifactId, version } = body as {
      workspaceId: string;
      targetId: string;
      artifactId?: string;
      version?: string;
    };
    if (!workspaceId || !targetId) {
      return c.json({ error: 'workspaceId and targetId required' }, 400);
    }
    const deployment = await engine.recordDeployment(workspaceId, { targetId, artifactId, version });
    return c.json(deployment, 201);
  });

  // PUT /api/launch/deployments/:id/status — Update deployment status
  app.put('/deployments/:id/status', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json();
    const { status, url } = body as { status: string; url?: string };
    const updated = await engine.updateDeploymentStatus(id, status, url);
    if (!updated) return c.json({ error: 'Deployment not found' }, 404);
    return c.json(updated);
  });

  // POST /api/launch/deployments/:id/health — Record a health check
  app.post('/deployments/:id/health', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json();
    const { status, responseTimeMs, details } = body as {
      status: string;
      responseTimeMs?: string;
      details?: Record<string, unknown>;
    };
    const check = await engine.recordHealthCheck(id, { status, responseTimeMs, details });
    return c.json(check, 201);
  });

  return app;
}

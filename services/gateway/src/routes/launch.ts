import { Hono } from 'hono';
import { DigitalOceanProvider, LaunchEngine, type DeployProvider } from '@helm-pilot/launch-engine';
import {
  HelmDeniedError,
  HelmEscalationError,
  HelmUnreachableError,
} from '@helm-pilot/helm-client';
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
    const { name, provider, config } = body as {
      workspaceId?: string;
      name: string;
      provider: string;
      config?: Record<string, unknown>;
    };
    const workspaceId = c.get('workspaceId') ?? (body as { workspaceId?: string }).workspaceId;
    if (!workspaceId || !name || !provider) {
      return c.json({ error: 'workspaceId, name, and provider required' }, 400);
    }
    const target = await engine.createDeployTarget(workspaceId, { name, provider, config });
    return c.json(target, 201);
  });

  // POST /api/launch/deployments — Execute a provider deployment
  app.post('/deployments', async (c) => {
    const body = await c.req.json();
    const { targetId, artifactId, version, image, appName, region, envVars } = body as {
      workspaceId?: string;
      targetId: string;
      artifactId?: string;
      version?: string;
      image?: string;
      appName?: string;
      region?: string;
      envVars?: Record<string, string>;
    };
    const workspaceId = c.get('workspaceId') ?? (body as { workspaceId?: string }).workspaceId;
    if (!workspaceId || !targetId) {
      return c.json({ error: 'workspaceId and targetId required' }, 400);
    }
    const target = await engine.getDeployTarget(targetId);
    if (!target || target.workspaceId !== workspaceId) {
      return c.json({ error: 'Deploy target not found' }, 404);
    }
    const provider = providerFor(target.provider);
    if (!provider) {
      return c.json({ error: `Unsupported deploy provider: ${target.provider}` }, 400);
    }

    const governed = await evaluateLaunchAction(deps, {
      workspaceId,
      action: 'DEPLOY',
      resource: `${target.provider}:${targetId}`,
      context: { targetId, artifactId, version, image, appName, region },
    });
    if (governed instanceof Response) return governed;

    try {
      const result = await engine.deployToTarget(
        workspaceId,
        { targetId, artifactId, version, image, appName, region, envVars },
        provider,
      );
      return c.json({ ...result, helmReceipt: governed?.receipt }, 201);
    } catch (err) {
      return c.json(
        {
          error: err instanceof Error ? err.message : 'Deployment failed',
          helmReceipt: governed?.receipt,
        },
        502,
      );
    }
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

  // POST /api/launch/deployments/:id/health — Run a provider health check
  app.post('/deployments/:id/health', async (c) => {
    const { id } = c.req.param();
    const deployment = await engine.getDeployment(id);
    if (!deployment) return c.json({ error: 'Deployment not found' }, 404);
    const workspaceId = c.get('workspaceId');
    if (workspaceId && deployment.workspaceId !== workspaceId) {
      return c.json({ error: 'Deployment not found' }, 404);
    }
    const target = await engine.getDeployTarget(deployment.targetId);
    if (!target) return c.json({ error: 'Deploy target not found' }, 404);
    const provider = providerFor(target.provider);
    if (!provider) return c.json({ error: `Unsupported deploy provider: ${target.provider}` }, 400);

    const governed = await evaluateLaunchAction(deps, {
      workspaceId: deployment.workspaceId,
      action: 'DEPLOY_HEALTH_CHECK',
      resource: `${target.provider}:${target.id}`,
      context: { deploymentId: id },
    });
    if (governed instanceof Response) return governed;

    try {
      const result = await engine.runDeploymentHealthCheck(id, provider);
      return c.json({ ...result, helmReceipt: governed?.receipt }, 201);
    } catch (err) {
      return c.json(
        {
          error: err instanceof Error ? err.message : 'Health check failed',
          helmReceipt: governed?.receipt,
        },
        502,
      );
    }
  });

  // POST /api/launch/deployments/:id/rollback — Roll back a provider deployment
  app.post('/deployments/:id/rollback', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json();
    const { targetVersion } = body as { targetVersion?: string };
    if (!targetVersion) return c.json({ error: 'targetVersion required' }, 400);

    const deployment = await engine.getDeployment(id);
    if (!deployment) return c.json({ error: 'Deployment not found' }, 404);
    const workspaceId = c.get('workspaceId');
    if (workspaceId && deployment.workspaceId !== workspaceId) {
      return c.json({ error: 'Deployment not found' }, 404);
    }
    const target = await engine.getDeployTarget(deployment.targetId);
    if (!target) return c.json({ error: 'Deploy target not found' }, 404);
    const provider = providerFor(target.provider);
    if (!provider) return c.json({ error: `Unsupported deploy provider: ${target.provider}` }, 400);

    const governed = await evaluateLaunchAction(deps, {
      workspaceId: deployment.workspaceId,
      action: 'DEPLOY_ROLLBACK',
      resource: `${target.provider}:${target.id}`,
      context: { deploymentId: id, targetVersion },
    });
    if (governed instanceof Response) return governed;

    try {
      const result = await engine.rollbackDeployment(id, targetVersion, provider);
      return c.json({ ...result, helmReceipt: governed?.receipt });
    } catch (err) {
      return c.json(
        {
          error: err instanceof Error ? err.message : 'Rollback failed',
          helmReceipt: governed?.receipt,
        },
        502,
      );
    }
  });

  return app;
}

function providerFor(name: string): DeployProvider | null {
  if (name === 'digitalocean') return new DigitalOceanProvider();
  return null;
}

async function evaluateLaunchAction(
  deps: GatewayDeps,
  input: {
    workspaceId: string;
    action: string;
    resource: string;
    context: Record<string, unknown>;
  },
) {
  if (!deps.helmClient) {
    if (process.env['NODE_ENV'] === 'production' && process.env['HELM_FAIL_CLOSED'] !== '0') {
      return Response.json(
        { error: 'HELM governance client is required for production launch actions' },
        { status: 503 },
      );
    }
    return null;
  }

  try {
    return await deps.helmClient.evaluate({
      principal: `workspace:${input.workspaceId}/operator:launch`,
      action: input.action,
      resource: input.resource,
      context: { ...input.context, workspaceId: input.workspaceId },
    });
  } catch (err) {
    if (err instanceof HelmDeniedError) {
      return Response.json({ error: err.reason, receipt: err.receipt }, { status: 403 });
    }
    if (err instanceof HelmEscalationError) {
      return Response.json({ error: err.reason, receipt: err.receipt }, { status: 409 });
    }
    if (err instanceof HelmUnreachableError) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchRoutes } from '../../routes/launch.js';
import { createMockDeps, testApp, expectJson } from '../helpers.js';

const mockEngine = {
  listArtifacts: vi.fn(async () => []),
  getArtifact: vi.fn(async () => null),
  listDeployments: vi.fn(async () => []),
  listDeployTargets: vi.fn(async () => []),
  getDeployTarget: vi.fn(async () => ({
    id: 'target-1',
    workspaceId: 'ws-1',
    name: 'prod',
    provider: 'digitalocean',
    config: { image: 'registry.example.com/app:v1' },
  })),
  createDeployTarget: vi.fn(async () => ({
    id: 'target-1',
    name: 'prod',
    provider: 'digitalocean',
  })),
  recordDeployment: vi.fn(async () => ({
    id: 'deploy-1',
    targetId: 'target-1',
    status: 'pending',
  })),
  deployToTarget: vi.fn(async () => ({
    deployment: {
      id: 'deploy-1',
      workspaceId: 'ws-1',
      targetId: 'target-1',
      status: 'live',
      url: 'https://app.ondigitalocean.app',
    },
    providerDeployment: {
      deploymentId: 'do-deploy-1',
      status: 'live',
      url: 'https://app.ondigitalocean.app',
    },
  })),
  getDeployment: vi.fn(async () => ({
    id: 'dep-1',
    workspaceId: 'ws-1',
    targetId: 'target-1',
    metadata: { providerId: 'do-app-1', providerDeploymentId: 'do-deploy-1' },
  })),
  updateDeploymentStatus: vi.fn(async () => null),
  recordHealthCheck: vi.fn(async () => ({ id: 'hc-1', status: 'healthy' })),
  runDeploymentHealthCheck: vi.fn(async () => ({
    check: { id: 'hc-1', status: 'healthy' },
    result: { healthy: true, status: 200, responseTimeMs: 42 },
  })),
  rollbackDeployment: vi.fn(async () => ({
    deployment: { id: 'dep-1', status: 'rolled_back' },
    result: { status: 'rolled_back' },
  })),
};

vi.mock('@pilot/launch-engine', () => ({
  LaunchEngine: vi.fn().mockImplementation(() => mockEngine),
  DigitalOceanProvider: vi.fn().mockImplementation(() => ({ name: 'digitalocean' })),
}));

beforeEach(() => {
  Object.values(mockEngine).forEach((fn) => fn.mockClear());
});

function mockHelmClient() {
  return {
    evaluate: vi.fn(async (req: Record<string, unknown>) => ({
      receipt: {
        decisionId: `dec-${String(req['action']).toLowerCase()}`,
        verdict: 'ALLOW',
        policyVersion: 'founder-ops-v1',
        receivedAt: new Date(),
        action: req['action'],
        resource: req['resource'],
        principal: req['principal'],
      },
    })),
  };
}

describe('launchRoutes', () => {
  const wsHeader = { 'X-Workspace-Id': 'ws-1' };

  // ─── GET /artifacts ───

  describe('GET /artifacts', () => {
    it('returns 400 without workspaceId', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/artifacts');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns list of artifacts', async () => {
      const artifacts = [{ id: 'art-1', name: 'bundle.zip' }];
      mockEngine.listArtifacts.mockResolvedValueOnce(artifacts);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/artifacts', undefined, wsHeader);
      const json = await expectJson(res, 200);

      expect(mockEngine.listArtifacts).toHaveBeenCalledWith('ws-1');
      expect(json).toEqual(artifacts);
    });
  });

  // ─── GET /artifacts/:id ───

  describe('GET /artifacts/:id', () => {
    it('returns 404 when artifact not found', async () => {
      mockEngine.getArtifact.mockResolvedValueOnce(null);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/artifacts/art-999', undefined, wsHeader);
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Not found');
    });

    it('returns 200 when artifact found', async () => {
      const artifact = { id: 'art-1', workspaceId: 'ws-1', name: 'bundle.zip', size: 1024 };
      mockEngine.getArtifact.mockResolvedValueOnce(artifact);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/artifacts/art-1', undefined, wsHeader);
      const json = await expectJson(res, 200);
      expect(json).toEqual(artifact);
    });
  });

  // ─── GET /deployments ───

  describe('GET /deployments', () => {
    it('returns 400 without workspaceId', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/deployments');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns list of deployments', async () => {
      const deployments = [{ id: 'dep-1', status: 'running' }];
      mockEngine.listDeployments.mockResolvedValueOnce(deployments);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/deployments', undefined, wsHeader);
      const json = await expectJson(res, 200);

      expect(mockEngine.listDeployments).toHaveBeenCalledWith('ws-1');
      expect(json).toEqual(deployments);
    });
  });

  // ─── GET /targets ───

  describe('GET /targets', () => {
    it('returns 400 without workspaceId', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/targets');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns list of targets', async () => {
      const targets = [{ id: 'target-1', name: 'prod', provider: 'digitalocean' }];
      mockEngine.listDeployTargets.mockResolvedValueOnce(targets);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/targets', undefined, wsHeader);
      const json = await expectJson(res, 200);

      expect(mockEngine.listDeployTargets).toHaveBeenCalledWith('ws-1');
      expect(json).toEqual(targets);
    });
  });

  // ─── POST /targets ───

  describe('POST /targets', () => {
    it('returns 400 when required fields are missing', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/targets', { workspaceId: 'ws-1' }, wsHeader);
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId, name, and provider required');
    });

    it('returns 403 when body workspaceId mismatches the bound workspace', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch(
        'POST',
        '/targets',
        {
          workspaceId: 'ws-2',
          name: 'prod',
          provider: 'digitalocean',
        },
        wsHeader,
      );
      const json = await expectJson(res, 403);
      expect(json).toHaveProperty('error', 'workspaceId does not match authenticated workspace');
    });

    it('returns 201 on success', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch(
        'POST',
        '/targets',
        {
          workspaceId: 'ws-1',
          name: 'prod',
          provider: 'digitalocean',
        },
        wsHeader,
      );
      const json = await expectJson(res, 201);

      expect(mockEngine.createDeployTarget).toHaveBeenCalledWith('ws-1', {
        name: 'prod',
        provider: 'digitalocean',
        config: undefined,
      });
      expect(json).toEqual({ id: 'target-1', name: 'prod', provider: 'digitalocean' });
    });

    it('denies non-owner deploy target creation', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch(
        'POST',
        '/targets',
        {
          workspaceId: 'ws-1',
          name: 'prod',
          provider: 'digitalocean',
        },
        { ...wsHeader, 'X-Workspace-Role': 'partner' },
      );
      const json = await expectJson<{ error: string; requiredRole: string }>(res, 403);

      expect(json.error).toBe('insufficient workspace role');
      expect(json.requiredRole).toBe('owner');
      expect(mockEngine.createDeployTarget).not.toHaveBeenCalled();
    });
  });

  // ─── POST /deployments ───

  describe('POST /deployments', () => {
    it('returns 400 when required fields are missing', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/deployments', { workspaceId: 'ws-1' }, wsHeader);
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId and targetId required');
    });

    it('blocks elevated deployment execution when HELM is unavailable', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch(
        'POST',
        '/deployments',
        {
          workspaceId: 'ws-1',
          targetId: 'target-1',
          image: 'registry.example.com/app:v1',
        },
        wsHeader,
      );
      const json = await expectJson<{ error: string }>(res, 503);

      expect(json.error).toBe('HELM governance client is required for elevated launch actions');
      expect(mockEngine.deployToTarget).not.toHaveBeenCalled();
    });

    it('returns 201 on success after HELM approval', async () => {
      const helmClient = mockHelmClient();
      const deps = createMockDeps({ helmClient: helmClient as never });
      const { fetch } = testApp(launchRoutes, deps);
      const res = await fetch(
        'POST',
        '/deployments',
        {
          workspaceId: 'ws-1',
          targetId: 'target-1',
          image: 'registry.example.com/app:v1',
        },
        wsHeader,
      );
      const json = await expectJson(res, 201);

      expect(helmClient.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPLOY',
          resource: 'digitalocean:target-1',
          effectLevel: 'E3',
        }),
      );
      expect(mockEngine.deployToTarget).toHaveBeenCalledWith(
        'ws-1',
        {
          targetId: 'target-1',
          artifactId: undefined,
          version: undefined,
          image: 'registry.example.com/app:v1',
          appName: undefined,
          region: undefined,
          envVars: undefined,
        },
        expect.objectContaining({ name: 'digitalocean' }),
        expect.objectContaining({
          surface: 'launch',
          action: 'DEPLOY',
          policyDecisionId: 'dec-deploy',
          policyVersion: 'founder-ops-v1',
          policyPin: expect.objectContaining({
            documentVersionPins: { deploymentPolicy: 'founder-ops-v1' },
          }),
        }),
      );
      expect(json.deployment.status).toBe('live');
    });
  });

  // ─── PUT /deployments/:id/status ───

  describe('PUT /deployments/:id/status', () => {
    it('returns 404 when deployment not found', async () => {
      mockEngine.updateDeploymentStatus.mockResolvedValueOnce(null);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch(
        'PUT',
        '/deployments/dep-999/status',
        { status: 'running' },
        wsHeader,
      );
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Deployment not found');
    });

    it('returns 200 when updated', async () => {
      const updated = { id: 'dep-1', status: 'running', url: 'https://app.ondigitalocean.app' };
      mockEngine.updateDeploymentStatus.mockResolvedValueOnce(updated);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch(
        'PUT',
        '/deployments/dep-1/status',
        {
          status: 'running',
          url: 'https://app.ondigitalocean.app',
        },
        wsHeader,
      );
      const json = await expectJson(res, 200);

      expect(mockEngine.updateDeploymentStatus).toHaveBeenCalledWith(
        'dep-1',
        'running',
        'https://app.ondigitalocean.app',
        undefined,
        'ws-1',
      );
      expect(json).toEqual(updated);
    });
  });

  // ─── POST /deployments/:id/health ───

  describe('POST /deployments/:id/health', () => {
    it('blocks elevated health checks when HELM is unavailable', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/deployments/dep-1/health', undefined, wsHeader);
      const json = await expectJson<{ error: string }>(res, 503);

      expect(json.error).toBe('HELM governance client is required for elevated launch actions');
      expect(mockEngine.runDeploymentHealthCheck).not.toHaveBeenCalled();
    });

    it('returns 201 on success', async () => {
      const helmClient = mockHelmClient();
      const deps = createMockDeps({ helmClient: helmClient as never });
      const { fetch } = testApp(launchRoutes, deps);
      const res = await fetch('POST', '/deployments/dep-1/health', undefined, wsHeader);
      const json = await expectJson(res, 201);

      expect(helmClient.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPLOY_HEALTH_CHECK',
          resource: 'digitalocean:target-1',
          effectLevel: 'E2',
        }),
      );
      expect(mockEngine.runDeploymentHealthCheck).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ name: 'digitalocean' }),
        'ws-1',
        expect.objectContaining({
          surface: 'launch',
          action: 'DEPLOY_HEALTH_CHECK',
          policyDecisionId: 'dec-deploy_health_check',
          policyVersion: 'founder-ops-v1',
        }),
      );
      expect(json.check).toEqual({ id: 'hc-1', status: 'healthy' });
    });
  });

  // ─── POST /deployments/:id/rollback ───

  describe('POST /deployments/:id/rollback', () => {
    it('blocks elevated rollback when HELM is unavailable', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch(
        'POST',
        '/deployments/dep-1/rollback',
        { targetVersion: 'v1' },
        wsHeader,
      );
      const json = await expectJson<{ error: string }>(res, 503);

      expect(json.error).toBe('HELM governance client is required for elevated launch actions');
      expect(mockEngine.rollbackDeployment).not.toHaveBeenCalled();
    });

    it('runs rollback only after HELM approval', async () => {
      const helmClient = mockHelmClient();
      const deps = createMockDeps({ helmClient: helmClient as never });
      const { fetch } = testApp(launchRoutes, deps);
      const res = await fetch(
        'POST',
        '/deployments/dep-1/rollback',
        { targetVersion: 'v1' },
        wsHeader,
      );
      const json = await expectJson(res, 200);

      expect(helmClient.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPLOY_ROLLBACK',
          resource: 'digitalocean:target-1',
          effectLevel: 'E3',
        }),
      );
      expect(mockEngine.rollbackDeployment).toHaveBeenCalledWith(
        'dep-1',
        'v1',
        expect.objectContaining({ name: 'digitalocean' }),
        'ws-1',
        expect.objectContaining({
          surface: 'launch',
          action: 'DEPLOY_ROLLBACK',
          policyDecisionId: 'dec-deploy_rollback',
          policyVersion: 'founder-ops-v1',
        }),
      );
      expect(json.deployment).toEqual({ id: 'dep-1', status: 'rolled_back' });
    });
  });
});

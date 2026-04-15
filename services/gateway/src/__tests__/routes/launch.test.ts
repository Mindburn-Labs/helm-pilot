import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchRoutes } from '../../routes/launch.js';
import { testApp, expectJson } from '../helpers.js';

const mockEngine = {
  listArtifacts: vi.fn(async () => []),
  getArtifact: vi.fn(async () => null),
  listDeployments: vi.fn(async () => []),
  listDeployTargets: vi.fn(async () => []),
  createDeployTarget: vi.fn(async () => ({ id: 'target-1', name: 'prod', provider: 'fly' })),
  recordDeployment: vi.fn(async () => ({ id: 'deploy-1', targetId: 'target-1', status: 'pending' })),
  updateDeploymentStatus: vi.fn(async () => null),
  recordHealthCheck: vi.fn(async () => ({ id: 'hc-1', status: 'healthy' })),
};

vi.mock('@helm-pilot/launch-engine', () => ({
  LaunchEngine: vi.fn().mockImplementation(() => mockEngine),
}));

beforeEach(() => {
  Object.values(mockEngine).forEach((fn) => fn.mockClear());
});

describe('launchRoutes', () => {
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
      const res = await fetch('GET', '/artifacts?workspaceId=ws-1');
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
      const res = await fetch('GET', '/artifacts/art-999');
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Not found');
    });

    it('returns 200 when artifact found', async () => {
      const artifact = { id: 'art-1', name: 'bundle.zip', size: 1024 };
      mockEngine.getArtifact.mockResolvedValueOnce(artifact);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/artifacts/art-1');
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
      const res = await fetch('GET', '/deployments?workspaceId=ws-1');
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
      const targets = [{ id: 'target-1', name: 'prod', provider: 'fly' }];
      mockEngine.listDeployTargets.mockResolvedValueOnce(targets);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('GET', '/targets?workspaceId=ws-1');
      const json = await expectJson(res, 200);

      expect(mockEngine.listDeployTargets).toHaveBeenCalledWith('ws-1');
      expect(json).toEqual(targets);
    });
  });

  // ─── POST /targets ───

  describe('POST /targets', () => {
    it('returns 400 when required fields are missing', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/targets', { workspaceId: 'ws-1' });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId, name, and provider required');
    });

    it('returns 201 on success', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/targets', {
        workspaceId: 'ws-1',
        name: 'prod',
        provider: 'fly',
      });
      const json = await expectJson(res, 201);

      expect(mockEngine.createDeployTarget).toHaveBeenCalledWith('ws-1', {
        name: 'prod',
        provider: 'fly',
        config: undefined,
      });
      expect(json).toEqual({ id: 'target-1', name: 'prod', provider: 'fly' });
    });
  });

  // ─── POST /deployments ───

  describe('POST /deployments', () => {
    it('returns 400 when required fields are missing', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/deployments', { workspaceId: 'ws-1' });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId and targetId required');
    });

    it('returns 201 on success', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/deployments', {
        workspaceId: 'ws-1',
        targetId: 'target-1',
      });
      const json = await expectJson(res, 201);

      expect(mockEngine.recordDeployment).toHaveBeenCalledWith('ws-1', {
        targetId: 'target-1',
        artifactId: undefined,
        version: undefined,
      });
      expect(json).toEqual({ id: 'deploy-1', targetId: 'target-1', status: 'pending' });
    });
  });

  // ─── PUT /deployments/:id/status ───

  describe('PUT /deployments/:id/status', () => {
    it('returns 404 when deployment not found', async () => {
      mockEngine.updateDeploymentStatus.mockResolvedValueOnce(null);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('PUT', '/deployments/dep-999/status', { status: 'running' });
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Deployment not found');
    });

    it('returns 200 when updated', async () => {
      const updated = { id: 'dep-1', status: 'running', url: 'https://app.fly.dev' };
      mockEngine.updateDeploymentStatus.mockResolvedValueOnce(updated);

      const { fetch } = testApp(launchRoutes);
      const res = await fetch('PUT', '/deployments/dep-1/status', {
        status: 'running',
        url: 'https://app.fly.dev',
      });
      const json = await expectJson(res, 200);

      expect(mockEngine.updateDeploymentStatus).toHaveBeenCalledWith(
        'dep-1',
        'running',
        'https://app.fly.dev',
      );
      expect(json).toEqual(updated);
    });
  });

  // ─── POST /deployments/:id/health ───

  describe('POST /deployments/:id/health', () => {
    it('returns 201 on success', async () => {
      const { fetch } = testApp(launchRoutes);
      const res = await fetch('POST', '/deployments/dep-1/health', {
        status: 'healthy',
        responseTimeMs: '42',
      });
      const json = await expectJson(res, 201);

      expect(mockEngine.recordHealthCheck).toHaveBeenCalledWith('dep-1', {
        status: 'healthy',
        responseTimeMs: '42',
        details: undefined,
      });
      expect(json).toEqual({ id: 'hc-1', status: 'healthy' });
    });
  });
});

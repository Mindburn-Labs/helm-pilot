import { describe, it, expect, vi } from 'vitest';
import { connectorRoutes } from '../../routes/connector.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

function createConnectorsMock() {
  return {
    listConnectors: vi.fn(() => [
      {
        id: 'github',
        name: 'GitHub',
        description: 'GitHub',
        authType: 'oauth2',
        requiredScopes: ['repo'],
        requiresApproval: true,
      },
    ]),
    listWorkspaceGrants: vi.fn(async () => []),
    getConnector: vi.fn((name: string) =>
      name === 'github'
        ? {
            id: 'github',
            name: 'GitHub',
            description: 'GitHub',
            authType: 'oauth2',
            requiredScopes: ['repo'],
            requiresApproval: true,
          }
        : null,
    ),
    grantConnector: vi.fn(async () => 'grant-1'),
    revokeConnector: vi.fn(async () => {}),
    storeToken: vi.fn(async () => {}),
    getGrantByWorkspaceConnector: vi.fn(async () => null),
    getTokenRecord: vi.fn(async () => null),
  };
}

describe('connectorRoutes', () => {
  describe('GET /', () => {
    it('returns 503 when connectors are not configured', async () => {
      const { fetch } = testApp(connectorRoutes);
      const res = await fetch('GET', '/');
      const body = await expectJson<{ error: string }>(res, 503);
      expect(body.error).toContain('not configured');
    });

    it('returns connector definitions when no workspace is provided', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('GET', '/');
      const body = await expectJson<Array<{ id: string; connectionState: string }>>(res, 200);
      expect(body[0]).toMatchObject({
        id: 'github',
        connectionState: 'available',
      });
    });

    it('returns workspace-enriched connector status when workspaceId is provided', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue({
        id: 'grant-1',
        workspaceId: 'ws-1',
        scopes: ['repo'],
        grantedAt: new Date('2026-04-15T00:00:00Z'),
      });
      connectors.getTokenRecord.mockResolvedValue({
        expiresAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-04-15T00:00:00Z'),
      });
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('GET', '/?workspaceId=ws-1');
      const body = await expectJson<Array<{ connectionState: string; hasToken: boolean }>>(res, 200);
      expect(body[0]).toMatchObject({
        connectionState: 'connected',
        hasToken: true,
      });
    });
  });

  describe('GET /grants', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('GET', '/grants');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns grants for a workspace', async () => {
      const connectors = createConnectorsMock();
      connectors.listWorkspaceGrants.mockResolvedValue([
        { id: 'grant-1', workspaceId: 'ws-1', connectorId: 'connector-1' },
      ]);
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('GET', '/grants?workspaceId=ws-1');
      const body = await expectJson<unknown[]>(res, 200);
      expect(body).toEqual([{ id: 'grant-1', workspaceId: 'ws-1', connectorId: 'connector-1' }]);
    });
  });

  describe('POST /:name/grant', () => {
    it('returns 404 for unknown connector', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/unknown/grant', { workspaceId: 'ws-1' });
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('Unknown connector');
    });

    it('grants connector and returns connector status', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue({
        id: 'grant-1',
        workspaceId: 'ws-1',
        scopes: ['repo'],
        grantedAt: new Date('2026-04-15T00:00:00Z'),
      });
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/github/grant', { workspaceId: 'ws-1' });
      const body = await expectJson<{ grantId: string; status: { connectionState: string } }>(res, 201);
      expect(body.grantId).toBe('grant-1');
      expect(body.status.connectionState).toBe('granted');
    });
  });

  describe('DELETE /:name/grant', () => {
    it('revokes grant and returns { revoked: true }', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('DELETE', '/github/grant?workspaceId=ws-1');
      const body = await expectJson<{ revoked: boolean }>(res, 200);
      expect(body.revoked).toBe(true);
      expect(connectors.revokeConnector).toHaveBeenCalledWith('ws-1', 'github');
    });
  });

  describe('POST /:name/token', () => {
    it('returns 400 when required fields are missing', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/github/token', { grantId: 'grant-1' });
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('grantId and accessToken');
    });

    it('stores token and returns { stored: true }', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/github/token', {
        grantId: 'grant-1',
        accessToken: 'ghp_abc123',
      });
      const body = await expectJson<{ stored: boolean }>(res, 200);
      expect(body.stored).toBe(true);
      expect(connectors.storeToken).toHaveBeenCalledWith('grant-1', 'ghp_abc123', undefined, undefined);
    });
  });

  describe('GET /:name/oauth/initiate', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const deps = createMockDeps({ connectors: createConnectorsMock() as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('GET', '/github/oauth/initiate');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns authUrl when OAuth is configured', async () => {
      const deps = createMockDeps({ connectors: createConnectorsMock() as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('GET', '/github/oauth/initiate?workspaceId=ws-1');
      const body = await expectJson<{ authUrl: string; connector: string }>(res, 200);
      expect(body.connector).toBe('github');
      expect(body.authUrl).toContain('auth.example.com');
    });
  });

  describe('POST /:name/oauth/refresh', () => {
    it('returns 401 when refresh fails', async () => {
      const deps = createMockDeps({
        connectors: createConnectorsMock() as any,
        oauth: {
          ...createMockDeps().oauth,
          refreshToken: vi.fn(async () => null),
        } as any,
      });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/github/oauth/refresh', { grantId: 'grant-1' });
      const body = await expectJson<{ error: string }>(res, 401);
      expect(body.error).toContain('Token refresh failed');
    });
  });
});

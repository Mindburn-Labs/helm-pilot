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
      {
        id: 'yc',
        name: 'YC Matching',
        description: 'YC private session connector',
        authType: 'session',
        requiredScopes: ['matching:read'],
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
        : name === 'yc'
          ? {
              id: 'yc',
              name: 'YC Matching',
              description: 'YC private session connector',
              authType: 'session',
              requiredScopes: ['matching:read'],
              requiresApproval: true,
            }
          : null,
    ),
    grantConnector: vi.fn(async () => 'grant-1'),
    revokeConnector: vi.fn(async () => {}),
    storeToken: vi.fn(async () => {}),
    storeSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    markSessionValidated: vi.fn(async () => {}),
    getGrantByWorkspaceConnector: vi.fn(async () => null),
    getTokenRecord: vi.fn(async () => null),
    getSessionRecord: vi.fn(async () => null),
  };
}

describe('connectorRoutes', () => {
  const wsHeader = { 'X-Workspace-Id': 'ws-1' };
  const ownedGrant = {
    id: 'grant-1',
    workspaceId: 'ws-1',
    scopes: ['repo'],
    grantedAt: new Date('2026-04-15T00:00:00Z'),
  };

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

      const res = await fetch('GET', '/', undefined, wsHeader);
      const body = await expectJson<Array<{ connectionState: string; hasToken: boolean }>>(
        res,
        200,
      );
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

      const res = await fetch('GET', '/grants', undefined, wsHeader);
      const body = await expectJson<unknown[]>(res, 200);
      expect(body).toEqual([{ id: 'grant-1', workspaceId: 'ws-1', connectorId: 'connector-1' }]);
    });
  });

  describe('POST /:name/grant', () => {
    it('returns 404 for unknown connector', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/unknown/grant', { workspaceId: 'ws-1' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('Unknown connector');
    });

    it('returns 403 when body workspaceId mismatches the bound workspace', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/github/grant', { workspaceId: 'ws-2' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 403);
      expect(body.error).toContain('does not match');
      expect(connectors.grantConnector).not.toHaveBeenCalled();
    });

    it('grants connector and returns connector status', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue(ownedGrant);
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/github/grant', { workspaceId: 'ws-1' }, wsHeader);
      const body = await expectJson<{ grantId: string; status: { connectionState: string } }>(
        res,
        201,
      );
      expect(body.grantId).toBe('grant-1');
      expect(body.status.connectionState).toBe('granted');
    });
  });

  describe('DELETE /:name/grant', () => {
    it('revokes grant and returns { revoked: true }', async () => {
      const connectors = createConnectorsMock();
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('DELETE', '/github/grant', undefined, wsHeader);
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
      connectors.getGrantByWorkspaceConnector.mockResolvedValue(ownedGrant);
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch(
        'POST',
        '/github/token',
        {
          grantId: 'grant-1',
          accessToken: 'ghp_abc123',
        },
        wsHeader,
      );
      const body = await expectJson<{ stored: boolean }>(res, 200);
      expect(body.stored).toBe(true);
      expect(connectors.storeToken).toHaveBeenCalledWith(
        'grant-1',
        'ghp_abc123',
        undefined,
        undefined,
      );
    });

    it('rejects token storage for a cross-workspace grantId', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue({
        ...ownedGrant,
        id: 'grant-owned',
      });
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch(
        'POST',
        '/github/token',
        {
          grantId: 'grant-foreign',
          accessToken: 'ghp_abc123',
        },
        wsHeader,
      );
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('Connector grant not found');
      expect(connectors.storeToken).not.toHaveBeenCalled();
    });
  });

  describe('POST /:name/session', () => {
    it('stores session payload for session-auth connectors', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue({
        ...ownedGrant,
        id: '00000000-0000-4000-8000-000000000001',
      });
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);
      const grantId = '00000000-0000-4000-8000-000000000001';

      const res = await fetch(
        'POST',
        '/yc/session',
        {
          grantId,
          sessionData: { cookies: [] },
          sessionType: 'browser_storage_state',
        },
        wsHeader,
      );
      const body = await expectJson<{ stored: boolean }>(res, 200);
      expect(body.stored).toBe(true);
      expect(connectors.storeSession).toHaveBeenCalledWith(
        grantId,
        { cookies: [] },
        'browser_storage_state',
        undefined,
      );
    });

    it('rejects session storage for a cross-workspace grantId', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue({
        ...ownedGrant,
        id: 'grant-owned',
      });
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch(
        'POST',
        '/yc/session',
        {
          grantId: '00000000-0000-4000-8000-000000000009',
          sessionData: { cookies: [] },
          sessionType: 'browser_storage_state',
        },
        wsHeader,
      );
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('Connector grant not found');
      expect(connectors.storeSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /:name/session/validate', () => {
    it('queues validation for session-auth connectors', async () => {
      const connectors = createConnectorsMock();
      const grantId = '00000000-0000-4000-8000-000000000001';
      connectors.getGrantByWorkspaceConnector.mockResolvedValue({
        ...ownedGrant,
        id: grantId,
      });
      connectors.getSessionRecord.mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000002',
        grantId,
        sessionType: 'browser_storage_state',
      });
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch(
        'POST',
        '/yc/session/validate',
        { grantId, action: 'validate', limit: 10 },
        { 'X-Workspace-Id': 'ws-1' },
      );
      const body = await expectJson<{ queued: boolean; queue: string }>(res, 200);
      expect(body).toMatchObject({ queued: true, queue: 'pipeline.yc-private' });
      expect(deps.orchestrator.boss.send).toHaveBeenCalledWith('pipeline.yc-private', {
        workspaceId: 'ws-1',
        grantId,
        action: 'validate',
        limit: 10,
      });
      expect(connectors.markSessionValidated).toHaveBeenCalled();
    });
  });

  describe('DELETE /:name/session', () => {
    it('deletes stored connector session', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue(ownedGrant);
      const deps = createMockDeps({ connectors: connectors as any });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('DELETE', '/yc/session?grantId=grant-1', undefined, wsHeader);
      const body = await expectJson<{ deleted: boolean }>(res, 200);
      expect(body.deleted).toBe(true);
      expect(connectors.deleteSession).toHaveBeenCalledWith('grant-1');
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

      const res = await fetch('GET', '/github/oauth/initiate', undefined, wsHeader);
      const body = await expectJson<{ authUrl: string; connector: string }>(res, 200);
      expect(body.connector).toBe('github');
      expect(body.authUrl).toContain('auth.example.com');
    });
  });

  describe('POST /:name/oauth/refresh', () => {
    it('returns 401 when refresh fails', async () => {
      const deps = createMockDeps({
        connectors: {
          ...createConnectorsMock(),
          getGrantByWorkspaceConnector: vi.fn(async () => ownedGrant),
        } as any,
        oauth: {
          ...createMockDeps().oauth,
          refreshToken: vi.fn(async () => null),
        } as any,
      });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch('POST', '/github/oauth/refresh', { grantId: 'grant-1' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 401);
      expect(body.error).toContain('Token refresh failed');
    });

    it('rejects token refresh for a cross-workspace grantId', async () => {
      const connectors = createConnectorsMock();
      connectors.getGrantByWorkspaceConnector.mockResolvedValue({
        ...ownedGrant,
        id: 'grant-owned',
      });
      const deps = createMockDeps({
        connectors: connectors as any,
        oauth: {
          ...createMockDeps().oauth,
          refreshToken: vi.fn(async () => 'new-token'),
        } as any,
      });
      const { fetch } = testApp(connectorRoutes, deps);

      const res = await fetch(
        'POST',
        '/github/oauth/refresh',
        { grantId: 'grant-foreign' },
        wsHeader,
      );
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('Connector grant not found');
      expect(deps.oauth.refreshToken).not.toHaveBeenCalled();
    });
  });
});

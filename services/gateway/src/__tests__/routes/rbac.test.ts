import { describe, it, expect, vi } from 'vitest';
import { auditRoutes } from '../../routes/audit.js';
import { complianceRoutes } from '../../routes/compliance.js';
import { connectorRoutes } from '../../routes/connector.js';
import { operatorRoutes } from '../../routes/operator.js';
import { secretsRoutes } from '../../routes/secrets.js';
import { workspaceRoutes } from '../../routes/workspace.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const memberHeader = {
  'X-Workspace-Id': '00000000-0000-4000-8000-000000000001',
  'X-Workspace-Role': 'member',
};

function connectorsMock() {
  return {
    listConnectors: vi.fn(() => []),
    getConnector: vi.fn(() => ({
      id: 'github',
      name: 'GitHub',
      description: 'GitHub',
      authType: 'oauth2',
      requiredScopes: ['repo'],
      requiresApproval: true,
    })),
    grantConnector: vi.fn(async () => 'grant-1'),
    revokeConnector: vi.fn(async () => {}),
    getGrantByWorkspaceConnector: vi.fn(async () => null),
  };
}

describe('workspace RBAC enforcement', () => {
  it('denies member role workspace mode mutation', async () => {
    const { fetch } = testApp(workspaceRoutes);
    const res = await fetch(
      'PUT',
      '/00000000-0000-4000-8000-000000000001/mode',
      { mode: 'build' },
      memberHeader,
    );
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('owner');
  });

  it('denies member role secret metadata reads', async () => {
    const { fetch } = testApp(secretsRoutes);
    const res = await fetch('GET', '/', undefined, memberHeader);
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('owner');
  });

  it('denies member role connector grants before mutating connector state', async () => {
    const connectors = connectorsMock();
    const deps = createMockDeps({ connectors: connectors as any });
    const { fetch } = testApp(connectorRoutes, deps);

    const res = await fetch(
      'POST',
      '/github/grant',
      { workspaceId: memberHeader['X-Workspace-Id'] },
      memberHeader,
    );
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('owner');
    expect(connectors.grantConnector).not.toHaveBeenCalled();
  });

  it('denies member role approval resolution before resuming tasks', async () => {
    const deps = createMockDeps();
    const { fetch } = testApp(auditRoutes, deps);

    const res = await fetch('PUT', '/approvals/appr-1', { status: 'approved' }, memberHeader);
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('owner');
    expect(deps.orchestrator.boss.send).not.toHaveBeenCalled();
  });

  it('denies member role operator creation', async () => {
    const deps = createMockDeps();
    const { fetch } = testApp(operatorRoutes, deps);

    const res = await fetch(
      'POST',
      '/',
      {
        workspaceId: memberHeader['X-Workspace-Id'],
        name: 'Growth Bot',
        role: 'growth',
        goal: 'Find pipeline',
      },
      memberHeader,
    );
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('owner');
    expect(deps.db.insert).not.toHaveBeenCalled();
  });

  it('denies member role compliance framework changes', async () => {
    const deps = createMockDeps();
    const { fetch } = testApp(complianceRoutes, deps);

    const res = await fetch('POST', '/frameworks', { code: 'soc2' }, memberHeader);
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('owner');
    expect(deps.db.update).not.toHaveBeenCalled();
  });
});

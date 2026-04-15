import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditRoutes } from '../../routes/audit.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

describe('auditRoutes', () => {
  // ── GET / ──

  describe('GET /', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const { fetch } = testApp(auditRoutes);
      const res = await fetch('GET', '/');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns audit entries for a workspace', async () => {
      const deps = createMockDeps();
      const entries = [
        { id: 'al-1', workspaceId: 'ws-1', action: 'task.created', createdAt: new Date().toISOString() },
        { id: 'al-2', workspaceId: 'ws-1', action: 'task.completed', createdAt: new Date().toISOString() },
      ];
      deps.db._setResult(entries);

      const { fetch } = testApp(auditRoutes, deps);
      const res = await fetch('GET', '/?workspaceId=ws-1');
      const body = await expectJson<unknown[]>(res, 200);
      expect(body).toEqual(entries);
    });
  });

  // ── GET /approvals ──

  describe('GET /approvals', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const { fetch } = testApp(auditRoutes);
      const res = await fetch('GET', '/approvals');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns approvals for a workspace', async () => {
      const deps = createMockDeps();
      const approvalsList = [
        { id: 'appr-1', workspaceId: 'ws-1', action: 'deploy', status: 'pending' },
      ];
      deps.db._setResult(approvalsList);

      const { fetch } = testApp(auditRoutes, deps);
      const res = await fetch('GET', '/approvals?workspaceId=ws-1');
      const body = await expectJson<unknown[]>(res, 200);
      expect(body).toEqual(approvalsList);
    });
  });

  // ── PUT /approvals/:id ──

  describe('PUT /approvals/:id', () => {
    it('returns 400 for invalid status', async () => {
      const { fetch } = testApp(auditRoutes);
      const res = await fetch('PUT', '/approvals/appr-1', { status: 'maybe' });
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('approved or rejected');
    });

    it('returns 404 when approval is not found', async () => {
      const deps = createMockDeps();
      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
            then: (r: any) => r([]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(auditRoutes, deps);
      const res = await fetch('PUT', '/approvals/appr-missing', { status: 'approved' });
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('not found');
    });

    it('triggers boss.send when approval is approved', async () => {
      const deps = createMockDeps();
      const approval = {
        id: 'appr-1',
        taskId: 'task-1',
        workspaceId: 'ws-1',
        action: 'deploy.production',
        status: 'approved',
        resolvedBy: 'unknown',
        resolvedAt: new Date().toISOString(),
      };

      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [approval]),
            then: (r: any) => r([approval]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(auditRoutes, deps);
      const res = await fetch('PUT', '/approvals/appr-1', { status: 'approved' });
      await expectJson(res, 200);

      expect(deps.orchestrator.boss.send).toHaveBeenCalledWith('task.resume', {
        taskId: 'task-1',
        workspaceId: 'ws-1',
        context: expect.stringContaining('deploy.production'),
      });
    });

    it('does not trigger boss.send when approval is rejected', async () => {
      const deps = createMockDeps();
      const approval = {
        id: 'appr-1',
        taskId: 'task-1',
        workspaceId: 'ws-1',
        action: 'deploy.production',
        status: 'rejected',
        resolvedBy: 'unknown',
        resolvedAt: new Date().toISOString(),
      };

      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [approval]),
            then: (r: any) => r([approval]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(auditRoutes, deps);
      const res = await fetch('PUT', '/approvals/appr-1', { status: 'rejected' });
      await expectJson(res, 200);

      expect(deps.orchestrator.boss.send).not.toHaveBeenCalled();
    });
  });

  // ── GET /violations ──

  describe('GET /violations', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const { fetch } = testApp(auditRoutes);
      const res = await fetch('GET', '/violations');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns violations for a workspace', async () => {
      const deps = createMockDeps();
      const violations = [
        { id: 'v-1', workspaceId: 'ws-1', rule: 'no-prod-delete', severity: 'high' },
      ];
      deps.db._setResult(violations);

      const { fetch } = testApp(auditRoutes, deps);
      const res = await fetch('GET', '/violations?workspaceId=ws-1');
      const body = await expectJson<unknown[]>(res, 200);
      expect(body).toEqual(violations);
    });
  });
});

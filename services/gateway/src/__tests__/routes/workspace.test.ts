import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceRoutes } from '../../routes/workspace.js';
import { createMockDeps, testApp, expectJson, mockWorkspace, mockMembership } from '../helpers.js';

describe('workspaceRoutes', () => {
  const wsHeader = { 'X-Workspace-Id': 'ws-1' };

  // ─── GET /:id ───

  describe('GET /:id', () => {
    it('returns 200 with workspace and members when found', async () => {
      const { fetch, deps } = testApp(workspaceRoutes);
      const ws = mockWorkspace();
      deps.db._setResult([ws]);

      const res = await fetch('GET', '/ws-1', undefined, wsHeader);
      const json = await expectJson<Record<string, unknown>>(res, 200);
      expect(json).toHaveProperty('id', 'ws-1');
      expect(json).toHaveProperty('members');
    });

    it('returns 404 when workspace not found', async () => {
      const { fetch } = testApp(workspaceRoutes);
      // Default mock returns [] — no workspace found
      const res = await fetch('GET', '/ws-1', undefined, wsHeader);
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Workspace not found');
    });

    it('returns 403 when path workspace mismatches the bound workspace', async () => {
      const { fetch } = testApp(workspaceRoutes);
      const res = await fetch('GET', '/ws-2', undefined, wsHeader);
      const json = await expectJson(res, 403);
      expect(json).toHaveProperty('error', 'workspaceId does not match authenticated workspace');
    });
  });

  // ─── GET /:id/settings ───

  describe('GET /:id/settings', () => {
    it('returns default settings when none exist', async () => {
      const { fetch } = testApp(workspaceRoutes);
      // Default mock returns [] — no settings row
      const res = await fetch('GET', '/ws-1/settings', undefined, wsHeader);
      const json = await expectJson<Record<string, unknown>>(res, 200);
      expect(json).toHaveProperty('workspaceId', 'ws-1');
      expect(json).toHaveProperty('policyConfig');
      expect(json).toHaveProperty('budgetConfig');
      expect(json).toHaveProperty('modelConfig');
    });

    it('returns stored settings when they exist', async () => {
      const { fetch, deps } = testApp(workspaceRoutes);
      const settings = {
        id: 'set-1',
        workspaceId: 'ws-1',
        policyConfig: {
          maxIterationBudget: 25,
          blockedTools: ['shell'],
          requireApprovalFor: ['send_notification'],
        },
        budgetConfig: { dailyTotalMax: 50, currency: 'EUR' },
        modelConfig: { provider: 'openrouter', model: 'gpt-4', temperature: 0.5 },
      };
      deps.db._setResult([settings]);

      const res = await fetch('GET', '/ws-1/settings', undefined, wsHeader);
      const json = await expectJson<typeof settings>(res, 200);
      expect(json.policyConfig.maxIterationBudget).toBe(25);
      expect((json as any).policyConfig.toolBlocklist).toEqual(['shell']);
      expect(json.budgetConfig.currency).toBe('EUR');
    });
  });

  // ─── PUT /:id/settings ───

  describe('PUT /:id/settings', () => {
    it('returns 404 when workspace not found', async () => {
      const { fetch } = testApp(workspaceRoutes);
      // Default mock returns [] — workspace select fails
      const res = await fetch('PUT', '/ws-1/settings', { policyConfig: {} }, wsHeader);
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Workspace not found');
    });

    it('creates new settings (201) when workspace exists but no settings', async () => {
      const deps = createMockDeps();
      let selectCallCount = 0;
      deps.db.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => {
              selectCallCount++;
              // First select: workspace lookup -> found
              // Second select: existing settings -> not found
              const result = selectCallCount === 1 ? [mockWorkspace()] : [];
              return { then: (r: any) => r(result) };
            }),
          })),
        })),
      })) as any;

      const created = {
        id: 'set-new',
        workspaceId: 'ws-1',
        policyConfig: { maxIterationBudget: 50, toolBlocklist: [] },
        budgetConfig: {},
        modelConfig: {},
      };
      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [created]),
          then: (r: any) => r([created]),
        })),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch(
        'PUT',
        '/ws-1/settings',
        {
          policyConfig: { maxIterationBudget: 50 },
        },
        wsHeader,
      );
      const json = await expectJson(res, 201);
      expect(json).toHaveProperty('workspaceId', 'ws-1');
    });

    it('updates existing settings (200)', async () => {
      const deps = createMockDeps();
      const existingSettings = {
        id: 'set-1',
        workspaceId: 'ws-1',
        policyConfig: { maxIterationBudget: 50, toolBlocklist: [] },
        budgetConfig: {},
        modelConfig: {},
      };
      let selectCallCount = 0;
      deps.db.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => {
              selectCallCount++;
              // First select: workspace -> found
              // Second select: existing settings -> found
              return {
                then: (r: any) => r(selectCallCount === 1 ? [mockWorkspace()] : [existingSettings]),
              };
            }),
          })),
        })),
      })) as any;

      const updatedSettings = { ...existingSettings, policyConfig: { maxIterationBudget: 10 } };
      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [updatedSettings]),
            then: (r: any) => r([updatedSettings]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch(
        'PUT',
        '/ws-1/settings',
        {
          policyConfig: { maxIterationBudget: 10 },
        },
        wsHeader,
      );
      const json = await expectJson<typeof updatedSettings>(res, 200);
      expect(json.policyConfig.maxIterationBudget).toBe(10);
    });
  });

  // ─── PUT /:id/mode ───

  describe('PUT /:id/mode', () => {
    it('returns 400 for invalid mode', async () => {
      const { fetch } = testApp(workspaceRoutes);
      const res = await fetch('PUT', '/ws-1/mode', { mode: 'invalid-mode' }, wsHeader);
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error');
      expect((json as { error: string }).error).toContain('Invalid mode');
    });

    it('returns updated workspace on success', async () => {
      const deps = createMockDeps();
      const updated = mockWorkspace({ currentMode: 'launch' });
      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [updated]),
            then: (r: any) => r([updated]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch('PUT', '/ws-1/mode', { mode: 'launch' }, wsHeader);
      const json = await expectJson<{ id: string; currentMode: string }>(res, 200);
      expect(json.currentMode).toBe('launch');
    });

    it('returns 404 when workspace not found', async () => {
      const deps = createMockDeps();
      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
            then: (r: any) => r([]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch('PUT', '/ws-1/mode', { mode: 'build' }, wsHeader);
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Workspace not found');
    });
  });

  // ─── POST /:id/invite ───

  describe('POST /:id/invite', () => {
    it('returns 404 when workspace not found', async () => {
      const { fetch } = testApp(workspaceRoutes);
      // Default mock returns [] — no workspace
      const res = await fetch('POST', '/ws-1/invite', { role: 'member' }, wsHeader);
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Workspace not found');
    });

    it('returns 201 with inviteUrl on success', async () => {
      const { fetch, deps } = testApp(workspaceRoutes);
      deps.db._setResult([mockWorkspace()]);

      const res = await fetch('POST', '/ws-1/invite', { role: 'member' }, wsHeader);
      const json = await expectJson<{ inviteUrl: string; role: string }>(res, 201);
      expect(json.inviteUrl).toContain('/invite/');
      expect(json.role).toBe('member');
    });
  });
});

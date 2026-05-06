import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditLog, evidenceItems, sessions, workspaceSettings, workspaces } from '@pilot/db/schema';
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
      expect((json as any).policyConfig.killSwitch).toBe(false);
      expect((json as any).policyConfig.contentBans).toEqual([]);
    });

    it('returns stored settings when they exist', async () => {
      const { fetch, deps } = testApp(workspaceRoutes);
      const settings = {
        id: 'set-1',
        workspaceId: 'ws-1',
        policyConfig: {
          maxIterationBudget: 25,
          killSwitch: true,
          blockedTools: ['shell'],
          contentBans: ['credential prompts'],
          requireApprovalFor: ['send_notification'],
        },
        budgetConfig: { dailyTotalMax: 50, currency: 'EUR' },
        modelConfig: { provider: 'openrouter', model: 'gpt-4', temperature: 0.5 },
      };
      deps.db._setResult([settings]);

      const res = await fetch('GET', '/ws-1/settings', undefined, wsHeader);
      const json = await expectJson<typeof settings>(res, 200);
      expect(json.policyConfig.maxIterationBudget).toBe(25);
      expect((json as any).policyConfig.killSwitch).toBe(true);
      expect((json as any).policyConfig.toolBlocklist).toEqual(['shell']);
      expect((json as any).policyConfig.contentBans).toEqual(['credential prompts']);
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
        policyConfig: {
          maxIterationBudget: 50,
          killSwitch: true,
          contentBans: ['no external promises'],
          toolBlocklist: [],
        },
        budgetConfig: {},
        modelConfig: {},
      };
      const inserts: Array<{ table: unknown; value: unknown }> = [];
      const updates: Array<{ table: unknown; value: unknown }> = [];
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, value });
          return {
            returning: vi.fn(async () => {
              if (table === workspaceSettings) return [created];
              if (table === evidenceItems) return [{ id: 'evidence-settings-1' }];
              return [];
            }),
            then: (r: any) => r([]),
          };
        }),
      })) as any;
      deps.db.update = vi.fn((table: unknown) => ({
        set: vi.fn((value: unknown) => {
          updates.push({ table, value });
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => []),
              then: (r: any) => r([]),
            })),
          };
        }),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch(
        'PUT',
        '/ws-1/settings',
        {
          policyConfig: {
            maxIterationBudget: 50,
            killSwitch: true,
            contentBans: ['no external promises'],
          },
        },
        wsHeader,
      );
      const json = await expectJson(res, 201);
      expect(json).toHaveProperty('workspaceId', 'ws-1');
      expect((json as any).policyConfig.killSwitch).toBe(true);
      expect((json as any).policyConfig.contentBans).toEqual(['no external promises']);
      expect(inserts.map((insert) => insert.table)).toEqual([
        workspaceSettings,
        auditLog,
        evidenceItems,
      ]);
      expect(inserts.find((insert) => insert.table === workspaceSettings)?.value).toEqual(
        expect.objectContaining({
          workspaceId: 'ws-1',
          policyConfig: expect.objectContaining({
            maxIterationBudget: 50,
            killSwitch: true,
            contentBans: ['no external promises'],
          }),
        }),
      );
      const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
        id: string;
      };
      expect(auditInsert).toMatchObject({
        workspaceId: 'ws-1',
        action: 'WORKSPACE_SETTINGS_CREATED',
        target: 'ws-1',
        verdict: 'allow',
        metadata: {
          evidenceType: 'workspace_settings_created',
          changedSections: ['policyConfig'],
          created: true,
        },
      });
      expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
        workspaceId: 'ws-1',
        auditEventId: auditInsert.id,
        evidenceType: 'workspace_settings_created',
        sourceType: 'gateway_workspace_control',
        metadata: {
          workspaceId: 'ws-1',
          changedSections: ['policyConfig'],
          created: true,
        },
      });
      expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
        metadata: {
          evidenceItemId: 'evidence-settings-1',
        },
      });
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
      const inserts: Array<{ table: unknown; value: unknown }> = [];
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, value });
          return {
            returning: vi.fn(async () =>
              table === evidenceItems ? [{ id: 'evidence-settings-2' }] : [],
            ),
            then: (r: any) => r([]),
          };
        }),
      })) as any;
      deps.db.update = vi.fn((table: unknown) => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => (table === workspaceSettings ? [updatedSettings] : [])),
            then: (r: any) => r([]),
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
      expect(inserts.find((insert) => insert.table === auditLog)?.value).toMatchObject({
        workspaceId: 'ws-1',
        action: 'WORKSPACE_SETTINGS_UPDATED',
        metadata: {
          evidenceType: 'workspace_settings_updated',
          changedSections: ['policyConfig'],
          created: false,
        },
      });
    });

    it('fails closed when settings evidence cannot be persisted', async () => {
      const deps = createMockDeps();
      let selectCallCount = 0;
      deps.db.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => {
              selectCallCount++;
              return { then: (r: any) => r(selectCallCount === 1 ? [mockWorkspace()] : []) };
            }),
          })),
        })),
      })) as any;
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (table === workspaceSettings) return [{ id: 'set-new', workspaceId: 'ws-1' }];
            if (table === evidenceItems) throw new Error('evidence unavailable');
            return [];
          }),
          then: (r: any) => r([]),
        })),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch('PUT', '/ws-1/settings', { policyConfig: {} }, wsHeader);
      const json = await expectJson<{ error: string }>(res, 500);

      expect(json.error).toBe('Failed to update workspace settings');
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
      const inserts: Array<{ table: unknown; value: unknown }> = [];
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, value });
          return {
            returning: vi.fn(async () =>
              table === evidenceItems ? [{ id: 'evidence-mode-1' }] : [],
            ),
            then: (r: any) => r([]),
          };
        }),
      })) as any;
      deps.db.update = vi.fn((table: unknown) => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => (table === workspaces ? [updated] : [])),
            then: (r: any) => r([]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch('PUT', '/ws-1/mode', { mode: 'launch' }, wsHeader);
      const json = await expectJson<{ id: string; currentMode: string }>(res, 200);
      expect(json.currentMode).toBe('launch');
      expect(inserts.find((insert) => insert.table === auditLog)?.value).toMatchObject({
        workspaceId: 'ws-1',
        action: 'WORKSPACE_MODE_CHANGED',
        target: 'ws-1',
        metadata: {
          evidenceType: 'workspace_mode_changed',
          mode: 'launch',
        },
      });
      expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
        workspaceId: 'ws-1',
        evidenceType: 'workspace_mode_changed',
        sourceType: 'gateway_workspace_control',
        metadata: {
          mode: 'launch',
        },
      });
    });

    it('fails closed when mode evidence cannot be persisted', async () => {
      const deps = createMockDeps();
      const updated = mockWorkspace({ currentMode: 'build' });
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (table === evidenceItems) throw new Error('evidence unavailable');
            return [];
          }),
          then: (r: any) => r([]),
        })),
      })) as any;
      deps.db.update = vi.fn((table: unknown) => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => (table === workspaces ? [updated] : [])),
            then: (r: any) => r([]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch('PUT', '/ws-1/mode', { mode: 'build' }, wsHeader);
      const json = await expectJson<{ error: string }>(res, 500);

      expect(json.error).toBe('Failed to change workspace mode');
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
      const deps = createMockDeps();
      deps.db._setResult([mockWorkspace()]);
      const inserts: Array<{ table: unknown; value: unknown }> = [];
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, value });
          return {
            returning: vi.fn(async () =>
              table === evidenceItems ? [{ id: 'evidence-invite-1' }] : [],
            ),
            then: (r: any) => r([]),
          };
        }),
      })) as any;

      const { fetch } = testApp(workspaceRoutes, deps as any);
      const res = await fetch('POST', '/ws-1/invite', { role: 'member' }, wsHeader);
      const json = await expectJson<{ inviteUrl: string; role: string }>(res, 201);
      expect(json.inviteUrl).toContain('/invite/');
      expect(json.role).toBe('member');
      expect(inserts.map((insert) => insert.table)).toEqual([sessions, auditLog, evidenceItems]);
      expect(inserts.find((insert) => insert.table === auditLog)?.value).toMatchObject({
        workspaceId: 'ws-1',
        action: 'WORKSPACE_INVITE_CREATED',
        target: 'ws-1',
        metadata: {
          evidenceType: 'workspace_invite_created',
          role: 'member',
          inviteTokenRedacted: true,
        },
      });
      const evidenceInsert = inserts.find((insert) => insert.table === evidenceItems)?.value;
      expect(evidenceInsert).toMatchObject({
        workspaceId: 'ws-1',
        evidenceType: 'workspace_invite_created',
        sourceType: 'gateway_workspace_control',
        metadata: {
          role: 'member',
          inviteTokenRedacted: true,
        },
      });
      expect(JSON.stringify(evidenceInsert)).not.toContain(json.inviteUrl);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditLog, evidenceItems, operatorConfigs, operators } from '@pilot/db/schema';
import { operatorRoutes } from '../../routes/operator.js';
import { testApp, expectJson, mockOperator, createMockDeps } from '../helpers.js';

describe('operatorRoutes', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let fetch: ReturnType<typeof testApp>['fetch'];
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const wsHeader = { 'X-Workspace-Id': workspaceId };

  beforeEach(() => {
    const t = testApp(operatorRoutes);
    deps = t.deps as ReturnType<typeof createMockDeps>;
    fetch = t.fetch;
    deps.db._reset();
  });

  // ── GET / ──

  describe('GET /', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const res = await fetch('GET', '/');
      const json = await expectJson<{ error: string }>(res, 400);

      expect(json.error).toBe('workspaceId required');
    });

    it('returns operators for a workspace', async () => {
      const ops = [mockOperator(), mockOperator({ id: 'op-2', name: 'Second' })];
      deps.db._setResult(ops);

      const res = await fetch('GET', '/', undefined, wsHeader);
      const json = await expectJson<unknown[]>(res, 200);

      expect(json).toHaveLength(2);
      expect(json[0]).toMatchObject({ id: 'op-1' });
      expect(json[1]).toMatchObject({ id: 'op-2' });
    });
  });

  // ── POST / ──

  describe('POST /', () => {
    it('returns 400 on invalid body', async () => {
      const res = await fetch(
        'POST',
        '/',
        {
          // missing required fields: workspaceId, name, role, goal
          name: 'Incomplete',
        },
        wsHeader,
      );
      const json = await expectJson<{ error: string }>(res, 400);

      expect(json.error).toBe('Validation failed');
    });

    it('creates operator with config and returns 201', async () => {
      const op = mockOperator({ name: 'Builder Bot', role: 'engineering', goal: 'Ship fast' });

      const inserts: Array<{ table: unknown; value: unknown }> = [];
      const updates: Array<{ table: unknown; value: unknown }> = [];
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, value });
          return {
            returning: vi.fn(async () => {
              if (table === operators) return [op];
              if (table === evidenceItems) return [{ id: 'evidence-operator-1' }];
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
            where: vi.fn(async () => []),
          };
        }),
      })) as any;

      const res = await fetch(
        'POST',
        '/',
        {
          workspaceId,
          name: 'Builder Bot',
          role: 'engineering',
          goal: 'Ship fast',
        },
        wsHeader,
      );
      const json = await expectJson<Record<string, unknown>>(res, 201);

      expect(json.name).toBe('Builder Bot');
      expect(inserts.map((insert) => insert.table)).toEqual([
        operators,
        operatorConfigs,
        auditLog,
        evidenceItems,
      ]);
      const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
        id: string;
      };
      expect(auditInsert).toMatchObject({
        workspaceId,
        action: 'WORKSPACE_OPERATOR_CREATED',
        target: 'op-1',
        verdict: 'allow',
        metadata: {
          evidenceType: 'workspace_operator_created',
          operatorId: 'op-1',
          role: 'engineering',
        },
      });
      expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
        workspaceId,
        auditEventId: auditInsert.id,
        evidenceType: 'workspace_operator_created',
        sourceType: 'gateway_operator',
        replayRef: 'operator:op-1:created',
        metadata: {
          operatorId: 'op-1',
          role: 'engineering',
        },
      });
      expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
        metadata: {
          evidenceItemId: 'evidence-operator-1',
        },
      });
    });

    it('fails closed when operator creation evidence cannot be persisted', async () => {
      const op = mockOperator({ name: 'Builder Bot', role: 'engineering', goal: 'Ship fast' });

      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (table === operators) return [op];
            if (table === evidenceItems) throw new Error('evidence unavailable');
            return [];
          }),
          then: (r: any) => r([]),
        })),
      })) as any;

      const res = await fetch(
        'POST',
        '/',
        {
          workspaceId,
          name: 'Builder Bot',
          role: 'engineering',
          goal: 'Ship fast',
        },
        wsHeader,
      );
      const json = await expectJson<{ error: string }>(res, 500);

      expect(json.error).toBe('Failed to create operator');
    });
  });

  // ── PUT /:id ──

  describe('PUT /:id', () => {
    it('updates operator and writes audit-linked evidence', async () => {
      const existing = mockOperator({
        workspaceId,
        name: 'Builder Bot',
        role: 'engineering',
        goal: 'Ship fast',
        tools: ['create_artifact'],
      });
      const updated = {
        ...existing,
        goal: 'Ship safely',
        isActive: 'false',
      };
      deps.db._setResult([existing]);
      const inserts: Array<{ table: unknown; value: unknown }> = [];
      const updates: Array<{ table: unknown; value: unknown }> = [];
      deps.db.insert = vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, value });
          return {
            returning: vi.fn(async () =>
              table === evidenceItems ? [{ id: 'evidence-operator-2' }] : [],
            ),
            then: (r: any) => r([]),
          };
        }),
      })) as any;
      deps.db.update = vi.fn((table: unknown) => ({
        set: vi.fn((value: unknown) => {
          updates.push({ table, value });
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => (table === operators ? [updated] : [])),
              then: (r: any) => r([]),
            })),
          };
        }),
      })) as any;

      const res = await fetch(
        'PUT',
        '/op-1',
        {
          goal: 'Ship safely',
          isActive: false,
        },
        wsHeader,
      );
      const json = await expectJson<Record<string, unknown>>(res, 200);

      expect(json.goal).toBe('Ship safely');
      const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
        id: string;
      };
      expect(auditInsert).toMatchObject({
        workspaceId,
        action: 'WORKSPACE_OPERATOR_UPDATED',
        target: 'op-1',
        verdict: 'allow',
        metadata: {
          evidenceType: 'workspace_operator_updated',
          operatorId: 'op-1',
          changedFields: ['goal', 'isActive'],
        },
      });
      expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
        workspaceId,
        auditEventId: auditInsert.id,
        evidenceType: 'workspace_operator_updated',
        sourceType: 'gateway_operator',
        replayRef: 'operator:op-1:updated',
        metadata: {
          operatorId: 'op-1',
          changedFields: ['goal', 'isActive'],
        },
      });
      expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
        metadata: {
          evidenceItemId: 'evidence-operator-2',
        },
      });
    });
  });

  // ── GET /roles ──

  describe('GET /roles', () => {
    it('returns available roles', async () => {
      const roles = [
        { id: 'r-1', name: 'engineering', description: 'Engineering operator' },
        { id: 'r-2', name: 'product', description: 'Product operator' },
      ];
      deps.db._setResult(roles);

      const res = await fetch('GET', '/roles');
      const json = await expectJson<unknown[]>(res, 200);

      expect(json).toHaveLength(2);
      expect(json[0]).toMatchObject({ name: 'engineering' });
    });
  });
});

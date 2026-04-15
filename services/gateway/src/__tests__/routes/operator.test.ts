import { describe, it, expect, vi, beforeEach } from 'vitest';
import { operatorRoutes } from '../../routes/operator.js';
import { testApp, expectJson, mockOperator, createMockDeps } from '../helpers.js';

describe('operatorRoutes', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let fetch: ReturnType<typeof testApp>['fetch'];

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

      const res = await fetch('GET', '/?workspaceId=ws-1');
      const json = await expectJson<unknown[]>(res, 200);

      expect(json).toHaveLength(2);
      expect(json[0]).toMatchObject({ id: 'op-1' });
      expect(json[1]).toMatchObject({ id: 'op-2' });
    });
  });

  // ── POST / ──

  describe('POST /', () => {
    it('returns 400 on invalid body', async () => {
      const res = await fetch('POST', '/', {
        // missing required fields: workspaceId, name, role, goal
        name: 'Incomplete',
      });
      const json = await expectJson<{ error: string }>(res, 400);

      expect(json.error).toBe('Validation failed');
    });

    it('creates operator with config and returns 201', async () => {
      const op = mockOperator({ name: 'Builder Bot', role: 'engineering', goal: 'Ship fast' });

      let insertCount = 0;
      deps.db.insert = vi.fn(() => {
        insertCount++;
        if (insertCount === 1) {
          return {
            values: vi.fn(() => ({
              returning: vi.fn(async () => [op]),
              then: (r: any) => r([op]),
            })),
          };
        }
        return {
          values: vi.fn(() => ({
            returning: vi.fn(async () => []),
            then: (r: any) => r([]),
          })),
        };
      }) as any;

      const res = await fetch('POST', '/', {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        name: 'Builder Bot',
        role: 'engineering',
        goal: 'Ship fast',
      });
      const json = await expectJson<Record<string, unknown>>(res, 201);

      expect(json.name).toBe('Builder Bot');
      expect(deps.db.insert).toHaveBeenCalledTimes(2);
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

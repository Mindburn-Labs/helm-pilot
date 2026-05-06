import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  auditLog,
  evidenceItems,
  workspaceMembers,
  workspaceSettings,
  workspaces,
} from '@pilot/db/schema';
import { adminRoutes } from '../../routes/admin.js';
import { testApp, createMockDeps, expectJson } from '../helpers.js';

const ADMIN_KEY = 'test-admin-key-0123456789abcdef';
const ownerUserId = '00000000-0000-4000-8000-000000000001';

function createTenantCreationDb(options: { failEvidence?: boolean; ownerExists?: boolean } = {}) {
  const inserts: Array<{ table: unknown; value: unknown }> = [];
  const updates: Array<{ table: unknown; value: unknown }> = [];

  const createDbFacade = (
    insertSink: Array<{ table: unknown; value: unknown }>,
    updateSink: Array<{ table: unknown; value: unknown }>,
  ) => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            options.ownerExists === false ? [] : [{ id: ownerUserId, name: 'Owner' }],
          ),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        insertSink.push({ table, value });
        return {
          returning: vi.fn(async () => {
            if (table === workspaces) {
              return [
                {
                  id: '00000000-0000-4000-8000-000000000101',
                  name: 'Acme',
                  ownerId: ownerUserId,
                },
              ];
            }
            if (table === evidenceItems) {
              if (options.failEvidence) throw new Error('evidence unavailable');
              return [{ id: 'evidence-admin-tenant-1' }];
            }
            return [];
          }),
          then: (resolve: (value: unknown[]) => void, reject?: (reason: unknown) => void) =>
            Promise.resolve([]).then(resolve, reject),
          catch: (reject: (reason: unknown) => void) => Promise.resolve([]).catch(reject),
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((value: unknown) => {
        updateSink.push({ table, value });
        return {
          where: vi.fn(async () => []),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
    })),
    execute: vi.fn(async () => [{ '?column?': 1 }]),
  });

  const db = {
    ...createDbFacade(inserts, updates),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const stagedInserts: Array<{ table: unknown; value: unknown }> = [];
      const stagedUpdates: Array<{ table: unknown; value: unknown }> = [];
      const tx = createDbFacade(stagedInserts, stagedUpdates);
      const result = await callback(tx);
      inserts.push(...stagedInserts);
      updates.push(...stagedUpdates);
      return result;
    }),
    _setResult: vi.fn(),
    _reset: vi.fn(),
  };

  return { db, inserts, updates };
}

describe('adminRoutes', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['PILOT_ADMIN_API_KEY'];
    process.env['PILOT_ADMIN_API_KEY'] = ADMIN_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['PILOT_ADMIN_API_KEY'];
    else process.env['PILOT_ADMIN_API_KEY'] = originalEnv;
    vi.restoreAllMocks();
  });

  function authHeader() {
    return { Authorization: `Bearer ${ADMIN_KEY}` };
  }

  describe('auth gate', () => {
    it('returns 503 when PILOT_ADMIN_API_KEY is unset', async () => {
      delete process.env['PILOT_ADMIN_API_KEY'];
      const { fetch } = testApp(adminRoutes);
      const res = await fetch('GET', '/tenants/deletions');
      const body = await expectJson<{ error: string }>(res, 503);
      expect(body.error).toContain('disabled');
    });

    it('returns 403 when the Bearer token is missing', async () => {
      const { fetch } = testApp(adminRoutes);
      const res = await fetch('GET', '/tenants/deletions');
      await expectJson(res, 403);
    });

    it('returns 403 when the Bearer token is wrong', async () => {
      const { fetch } = testApp(adminRoutes);
      const res = await fetch('GET', '/tenants/deletions', undefined, {
        Authorization: 'Bearer wrong',
      });
      await expectJson(res, 403);
    });
  });

  describe('POST /tenants', () => {
    it('returns 400 when name is missing', async () => {
      const { fetch } = testApp(adminRoutes);
      const res = await fetch('POST', '/tenants', { ownerUserId }, authHeader());
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('name');
    });

    it('returns 400 when ownerUserId is missing', async () => {
      const { fetch } = testApp(adminRoutes);
      const res = await fetch('POST', '/tenants', { name: 'Acme' }, authHeader());
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('ownerUserId');
    });

    it('returns 404 when the owner user does not exist', async () => {
      const deps = createMockDeps();
      deps.db._setResult([]); // owner lookup returns nothing

      const { fetch } = testApp(adminRoutes, deps);
      const res = await fetch('POST', '/tenants', { name: 'Acme', ownerUserId }, authHeader());
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('ownerUserId');
    });

    it('writes audit-linked evidence when creating a tenant', async () => {
      const { db, inserts, updates } = createTenantCreationDb();
      const deps = createMockDeps({ db: db as never });
      const { fetch } = testApp(adminRoutes, deps);

      const res = await fetch('POST', '/tenants', { name: ' Acme ', ownerUserId }, authHeader());
      const body = await expectJson<{
        workspace: { id: string; name: string; ownerId: string };
        evidenceItemId: string;
      }>(res, 201);

      expect(body.workspace).toMatchObject({ name: 'Acme', ownerId: ownerUserId });
      expect(body.evidenceItemId).toBe('evidence-admin-tenant-1');
      expect(inserts.map((insert) => insert.table)).toEqual([
        workspaces,
        workspaceMembers,
        workspaceSettings,
        auditLog,
        evidenceItems,
      ]);
      expect(inserts.find((insert) => insert.table === workspaces)?.value).toEqual({
        name: 'Acme',
        ownerId: ownerUserId,
      });
      expect(inserts.find((insert) => insert.table === workspaceMembers)?.value).toEqual({
        workspaceId: body.workspace.id,
        userId: ownerUserId,
        role: 'owner',
      });
      const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
        id: string;
      };
      expect(auditInsert).toMatchObject({
        workspaceId: body.workspace.id,
        action: 'ADMIN_TENANT_CREATED',
        actor: 'platform-admin',
        target: body.workspace.id,
        verdict: 'allow',
        metadata: {
          evidenceType: 'admin_tenant_created',
          workspaceId: body.workspace.id,
          workspaceName: 'Acme',
          ownerUserId,
          adminCredentialStoredInEvidence: false,
        },
      });
      expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
        workspaceId: body.workspace.id,
        auditEventId: auditInsert.id,
        evidenceType: 'admin_tenant_created',
        sourceType: 'gateway_admin',
        redactionState: 'redacted',
        sensitivity: 'restricted',
        metadata: {
          workspaceId: body.workspace.id,
          workspaceName: 'Acme',
          ownerUserId,
          adminCredentialStoredInEvidence: false,
        },
      });
      expect(JSON.stringify(inserts.map((insert) => insert.value))).not.toContain(ADMIN_KEY);
      expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
        metadata: {
          evidenceItemId: 'evidence-admin-tenant-1',
        },
      });
    });

    it('fails closed without committing tenant rows when evidence persistence fails', async () => {
      const { db, inserts } = createTenantCreationDb({ failEvidence: true });
      const deps = createMockDeps({ db: db as never });
      const { fetch } = testApp(adminRoutes, deps);

      const res = await fetch('POST', '/tenants', { name: 'Acme', ownerUserId }, authHeader());
      const body = await expectJson<{ error: string }>(res, 500);

      expect(body.error).toContain('failed to persist tenant creation evidence');
      expect(inserts).toEqual([]);
    });
  });

  describe('POST /tenants/:id/restore', () => {
    it('returns 404 when the workspace is not soft-deleted', async () => {
      const deps = createMockDeps();
      // Mock the delete query chain — no rows returned.
      (deps.db as { delete: typeof vi.fn }).delete = vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
      })) as never;

      const { fetch } = testApp(adminRoutes, deps);
      const res = await fetch('POST', '/tenants/ws-1/restore', undefined, authHeader());
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('not soft-deleted');
    });

    it('returns 200 when a soft-delete row was removed', async () => {
      const deps = createMockDeps();
      (deps.db as { delete: typeof vi.fn }).delete = vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 'del-1', workspaceId: 'ws-1' }]),
        })),
      })) as never;

      const { fetch } = testApp(adminRoutes, deps);
      const res = await fetch('POST', '/tenants/ws-1/restore', undefined, authHeader());
      const body = await expectJson<{ restored: boolean; workspaceId: string }>(res, 200);
      expect(body).toEqual({ restored: true, workspaceId: 'ws-1' });
    });
  });

  describe('POST /tenants/cleanup', () => {
    it('returns hardDeleted count when sweep runs clean', async () => {
      const deps = createMockDeps();
      deps.db._setResult([]); // no rows past grace window

      const { fetch } = testApp(adminRoutes, deps);
      const res = await fetch('POST', '/tenants/cleanup', undefined, authHeader());
      const body = await expectJson<{ hardDeleted: number; remaining: number }>(res, 200);
      expect(body).toEqual({ hardDeleted: 0, remaining: 0 });
    });

    it('clamps the limit to the [1, 500] range', async () => {
      const deps = createMockDeps();
      deps.db._setResult([]);

      const { fetch } = testApp(adminRoutes, deps);
      // Absurd limit should still return ok — the clamp protects the DB.
      const res = await fetch('POST', '/tenants/cleanup?limit=99999', undefined, authHeader());
      await expectJson(res, 200);
    });
  });
});

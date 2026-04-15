import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { adminRoutes } from '../../routes/admin.js';
import { testApp, createMockDeps, expectJson } from '../helpers.js';

const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

describe('adminRoutes', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['HELM_ADMIN_API_KEY'];
    process.env['HELM_ADMIN_API_KEY'] = ADMIN_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['HELM_ADMIN_API_KEY'];
    else process.env['HELM_ADMIN_API_KEY'] = originalEnv;
    vi.restoreAllMocks();
  });

  function authHeader() {
    return { Authorization: `Bearer ${ADMIN_KEY}` };
  }

  describe('auth gate', () => {
    it('returns 503 when HELM_ADMIN_API_KEY is unset', async () => {
      delete process.env['HELM_ADMIN_API_KEY'];
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
      const res = await fetch('GET', '/tenants/deletions', undefined, { Authorization: 'Bearer wrong' });
      await expectJson(res, 403);
    });
  });

  describe('POST /tenants', () => {
    it('returns 400 when name is missing', async () => {
      const { fetch } = testApp(adminRoutes);
      const res = await fetch('POST', '/tenants', { ownerUserId: '00000000-0000-4000-8000-000000000001' }, authHeader());
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
      const res = await fetch(
        'POST',
        '/tenants',
        { name: 'Acme', ownerUserId: '00000000-0000-4000-8000-000000000001' },
        authHeader(),
      );
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('ownerUserId');
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
        where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'del-1', workspaceId: 'ws-1' }]) })),
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

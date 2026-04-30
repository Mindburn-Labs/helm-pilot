import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applicationRoutes } from '../../routes/application.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

describe('applicationRoutes', () => {
  const wsHeader = { 'X-Workspace-Id': 'ws-1' };

  // ── GET / ──

  describe('GET /', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const { fetch } = testApp(applicationRoutes);
      const res = await fetch('GET', '/');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns applications for a workspace', async () => {
      const deps = createMockDeps();
      const apps = [
        { id: 'app-1', workspaceId: 'ws-1', targetProgram: 'YC', status: 'draft' },
        { id: 'app-2', workspaceId: 'ws-1', targetProgram: 'Techstars', status: 'submitted' },
      ];
      deps.db._setResult(apps);

      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('GET', '/', undefined, wsHeader);
      const body = await expectJson<unknown[]>(res, 200);
      expect(body).toEqual([
        { ...apps[0], program: 'YC' },
        { ...apps[1], program: 'Techstars' },
      ]);
    });
  });

  // ── POST / ──

  describe('POST /', () => {
    it('returns 400 when required fields are missing', async () => {
      const { fetch } = testApp(applicationRoutes);
      const res = await fetch('POST', '/', { workspaceId: 'ws-1' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('targetProgram');
    });

    it('returns 400 when only body workspaceId is provided', async () => {
      const { fetch } = testApp(applicationRoutes);
      const res = await fetch('POST', '/', { workspaceId: 'ws-1', targetProgram: 'YC' });
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns 403 when body workspaceId mismatches the bound workspace', async () => {
      const { fetch } = testApp(applicationRoutes);
      const res = await fetch('POST', '/', { workspaceId: 'ws-2', targetProgram: 'YC' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 403);
      expect(body.error).toContain('does not match');
    });

    it('creates an application and returns 201', async () => {
      const deps = createMockDeps();
      const created = {
        id: 'app-1',
        workspaceId: 'ws-1',
        targetProgram: 'YC',
        status: 'draft',
        submittedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [created]),
          then: (r: any) => r([created]),
        })),
      })) as any;

      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('POST', '/', { workspaceId: 'ws-1', targetProgram: 'YC' }, wsHeader);
      const body = await expectJson<{ id: string }>(res, 201);
      expect(body.id).toBe('app-1');
      expect(body).toHaveProperty('targetProgram', 'YC');
      expect(body).toHaveProperty('program', 'YC');
    });
  });

  // ── GET /:id ──

  describe('GET /:id', () => {
    it('returns 404 when application is not found', async () => {
      const deps = createMockDeps();
      // default result is [] so destructured [application] will be undefined
      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('GET', '/app-missing', undefined, wsHeader);
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('not found');
    });

    it('returns application with drafts and artifacts', async () => {
      const deps = createMockDeps();
      const application = {
        id: 'app-1',
        workspaceId: 'ws-1',
        targetProgram: 'YC',
        status: 'draft',
      };
      // Route does 3 sequential selects: applications, drafts, artifacts
      let selectCount = 0;
      const results: unknown[][] = [[application], [], []];
      deps.db.select = vi.fn(() => {
        const idx = selectCount;
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                then: (r: (v: unknown[]) => void) => {
                  selectCount++;
                  r(results[idx] ?? []);
                },
              })),
              then: (r: (v: unknown[]) => void) => {
                selectCount++;
                r(results[idx] ?? []);
              },
            })),
            then: (r: (v: unknown[]) => void) => {
              selectCount++;
              r(results[idx] ?? []);
            },
          })),
        };
      }) as any;

      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('GET', '/app-1', undefined, wsHeader);
      const body = await expectJson<{ id: string; drafts: unknown[]; artifacts: unknown[] }>(
        res,
        200,
      );
      expect(body.id).toBe('app-1');
      expect(body.drafts).toEqual([]);
      expect(body.artifacts).toEqual([]);
    });
  });

  // ── PUT /:id/drafts ──

  describe('PUT /:id/drafts', () => {
    it('returns 400 when section or content is missing', async () => {
      const { fetch } = testApp(applicationRoutes);
      const res = await fetch('PUT', '/app-1/drafts', { section: 'overview' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('section and content');
    });

    it('creates a new draft when none exists (201)', async () => {
      const deps = createMockDeps();
      // First query (check existing) resolves to [] (no existing draft)
      const createdDraft = {
        id: 'draft-1',
        applicationId: 'app-1',
        section: 'overview',
        content: 'Our company...',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [createdDraft]),
          then: (r: any) => r([createdDraft]),
        })),
      })) as any;
      let selectCall = 0;
      const results: unknown[][] = [[{ id: 'app-1' }], []];
      deps.db.select = vi.fn(() => {
        const idx = selectCall;
        selectCall++;
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                then: (r: (v: unknown[]) => void) => r(results[idx] ?? []),
              })),
              then: (r: (v: unknown[]) => void) => r(results[idx] ?? []),
            })),
          })),
        };
      }) as any;

      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch(
        'PUT',
        '/app-1/drafts',
        {
          section: 'overview',
          content: 'Our company...',
        },
        wsHeader,
      );
      const body = await expectJson<{ id: string }>(res, 201);
      expect(body.id).toBe('draft-1');
    });

    it('updates an existing draft (200)', async () => {
      const deps = createMockDeps();
      const existingDraft = {
        id: 'draft-1',
        applicationId: 'app-1',
        section: 'overview',
        content: 'Old content',
      };
      // First query (check existing) finds the draft
      deps.db._setResult([existingDraft]);

      const updatedDraft = {
        ...existingDraft,
        content: 'New content',
        updatedAt: new Date().toISOString(),
      };

      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [updatedDraft]),
            then: (r: any) => r([updatedDraft]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch(
        'PUT',
        '/app-1/drafts',
        {
          section: 'overview',
          content: 'New content',
        },
        wsHeader,
      );
      const body = await expectJson<{ content: string }>(res, 200);
      expect(body.content).toBe('New content');
    });
  });

  // ── PUT /:id/status ──

  describe('PUT /:id/status', () => {
    it('returns 400 for invalid status', async () => {
      const { fetch } = testApp(applicationRoutes);
      const res = await fetch('PUT', '/app-1/status', { status: 'bogus' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('Invalid status');
    });

    it('updates status and returns 200', async () => {
      const deps = createMockDeps();
      const updated = {
        id: 'app-1',
        workspaceId: 'ws-1',
        targetProgram: 'YC',
        status: 'submitted',
        submittedAt: new Date().toISOString(),
      };

      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [updated]),
            then: (r: any) => r([updated]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('PUT', '/app-1/status', { status: 'submitted' }, wsHeader);
      const body = await expectJson<{ status: string }>(res, 200);
      expect(body.status).toBe('submitted');
    });

    it('returns 404 when application does not exist', async () => {
      const deps = createMockDeps();
      // update returns [] so destructured [updated] is undefined
      deps.db.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
            then: (r: any) => r([]),
          })),
        })),
      })) as any;

      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('PUT', '/app-missing/status', { status: 'in_review' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 404);
      expect(body.error).toContain('not found');
    });

    it('returns 400 when workspaceId is missing (tenancy guard)', async () => {
      const { fetch } = testApp(applicationRoutes);
      const res = await fetch('PUT', '/app-1/status', { status: 'submitted' });
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });
  });
});

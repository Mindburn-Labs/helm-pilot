import { describe, it, expect, vi } from 'vitest';
import { applications, auditLog, evidenceItems } from '@pilot/db/schema';
import { applicationRoutes } from '../../routes/application.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

function createApplicationCreateDb(options: { failEvidence?: boolean } = {}) {
  const inserts: Array<{ table: unknown; value: unknown }> = [];
  const updates: Array<{ table: unknown; value: unknown }> = [];

  const createDbFacade = (
    insertSink: Array<{ table: unknown; value: unknown }>,
    updateSink: Array<{ table: unknown; value: unknown }>,
  ) => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          then: (resolve: (value: unknown[]) => void) => resolve([]),
        })),
        then: (resolve: (value: unknown[]) => void) => resolve([]),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: Record<string, unknown>) => {
        insertSink.push({ table, value });
        return {
          returning: vi.fn(async () => {
            if (table === applications) {
              return [
                {
                  id: 'app-1',
                  workspaceId: value['workspaceId'],
                  name: value['name'],
                  targetProgram: value['targetProgram'],
                  status: value['status'],
                  submittedAt: null,
                  createdAt: new Date('2026-01-01T00:00:00.000Z'),
                  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
                },
              ];
            }
            if (table === evidenceItems) {
              if (options.failEvidence) throw new Error('evidence unavailable');
              return [{ id: 'evidence-application-create-1' }];
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
      where: vi.fn(async () => []),
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

    it('denies members from creating applications', async () => {
      const { fetch, deps } = testApp(applicationRoutes);
      const res = await fetch(
        'POST',
        '/',
        { workspaceId: 'ws-1', targetProgram: 'YC' },
        { ...wsHeader, 'X-Workspace-Role': 'member' },
      );
      const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

      expect(body.error).toBe('insufficient workspace role');
      expect(body.requiredRole).toBe('partner');
      expect(deps.db.insert).not.toHaveBeenCalled();
    });

    it('writes audit-linked evidence when creating an application', async () => {
      const { db, inserts, updates } = createApplicationCreateDb();
      const deps = createMockDeps({ db: db as never });
      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('POST', '/', { workspaceId: 'ws-1', targetProgram: 'YC' }, wsHeader);
      const body = await expectJson<{
        id: string;
        targetProgram: string;
        program: string;
        evidenceItemId: string;
      }>(res, 201);

      expect(body.id).toBe('app-1');
      expect(body).toHaveProperty('targetProgram', 'YC');
      expect(body).toHaveProperty('program', 'YC');
      expect(body.evidenceItemId).toBe('evidence-application-create-1');
      expect(inserts.map((insert) => insert.table)).toEqual([
        applications,
        auditLog,
        evidenceItems,
      ]);
      expect(inserts.find((insert) => insert.table === applications)?.value).toMatchObject({
        workspaceId: 'ws-1',
        name: 'YC',
        targetProgram: 'YC',
        status: 'draft',
      });
      const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
        id: string;
      };
      expect(auditInsert).toMatchObject({
        workspaceId: 'ws-1',
        action: 'APPLICATION_CREATED',
        actor: 'user:user-1',
        target: 'app-1',
        verdict: 'allow',
        metadata: {
          evidenceType: 'application_created',
          replayRef: 'application:ws-1:app-1:created',
          applicationId: 'app-1',
          name: 'YC',
          targetProgram: 'YC',
          status: 'draft',
          deadlinePresent: false,
          evidenceContract: 'application_create_evidence_required',
        },
      });
      expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
        workspaceId: 'ws-1',
        auditEventId: auditInsert.id,
        evidenceType: 'application_created',
        sourceType: 'gateway_application_route',
        replayRef: 'application:ws-1:app-1:created',
        metadata: {
          applicationId: 'app-1',
          targetProgram: 'YC',
          evidenceContract: 'application_create_evidence_required',
        },
      });
      expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
        metadata: {
          evidenceItemId: 'evidence-application-create-1',
        },
      });
    });

    it('fails closed without committing application rows when evidence persistence fails', async () => {
      const { db, inserts, updates } = createApplicationCreateDb({ failEvidence: true });
      const deps = createMockDeps({ db: db as never });
      const { fetch } = testApp(applicationRoutes, deps);
      const res = await fetch('POST', '/', { workspaceId: 'ws-1', targetProgram: 'YC' }, wsHeader);
      const body = await expectJson<{ error: string }>(res, 500);

      expect(body.error).toContain('Failed to persist application evidence');
      expect(inserts).toEqual([]);
      expect(updates).toEqual([]);
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

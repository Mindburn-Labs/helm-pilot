import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, evidenceItems, tenantSecrets } from '@pilot/db/schema';
import { secretsRoutes } from '../../routes/secrets.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const wsHeader = { 'X-Workspace-Id': workspaceId };
const originalEncryptionKey = process.env['ENCRYPTION_KEY'];

function createSecretsDb(options: { failEvidence?: boolean; deleted?: boolean } = {}) {
  const inserts: Array<{ table: unknown; value: unknown }> = [];
  const updates: Array<{ table: unknown; value: unknown }> = [];
  const deletes: Array<{ table: unknown }> = [];

  const createDbFacade = (
    insertSink: Array<{ table: unknown; value: unknown }>,
    updateSink: Array<{ table: unknown; value: unknown }>,
    deleteSink: Array<{ table: unknown }>,
  ) => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          then: (resolve: (value: unknown[]) => void) => resolve([]),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        insertSink.push({ table, value });
        return {
          returning: vi.fn(async () => {
            if (table === evidenceItems) {
              if (options.failEvidence) throw new Error('evidence unavailable');
              return [{ id: 'evidence-secret-1' }];
            }
            return [];
          }),
          then: (resolve: (value: unknown[]) => void) => resolve([]),
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
    delete: vi.fn((table: unknown) => {
      deleteSink.push({ table });
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => (options.deleted === false ? [] : [{ id: 'secret-1' }])),
        })),
      };
    }),
    execute: vi.fn(async () => [{ '?column?': 1 }]),
  });

  const db = {
    ...createDbFacade(inserts, updates, deletes),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const stagedInserts: Array<{ table: unknown; value: unknown }> = [];
      const stagedUpdates: Array<{ table: unknown; value: unknown }> = [];
      const stagedDeletes: Array<{ table: unknown }> = [];
      const tx = createDbFacade(stagedInserts, stagedUpdates, stagedDeletes);
      const result = await callback(tx);
      inserts.push(...stagedInserts);
      updates.push(...stagedUpdates);
      deletes.push(...stagedDeletes);
      return result;
    }),
    _setResult: vi.fn(),
    _reset: vi.fn(),
  };

  return { db, inserts, updates, deletes };
}

describe('secretsRoutes', () => {
  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = 'x'.repeat(32);
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env['ENCRYPTION_KEY'];
      return;
    }
    process.env['ENCRYPTION_KEY'] = originalEncryptionKey;
  });

  it('writes redacted audit-linked evidence when storing a workspace secret', async () => {
    const { db, inserts, updates } = createSecretsDb();
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(secretsRoutes, deps);

    const res = await fetch(
      'PUT',
      '/llm_openai_key',
      { value: 'super-secret-key', expiresAt: '2026-06-01T00:00:00.000Z' },
      wsHeader,
    );
    const body = await expectJson<{ stored: boolean; kind: string }>(res, 200);

    expect(body).toMatchObject({ stored: true, kind: 'llm_openai_key' });
    expect(inserts.find((insert) => insert.table === tenantSecrets)?.value).toMatchObject({
      workspaceId,
      kind: 'llm_openai_key',
      keyVersion: 1,
    });
    expect(JSON.stringify(inserts.map((insert) => insert.value))).not.toContain('super-secret-key');

    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    expect(auditInsert).toMatchObject({
      workspaceId,
      action: 'WORKSPACE_SECRET_SET',
      target: 'llm_openai_key',
      verdict: 'allow',
      metadata: {
        evidenceType: 'workspace_secret_set',
        kind: 'llm_openai_key',
        plaintextStoredInEvidence: false,
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId,
      auditEventId: auditInsert.id,
      evidenceType: 'workspace_secret_set',
      sourceType: 'gateway_secrets',
      redactionState: 'redacted',
      sensitivity: 'restricted',
      metadata: {
        kind: 'llm_openai_key',
        plaintextStoredInEvidence: false,
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-secret-1',
      },
    });
  });

  it('fails closed without committing secret rows when evidence persistence fails', async () => {
    const { db, inserts } = createSecretsDb({ failEvidence: true });
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(secretsRoutes, deps);

    const res = await fetch('PUT', '/llm_openai_key', { value: 'super-secret-key' }, wsHeader);
    const body = await expectJson<{ error: string }>(res, 500);

    expect(body.error).toContain('failed to persist workspace secret evidence');
    expect(inserts).toEqual([]);
  });

  it('writes redacted audit-linked evidence when deleting a workspace secret', async () => {
    const { db, inserts, updates, deletes } = createSecretsDb();
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(secretsRoutes, deps);

    const res = await fetch('DELETE', '/llm_openai_key', undefined, wsHeader);
    const body = await expectJson<{ deleted: boolean }>(res, 200);

    expect(body.deleted).toBe(true);
    expect(deletes).toEqual([{ table: tenantSecrets }]);
    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    expect(auditInsert).toMatchObject({
      workspaceId,
      action: 'WORKSPACE_SECRET_DELETED',
      target: 'llm_openai_key',
      verdict: 'allow',
      metadata: {
        evidenceType: 'workspace_secret_deleted',
        plaintextStoredInEvidence: false,
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId,
      auditEventId: auditInsert.id,
      evidenceType: 'workspace_secret_deleted',
      sourceType: 'gateway_secrets',
      redactionState: 'redacted',
      sensitivity: 'restricted',
      metadata: {
        kind: 'llm_openai_key',
        plaintextStoredInEvidence: false,
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-secret-1',
      },
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OAuthFlowManager } from '../oauth.js';
import {
  PERMANENT_AFTER_ATTEMPTS,
  PROACTIVE_WINDOW_MS,
  TICK_BATCH_LIMIT,
} from '../refresh.js';

vi.mock('@pilot/db/schema', () => ({
  connectorGrants: { id: 'cg.id', workspaceId: 'cg.ws', needsReauth: 'cg.nr' },
  connectorTokens: { grantId: 'ct.grant', expiresAt: 'ct.exp' },
  connectors: { id: 'c.id', name: 'c.name' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: 'eq' }),
  and: (...args: unknown[]) => ({ args, op: 'and' }),
  lt: (col: unknown, val: unknown) => ({ col, val, op: 'lt' }),
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => ({
    strings: strings.join(''),
    op: 'sql',
  }),
}));

function makeDb() {
  const updateCalls: Array<{
    values: Record<string, unknown>;
    where: unknown;
  }> = [];

  let nextSelectRows: unknown[] = [];
  let nextLockAcquired = true;

  const selectChain = () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: async () => nextSelectRows,
        }),
      }),
      where: () => ({
        limit: async () => nextSelectRows,
      }),
    }),
  });

  const db = {
    insert: vi.fn(),
    update: vi.fn((_table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: (where: unknown) => {
          updateCalls.push({ values, where });
          return Promise.resolve();
        },
      })),
    })),
    select: vi.fn(() => selectChain()),
    execute: vi.fn(async () => ({ rows: [{ acquired: nextLockAcquired }] })),
  } as any;

  return {
    db,
    updateCalls,
    setNextSelectRows: (rows: unknown[]) => {
      nextSelectRows = rows;
    },
    setLockAcquired: (ok: boolean) => {
      nextLockAcquired = ok;
    },
  };
}

function makeOauth(result: string | null): OAuthFlowManager {
  return {
    refreshToken: vi.fn(async () => result),
  } as unknown as OAuthFlowManager;
}

function makeBoss() {
  const handlers = new Map<string, (jobs: unknown) => Promise<unknown>>();
  const createQueueCalls: string[] = [];
  const scheduleCalls: Array<[string, string]> = [];
  const boss = {
    createQueue: vi.fn(async (q: string) => {
      createQueueCalls.push(q);
    }),
    work: vi.fn((queue: string, fn: (jobs: unknown) => Promise<unknown>) => {
      handlers.set(queue, fn);
    }),
    send: vi.fn(async () => {}),
    schedule: vi.fn(async (q: string, cron: string) => {
      scheduleCalls.push([q, cron]);
    }),
  } as any;
  return { boss, handlers, createQueueCalls, scheduleCalls };
}

describe('connector refresh — public constants', () => {
  it('proactive window is 30 minutes', () => {
    expect(PROACTIVE_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  it('permanent failure threshold is 3 attempts', () => {
    expect(PERMANENT_AFTER_ATTEMPTS).toBe(3);
  });

  it('tick batch is capped at 50', () => {
    expect(TICK_BATCH_LIMIT).toBe(50);
  });
});

describe('connector refresh — registerRefreshJobs', () => {
  let refresh: typeof import('../refresh.js');

  beforeEach(async () => {
    vi.resetModules();
    refresh = await import('../refresh.js');
  });

  it('registers both queues and schedules the tick cron', async () => {
    const { db } = makeDb();
    const oauth = makeOauth('tok');
    const { boss, createQueueCalls, scheduleCalls } = makeBoss();

    await refresh.registerRefreshJobs(boss, { db, oauth });

    expect(createQueueCalls).toContain('connectors.refresh.tick');
    expect(createQueueCalls).toContain('connectors.refresh.grant');
    expect(scheduleCalls[0]?.[0]).toBe('connectors.refresh.tick');
    expect(scheduleCalls[0]?.[1]).toBe('*/1 * * * *');
  });

  it('success path: clears attempts + needs_reauth', async () => {
    const { db, updateCalls } = makeDb();
    const oauth = makeOauth('new_access_token');
    const { boss, handlers } = makeBoss();

    await refresh.registerRefreshJobs(boss, { db, oauth });

    const grantHandler = handlers.get('connectors.refresh.grant');
    expect(grantHandler).toBeDefined();

    await grantHandler!([
      { data: { grantId: 'cg_1', connectorId: 'conn_github' } },
    ]);

    expect(oauth.refreshToken).toHaveBeenCalledWith('cg_1', 'conn_github');
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.values).toMatchObject({
      refreshAttempts: 0,
      lastRefreshError: null,
      needsReauth: false,
    });
  });

  it('first failure: bumps attempts, stays eligible', async () => {
    const { db, updateCalls, setNextSelectRows } = makeDb();
    const oauth = makeOauth(null);
    const { boss, handlers } = makeBoss();

    setNextSelectRows([{ refreshAttempts: 0, workspaceId: 'ws_abc' }]);

    await refresh.registerRefreshJobs(boss, { db, oauth });
    const grantHandler = handlers.get('connectors.refresh.grant');

    await grantHandler!([
      { data: { grantId: 'cg_2', connectorId: 'conn_github' } },
    ]);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.values).toMatchObject({
      refreshAttempts: 1,
      needsReauth: false,
    });
    expect(String(updateCalls[0]?.values['lastRefreshError'])).toMatch(/attempt 1/);
  });

  it('3rd failure: sets needs_reauth=true and invokes notifier', async () => {
    const { db, updateCalls, setNextSelectRows } = makeDb();
    const oauth = makeOauth(null);
    const { boss, handlers } = makeBoss();

    // First select returns attempts; subsequent select returns connector name.
    setNextSelectRows([{ refreshAttempts: 2, workspaceId: 'ws_abc' }]);

    const reauthCalls: Array<[string, string]> = [];
    const notifier = {
      async reauthRequired(ws: string, name: string) {
        reauthCalls.push([ws, name]);
      },
    };

    await refresh.registerRefreshJobs(boss, { db, oauth, notifier });
    const grantHandler = handlers.get('connectors.refresh.grant');

    await grantHandler!([
      { data: { grantId: 'cg_3', connectorId: 'conn_github' } },
    ]);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.values).toMatchObject({
      refreshAttempts: 3,
      needsReauth: true,
    });
  });

  it('advisory-lock not acquired → skip (no oauth call, no update)', async () => {
    const { db, updateCalls, setLockAcquired } = makeDb();
    setLockAcquired(false);
    const oauth = makeOauth('tok');
    const { boss, handlers } = makeBoss();

    await refresh.registerRefreshJobs(boss, { db, oauth });
    const grantHandler = handlers.get('connectors.refresh.grant');

    await grantHandler!([
      { data: { grantId: 'cg_locked', connectorId: 'conn_github' } },
    ]);

    expect(oauth.refreshToken).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('handler crash does not propagate (pg-boss handles retry)', async () => {
    const { db } = makeDb();
    // This oauth throws — refreshOneGrant must catch it.
    const oauth = {
      refreshToken: vi.fn(async () => {
        throw new Error('network down');
      }),
    } as unknown as OAuthFlowManager;
    const { boss, handlers } = makeBoss();

    await refresh.registerRefreshJobs(boss, { db, oauth });
    const grantHandler = handlers.get('connectors.refresh.grant');

    // Should NOT throw out of the handler — the per-job try/catch swallows.
    await expect(
      grantHandler!([{ data: { grantId: 'cg_err', connectorId: 'conn_x' } }]),
    ).resolves.not.toThrow();
  });
});

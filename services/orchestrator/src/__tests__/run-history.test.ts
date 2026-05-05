import { describe, expect, it, vi } from 'vitest';
import { loadParentRunHistory } from '../run-history.js';

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: 'and', conditions })),
  asc: vi.fn((col: unknown) => ({ op: 'asc', col })),
  eq: vi.fn((col: unknown, value: unknown) => ({ op: 'eq', col, value })),
  isNotNull: vi.fn((col: unknown) => ({ op: 'isNotNull', col })),
  isNull: vi.fn((col: unknown) => ({ op: 'isNull', col })),
}));

function makeDb(params: { taskRows: unknown[]; runRows: unknown[] }) {
  const calls = {
    taskWhere: undefined as unknown,
    runWhere: undefined as unknown,
    runOrderBy: [] as unknown[],
  };
  let selectCount = 0;
  const db = {
    select: vi.fn(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: vi.fn(() => ({
            where: vi.fn((where) => {
              calls.taskWhere = where;
              return {
                limit: vi.fn(async () => params.taskRows),
              };
            }),
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn((where) => {
            calls.runWhere = where;
            return {
              orderBy: vi.fn(async (...orderBy) => {
                calls.runOrderBy = orderBy;
                return params.runRows;
              }),
            };
          }),
        })),
      };
    }),
  };
  return { db: db as any, calls };
}

describe('loadParentRunHistory', () => {
  it('rejects cross-workspace resume history before reading task_runs', async () => {
    const { db } = makeDb({ taskRows: [], runRows: [] });

    const result = await loadParentRunHistory(db, { taskId: 'task-1', workspaceId: 'ws-a' });

    expect(result).toEqual({ taskFound: false, priorActions: [] });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('loads only parent-action rows in deterministic replay order', async () => {
    const { db, calls } = makeDb({
      taskRows: [{ id: 'task-1' }],
      runRows: [
        {
          id: 'run-1',
          actionTool: 'search',
          actionInput: { q: 'a' },
          actionHash: 'hash-1',
          actionOutput: { ok: true },
          verdict: 'allow',
          status: 'running',
          runSequence: 1,
          iterationsUsed: 3,
        },
        {
          id: 'run-2',
          actionTool: 'finish',
          actionInput: { summary: 'done' },
          actionHash: 'hash-2',
          actionOutput: null,
          verdict: null,
          status: 'awaiting_approval',
          runSequence: 2,
          iterationsUsed: 2,
        },
      ],
    });

    const result = await loadParentRunHistory(db, { taskId: 'task-1', workspaceId: 'ws-a' });

    expect(result.taskFound).toBe(true);
    expect(result.priorActions).toEqual([
      {
        tool: 'search',
        input: { q: 'a' },
        actionHash: 'hash-1',
        output: { ok: true },
        verdict: 'allow',
        iteration: 1,
        taskRunId: 'run-1',
      },
      {
        tool: 'finish',
        input: { summary: 'done' },
        actionHash: 'hash-2',
        output: null,
        verdict: 'require_approval',
        iteration: 2,
        taskRunId: 'run-2',
      },
    ]);
    expect(calls.runWhere).toEqual(
      expect.objectContaining({
        op: 'and',
        conditions: expect.arrayContaining([
          expect.objectContaining({ op: 'eq', value: 'parent_action' }),
          expect.objectContaining({ op: 'isNull' }),
          expect.objectContaining({ op: 'isNotNull' }),
        ]),
      }),
    );
    expect(calls.runOrderBy).toEqual([
      expect.objectContaining({ op: 'asc' }),
      expect.objectContaining({ op: 'asc' }),
      expect.objectContaining({ op: 'asc' }),
    ]);
  });
});

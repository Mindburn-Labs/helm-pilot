import { describe, it, expect } from 'vitest';
import { ProductFactory } from '../index.js';

// ─── Mock helpers ───

/**
 * Build a chainable mock for read queries:
 * db.select().from().where().orderBy() → results
 */
const mockSelectQuery = (results: unknown[]) => ({
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve(results),
        limit: () => Promise.resolve(results),
      }),
    }),
  }),
});

function makeService(queryResults: unknown[]) {
  const db = mockSelectQuery(queryResults) as any;
  return new ProductFactory(db);
}

// ─── Tests ───

describe('ProductFactory', () => {
  describe('listPlans', () => {
    it('returns plans for the workspace', async () => {
      const plans = [
        { id: 'p1', workspaceId: 'ws1', title: 'MVP', status: 'active', createdAt: new Date() },
        { id: 'p2', workspaceId: 'ws1', title: 'V2', status: 'draft', createdAt: new Date() },
      ];
      const svc = makeService(plans);
      const result = await svc.listPlans('ws1');
      expect(result).toEqual(plans);
    });

    it('returns empty array when no plans exist', async () => {
      const svc = makeService([]);
      const result = await svc.listPlans('ws-empty');
      expect(result).toEqual([]);
    });
  });

  describe('getPlan', () => {
    it('returns plan with milestones when found', async () => {
      const plan = { id: 'p1', title: 'MVP', status: 'active' };
      const milestones = [
        { id: 'm1', planId: 'p1', title: 'Design', sortOrder: 0 },
        { id: 'm2', planId: 'p1', title: 'Build', sortOrder: 1 },
      ];

      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                // First call: plan query with .limit(1)
                return { limit: () => Promise.resolve([plan]) };
              }
              // Second call: milestones query with .orderBy()
              return { orderBy: () => Promise.resolve(milestones) };
            },
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.getPlan('p1');
      expect(result).toEqual({ ...plan, milestones });
    });

    it('returns null when plan not found', async () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.getPlan('nonexistent');
      expect(result).toBeNull();
    });

    it('returns plan with empty milestones array', async () => {
      const plan = { id: 'p1', title: 'Empty Plan' };
      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                return { limit: () => Promise.resolve([plan]) };
              }
              return { orderBy: () => Promise.resolve([]) };
            },
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.getPlan('p1');
      expect(result).toEqual({ ...plan, milestones: [] });
    });
  });

  describe('createPlan', () => {
    it('creates and returns a new plan', async () => {
      const newPlan = { id: 'p-new', workspaceId: 'ws1', title: 'Launch Plan', description: 'Ship it' };

      const db = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([newPlan]),
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.createPlan('ws1', 'Launch Plan', 'Ship it');
      expect(result).toEqual(newPlan);
    });

    it('creates a plan without description', async () => {
      const newPlan = { id: 'p-new', workspaceId: 'ws1', title: 'Quick Plan', description: undefined };

      const db = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([newPlan]),
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.createPlan('ws1', 'Quick Plan');
      expect(result).toEqual(newPlan);
    });

    it('returns the first element from returning()', async () => {
      const plans = [
        { id: 'p1', title: 'First' },
        { id: 'p2', title: 'Second' },
      ];

      const db = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve(plans),
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.createPlan('ws1', 'First');
      // destructures [plan] so only the first element
      expect(result).toEqual({ id: 'p1', title: 'First' });
    });
  });

  describe('getWorkspaceSummary', () => {
    it('returns correct counts for a populated workspace', async () => {
      const planList = [
        { id: 'p1', workspaceId: 'ws1', status: 'active' },
        { id: 'p2', workspaceId: 'ws1', status: 'active' },
        { id: 'p3', workspaceId: 'ws1', status: 'draft' },
      ];
      const taskList = [
        { id: 't1', workspaceId: 'ws1', status: 'completed' },
        { id: 't2', workspaceId: 'ws1', status: 'running' },
        { id: 't3', workspaceId: 'ws1', status: 'running' },
        { id: 't4', workspaceId: 'ws1', status: 'pending' },
        { id: 't5', workspaceId: 'ws1', status: 'completed' },
      ];

      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) return Promise.resolve(planList);
              return Promise.resolve(taskList);
            },
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.getWorkspaceSummary('ws1');

      expect(result).toEqual({
        totalPlans: 3,
        activePlans: 2,
        totalTasks: 5,
        completedTasks: 2,
        runningTasks: 2,
      });
    });

    it('returns zeros for an empty workspace', async () => {
      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              return Promise.resolve([]);
            },
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.getWorkspaceSummary('ws-empty');

      expect(result).toEqual({
        totalPlans: 0,
        activePlans: 0,
        totalTasks: 0,
        completedTasks: 0,
        runningTasks: 0,
      });
    });

    it('counts only active plans (not draft or archived)', async () => {
      const planList = [
        { id: 'p1', status: 'draft' },
        { id: 'p2', status: 'archived' },
        { id: 'p3', status: 'active' },
      ];

      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) return Promise.resolve(planList);
              return Promise.resolve([]);
            },
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.getWorkspaceSummary('ws1');

      expect(result.totalPlans).toBe(3);
      expect(result.activePlans).toBe(1);
    });

    it('counts running and completed tasks separately', async () => {
      const taskList = [
        { id: 't1', status: 'completed' },
        { id: 't2', status: 'completed' },
        { id: 't3', status: 'completed' },
        { id: 't4', status: 'running' },
        { id: 't5', status: 'failed' },
      ];

      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) return Promise.resolve([]);
              return Promise.resolve(taskList);
            },
          }),
        }),
      } as any;

      const svc = new ProductFactory(db);
      const result = await svc.getWorkspaceSummary('ws1');

      expect(result.totalTasks).toBe(5);
      expect(result.completedTasks).toBe(3);
      expect(result.runningTasks).toBe(1);
    });
  });
});

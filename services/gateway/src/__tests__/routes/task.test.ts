import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskRoutes } from '../../routes/task.js';
import {
  createMockDeps,
  testApp,
  expectJson,
  mockTask,
} from '../helpers.js';

const VALID_UUID = '00000000-0000-0000-0000-000000000001';

describe('taskRoutes', () => {
  // ─── GET / ───

  describe('GET /', () => {
    it('returns 400 when workspaceId query param is missing', async () => {
      const { fetch } = testApp(taskRoutes);
      const res = await fetch('GET', '/');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns array of tasks on success', async () => {
      const { fetch, deps } = testApp(taskRoutes);
      const tasks = [mockTask(), mockTask({ id: 'task-2', title: 'Second task' })];
      deps.db._setResult(tasks);

      const res = await fetch('GET', `/?workspaceId=${VALID_UUID}`);
      const json = await expectJson<unknown[]>(res, 200);
      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(2);
    });
  });

  // ─── POST / ───

  describe('POST /', () => {
    it('returns 400 when body fails Zod validation', async () => {
      const { fetch } = testApp(taskRoutes);
      // Missing required fields
      const res = await fetch('POST', '/', { title: 'No workspace' });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Validation failed');
      expect(json).toHaveProperty('details');
    });

    it('returns 400 for invalid mode', async () => {
      const { fetch } = testApp(taskRoutes);
      const res = await fetch('POST', '/', {
        workspaceId: VALID_UUID,
        title: 'Test',
        mode: 'invalid',
      });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Validation failed');
    });

    it('returns 201 on successful creation', async () => {
      const deps = createMockDeps();
      const created = mockTask({ workspaceId: VALID_UUID, title: 'Build MVP' });
      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [created]),
          onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(async () => [created]) })),
          onConflictDoUpdate: vi.fn(() => ({ returning: vi.fn(async () => [created]) })),
          then: (r: any) => r([created]),
        })),
      })) as any;

      const { fetch } = testApp(taskRoutes, deps as any);
      const res = await fetch('POST', '/', {
        workspaceId: VALID_UUID,
        title: 'Build MVP',
        mode: 'build',
      });
      const json = await expectJson<{ id: string; title: string }>(res, 201);
      expect(json.id).toBe('task-1');
      expect(json.title).toBe('Build MVP');
    });

    it('calls orchestrator.runTask when autoRun is true', async () => {
      const deps = createMockDeps();
      const created = mockTask({ workspaceId: VALID_UUID, title: 'Auto task' });

      // Mock insert to return the task for both insert calls (task + taskRun)
      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [created]),
          onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(async () => [created]) })),
          onConflictDoUpdate: vi.fn(() => ({ returning: vi.fn(async () => [created]) })),
          then: (r: any) => r([created]),
        })),
      })) as any;

      const { fetch } = testApp(taskRoutes, deps as any);
      const res = await fetch('POST', '/', {
        workspaceId: VALID_UUID,
        title: 'Auto task',
        mode: 'discover',
        autoRun: true,
      });
      await expectJson(res, 201);
      expect(deps.orchestrator.runTask).toHaveBeenCalledTimes(1);
      expect(deps.orchestrator.runTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1', workspaceId: VALID_UUID }),
      );
    });
  });

  // ─── GET /:id/runs ───

  describe('GET /:id/runs', () => {
    it('returns array of runs', async () => {
      const { fetch, deps } = testApp(taskRoutes);
      const runs = [
        { id: 'run-1', taskId: 'task-1', status: 'completed', iterationsUsed: 3, iterationBudget: 50 },
      ];
      deps.db._setResult(runs);

      const res = await fetch('GET', '/task-1/runs');
      const json = await expectJson<unknown[]>(res, 200);
      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(1);
    });

    it('returns empty array when no runs exist', async () => {
      const { fetch } = testApp(taskRoutes);
      // Default mock returns []
      const res = await fetch('GET', '/task-1/runs');
      const json = await expectJson<unknown[]>(res, 200);
      expect(json).toEqual([]);
    });
  });
});

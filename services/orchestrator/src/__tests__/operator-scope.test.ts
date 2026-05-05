import { describe, expect, it, vi } from 'vitest';
import type { PolicyConfig } from '@pilot/shared/schemas';
import { Orchestrator } from '../index.js';

function makePolicy(): PolicyConfig {
  return {
    killSwitch: false,
    budget: {
      dailyTotalMax: 500,
      perTaskMax: 100,
      perOperatorMax: 200,
      emergencyKill: 1500,
      currency: 'EUR',
    },
    toolBlocklist: [],
    contentBans: [],
    connectorAllowlist: [],
    requireApprovalFor: [],
    failClosed: true,
  };
}

function makeDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => queue.shift() ?? []),
        })),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
  } as any;
}

describe('Orchestrator operator scoping', () => {
  it('rejects operatorId that is not owned by the workspace before agent execution', async () => {
    const db = makeDb([
      [{ currentMode: 'build' }],
      [],
      [],
    ]);
    const orchestrator = new Orchestrator({
      db,
      policy: makePolicy(),
    });

    await expect(
      orchestrator.runTask({
        taskId: 'task-1',
        workspaceId: 'ws-1',
        operatorId: 'op-foreign',
        context: 'do work',
      }),
    ).rejects.toThrow(/operatorId does not belong to workspace/u);
  });
});

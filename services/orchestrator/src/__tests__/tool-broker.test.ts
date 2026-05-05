import { describe, expect, it, vi } from 'vitest';
import { actions, auditLog, toolExecutions } from '@pilot/db/schema';
import { ToolBroker } from '../tool-broker.js';
import { ToolRegistry } from '../tools.js';

function createBrokerDb() {
  const insertedActions: unknown[] = [];
  const insertedExecutions: unknown[] = [];
  const insertedAudit: unknown[] = [];
  const updates: unknown[] = [];

  const db = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        if (table === actions) {
          insertedActions.push(value);
          return { returning: vi.fn(async () => [{ id: 'action-1' }]) };
        }
        if (table === toolExecutions) {
          insertedExecutions.push(value);
          return { returning: vi.fn(async () => [{ id: 'tool-exec-1' }]) };
        }
        if (table === auditLog) {
          insertedAudit.push(value);
          return Promise.resolve([]);
        }
        return { returning: vi.fn(async () => []) };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((value: unknown) => {
        updates.push({ table, value });
        return { where: vi.fn(async () => []) };
      }),
    })),
  };

  return { db, insertedActions, insertedExecutions, insertedAudit, updates };
}

describe('ToolBroker', () => {
  it('persists action, tool execution, hashes, idempotency, policy, and audit rows', async () => {
    const { db, insertedActions, insertedExecutions, insertedAudit, updates } = createBrokerDb();
    const registry = new ToolRegistry(db as never, undefined, { skipBuiltins: true });
    registry.register({
      name: 'echo_tool',
      description: 'Echo a value',
      manifest: {
        key: 'echo_tool',
        version: 'test:v1',
        riskClass: 'low',
        effectLevel: 'E1',
        requiredEvidence: ['tool_result'],
        permissionRequirements: ['tool:echo_tool:execute'],
        outputSensitivity: 'internal',
      },
      execute: async (input) => ({ received: input }),
    });
    const broker = new ToolBroker(db as never);

    const result = await broker.execute(
      registry,
      'echo_tool',
      { value: 42 },
      {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        taskId: '00000000-0000-4000-8000-000000000002',
        operatorId: '00000000-0000-4000-8000-000000000003',
        policyDecisionId: 'dec-1',
        policyVersion: 'founder-ops-v1',
        actionHash: 'sha256:action',
      },
    );

    expect(result).toMatchObject({
      actionId: 'action-1',
      toolExecutionId: 'tool-exec-1',
      status: 'completed',
    });
    expect(result.inputHash).toMatch(/^sha256:/u);
    expect(result.outputHash).toMatch(/^sha256:/u);
    expect(result.output).toMatchObject({
      received: {
        value: 42,
        workspaceId: '00000000-0000-4000-8000-000000000001',
        taskId: '00000000-0000-4000-8000-000000000002',
        operatorId: '00000000-0000-4000-8000-000000000003',
        policyDecisionId: 'dec-1',
      },
    });
    expect(insertedActions[0]).toMatchObject({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      actionKey: 'echo_tool',
      policyDecisionId: 'dec-1',
      policyVersion: 'founder-ops-v1',
      inputHash: result.inputHash,
    });
    expect(insertedExecutions[0]).toMatchObject({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      actionId: 'action-1',
      toolKey: 'echo_tool',
      status: 'running',
      inputHash: result.inputHash,
      sanitizedInput: { value: 42 },
      policyDecisionId: 'dec-1',
      policyVersion: 'founder-ops-v1',
    });
    expect((insertedExecutions[0] as { idempotencyKey: string }).idempotencyKey).toContain(
      'tool-broker-v1:00000000-0000-4000-8000-000000000001',
    );
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: toolExecutions,
          value: expect.objectContaining({
            status: 'completed',
            outputHash: result.outputHash,
            completedAt: expect.any(Date),
          }),
        }),
        expect.objectContaining({
          table: actions,
          value: expect.objectContaining({
            status: 'completed',
            outputHash: result.outputHash,
            completedAt: expect.any(Date),
          }),
        }),
      ]),
    );
    expect(insertedAudit[0]).toMatchObject({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      action: 'TOOL_EXECUTION',
      target: 'echo_tool',
      verdict: 'allow',
    });
  });

  it('fails closed before tool execution when action persistence fails', async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(async () => []) })),
      })),
      update: vi.fn(),
    };
    const registry = new ToolRegistry(db as never, undefined, { skipBuiltins: true });
    const execute = vi.fn(async () => ({ ok: true }));
    registry.register({
      name: 'side_effect_tool',
      description: 'Should not execute without ledger persistence',
      execute,
    });
    const broker = new ToolBroker(db as never);

    await expect(
      broker.execute(
        registry,
        'side_effect_tool',
        {},
        {
          workspaceId: '00000000-0000-4000-8000-000000000001',
          taskId: '00000000-0000-4000-8000-000000000002',
        },
      ),
    ).rejects.toThrow('Tool Broker could not persist action');
    expect(execute).not.toHaveBeenCalled();
  });
});

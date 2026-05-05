import { describe, expect, it, vi } from 'vitest';
import { actions, auditLog, evidenceItems, toolExecutions } from '@pilot/db/schema';
import { ToolBroker } from '../tool-broker.js';
import { ToolRegistry } from '../tools.js';

function createBrokerDb() {
  const insertedActions: unknown[] = [];
  const insertedExecutions: unknown[] = [];
  const insertedEvidenceItems: unknown[] = [];
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
        if (table === evidenceItems) {
          insertedEvidenceItems.push(value);
          return { returning: vi.fn(async () => [{ id: 'evidence-item-1' }]) };
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

  return { db, insertedActions, insertedExecutions, insertedEvidenceItems, insertedAudit, updates };
}

describe('ToolBroker', () => {
  it('persists action, tool execution, hashes, idempotency, policy, and audit rows', async () => {
    const { db, insertedActions, insertedExecutions, insertedEvidenceItems, insertedAudit, updates } =
      createBrokerDb();
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
      execute: async (input) => ({
        received: input,
        governance: { evidencePackId: '00000000-0000-4000-8000-000000000004' },
      }),
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
      evidenceItemId: 'evidence-item-1',
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
            evidenceIds: ['00000000-0000-4000-8000-000000000004'],
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
      metadata: expect.objectContaining({
        evidenceItemId: 'evidence-item-1',
        toolExecutionId: 'tool-exec-1',
      }),
    });
    expect(insertedEvidenceItems[0]).toMatchObject({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      taskId: '00000000-0000-4000-8000-000000000002',
      actionId: 'action-1',
      toolExecutionId: 'tool-exec-1',
      evidenceType: 'tool_execution_completed',
      sourceType: 'tool_broker',
      redactionState: 'redacted',
      sensitivity: 'internal',
      contentHash: result.outputHash,
      replayRef: 'tool:tool-exec-1',
      metadata: expect.objectContaining({
        broker: 'tool_broker_v1',
        toolKey: 'echo_tool',
        actionId: 'action-1',
        toolExecutionId: 'tool-exec-1',
        status: 'completed',
        riskClass: 'low',
        effectLevel: 'E1',
        manifestVersion: 'test:v1',
        inputHash: result.inputHash,
        outputHash: result.outputHash,
        evidenceIds: ['00000000-0000-4000-8000-000000000004'],
        policyDecisionId: 'dec-1',
        policyVersion: 'founder-ops-v1',
        credentialBoundary: 'sanitized_input_output_only',
      }),
    });
  });

  it('records failed tool result evidence before audit', async () => {
    const { db, insertedEvidenceItems, insertedAudit } = createBrokerDb();
    const registry = new ToolRegistry(db as never, undefined, { skipBuiltins: true });
    registry.register({
      name: 'failing_tool',
      description: 'Return a structured tool failure',
      manifest: {
        key: 'failing_tool',
        version: 'test:v1',
        riskClass: 'medium',
        effectLevel: 'E2',
        requiredEvidence: ['tool_result'],
        permissionRequirements: ['tool:failing_tool:execute'],
        outputSensitivity: 'sensitive',
      },
      execute: async () => ({ error: 'blocked by external service' }),
    });
    const broker = new ToolBroker(db as never);

    const result = await broker.execute(registry, 'failing_tool', {}, {
      workspaceId: '00000000-0000-4000-8000-000000000001',
      taskId: '00000000-0000-4000-8000-000000000002',
      policyDecisionId: 'dec-1',
      policyVersion: 'founder-ops-v1',
    });

    expect(result).toMatchObject({
      status: 'failed',
      evidenceItemId: 'evidence-item-1',
    });
    expect(insertedEvidenceItems[0]).toMatchObject({
      evidenceType: 'tool_execution_failed',
      sourceType: 'tool_broker',
      sensitivity: 'sensitive',
      metadata: expect.objectContaining({
        toolKey: 'failing_tool',
        status: 'failed',
        riskClass: 'medium',
        policyDecisionId: 'dec-1',
        policyVersion: 'founder-ops-v1',
      }),
    });
    expect(insertedAudit[0]).toMatchObject({
      verdict: 'error',
      reason: JSON.stringify({ error: 'blocked by external service' }),
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

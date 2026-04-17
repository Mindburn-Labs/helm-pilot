import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Conductor, type ParentContext } from '../conductor.js';
import { ToolRegistry } from '../tools.js';
import type { PolicyConfig } from '@helm-pilot/shared/schemas';
import type { LlmProvider } from '@helm-pilot/shared/llm';
import {
  SubagentRegistry,
  type SubagentDefinition,
} from '@helm-pilot/shared/subagents';

vi.mock('@helm-pilot/db/schema', () => ({
  taskRuns: 'taskRuns',
  evidencePacks: 'evidencePacks',
  approvals: 'approvals',
  operatorMemory: 'operatorMemory',
}));

vi.mock('@helm-pilot/shared/schemas', async () => {
  const actual = await vi.importActual<typeof import('@helm-pilot/shared/schemas')>(
    '@helm-pilot/shared/schemas',
  );
  return { ...actual, MAX_ITERATION_BUDGET: 200 };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: 'eq' }),
  and: (...args: unknown[]) => ({ args, op: 'and' }),
  desc: (col: unknown) => ({ col, op: 'desc' }),
}));

function makeDef(overrides: Partial<SubagentDefinition> = {}): SubagentDefinition {
  return {
    name: 'scout_x',
    description: 'Scout X',
    version: '1.0.0',
    operatorRole: 'growth',
    maxRiskClass: 'R1',
    budgetWeight: 1,
    execution: 'AUTONOMOUS',
    toolScope: { allowedTools: ['search_knowledge'] },
    mcpServers: [],
    iterationBudget: 20,
    systemPrompt: 'You are scout X.',
    sourcePath: '/tmp/scout_x.md',
    ...overrides,
  };
}

function makeMockDb() {
  let autoId = 0;
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: `row_${++autoId}` }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  } as any;
}

function makePolicy(): PolicyConfig {
  return {
    killSwitch: false,
    budget: {
      dailyTotalMax: 500,
      perTaskMax: 100,
      perOperatorMax: 200,
      emergencyKill: 1000,
      currency: 'EUR',
    },
    toolBlocklist: [],
    contentBans: [],
    connectorAllowlist: [],
    requireApprovalFor: ['gmail_send'],
    failClosed: true,
  };
}

function makeLlm(): LlmProvider {
  return {
    complete: vi.fn(async () =>
      JSON.stringify({ tool: 'finish', input: { summary: 'child done' } }),
    ),
  } as unknown as LlmProvider;
}

const baseCtx: ParentContext = {
  workspaceId: 'ws-1',
  taskId: 't-1',
  parentTaskRunId: 'tr-parent',
  operatorRole: 'conductor',
  policyVersion: 'founder-ops-v1',
  remainingBudgetUsd: 5,
};

describe('Conductor.spawn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails fast with a clear message when the subagent name is unknown', async () => {
    const registry = new SubagentRegistry([makeDef({ name: 'known_one' })]);
    const tools = new ToolRegistry(makeMockDb());
    const conductor = new Conductor(makeMockDb(), registry, tools, makePolicy(), makeLlm());

    const result = await conductor.spawn(baseCtx, { name: 'ghost', task: 'x' });
    expect(result.verdict).toBe('failed');
    expect(result.error).toBe('subagent_not_found');
    expect(result.summary).toContain('known_one');
  });

  it('runs the subagent loop end-to-end with a finish signal', async () => {
    const def = makeDef({ name: 'scout_x' });
    const registry = new SubagentRegistry([def]);
    const db = makeMockDb();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(db, registry, tools, makePolicy(), makeLlm());

    const result = await conductor.spawn(baseCtx, {
      name: 'scout_x',
      task: 'scan market',
    });

    expect(result.verdict).toBe('completed');
    expect(result.summary).toContain('child done');
    expect(result.name).toBe('scout_x');
  });

  it('writes a SUBAGENT_SPAWN evidence pack row during spawn', async () => {
    const def = makeDef();
    const registry = new SubagentRegistry([def]);
    const db = makeMockDb();
    const insertSpy = db.insert;
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(db, registry, tools, makePolicy(), makeLlm());

    await conductor.spawn(baseCtx, { name: 'scout_x', task: 'x' });

    // Every insert call's .values(row) is mocked; collect the row payloads.
    const valuesPayloads: Record<string, unknown>[] = [];
    for (const result of insertSpy.mock.results) {
      const chain = result.value as { values: ReturnType<typeof vi.fn> };
      for (const valCall of chain.values.mock.calls) {
        valuesPayloads.push(valCall[0] as Record<string, unknown>);
      }
    }

    const spawnPack = valuesPayloads.find((p) => p['action'] === 'SUBAGENT_SPAWN');
    expect(spawnPack).toBeDefined();
    expect(spawnPack?.['resource']).toBe('scout_x');
    expect(spawnPack?.['verdict']).toBe('ALLOW');
    expect(String(spawnPack?.['principal'])).toContain('subagent:scout_x:');
  });
});

describe('Conductor.parallel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches multiple spawns concurrently and returns one result per request', async () => {
    const registry = new SubagentRegistry([
      makeDef({ name: 'a' }),
      makeDef({ name: 'b' }),
      makeDef({ name: 'c' }),
    ]);
    const db = makeMockDb();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(db, registry, tools, makePolicy(), makeLlm());

    const results = await conductor.parallel(baseCtx, [
      { name: 'a', task: 'x' },
      { name: 'b', task: 'y' },
      { name: 'c', task: 'z' },
    ]);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.name).sort()).toEqual(['a', 'b', 'c']);
    expect(results.every((r) => r.verdict === 'completed')).toBe(true);
  });

  it('fails the whole batch when any requested subagent is unknown', async () => {
    const registry = new SubagentRegistry([makeDef({ name: 'a' })]);
    const db = makeMockDb();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(db, registry, tools, makePolicy(), makeLlm());

    const results = await conductor.parallel(baseCtx, [
      { name: 'a', task: 'x' },
      { name: 'ghost', task: 'y' },
    ]);

    expect(results.some((r) => r.verdict === 'failed')).toBe(true);
    expect(results.find((r) => r.verdict === 'failed')?.error).toBe(
      'subagent_not_found',
    );
  });

  it('concurrent spawns of the same subagent get distinct principal suffixes', async () => {
    const registry = new SubagentRegistry([makeDef({ name: 'twin' })]);
    const db = makeMockDb();
    const insertSpy = db.insert;
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(db, registry, tools, makePolicy(), makeLlm());

    await conductor.parallel(baseCtx, [
      { name: 'twin', task: 'x' },
      { name: 'twin', task: 'y' },
    ]);

    const principals: string[] = [];
    for (const result of insertSpy.mock.results) {
      const chain = result.value as { values: ReturnType<typeof vi.fn> };
      for (const valCall of chain.values.mock.calls) {
        const row = valCall[0] as Record<string, unknown>;
        if (row['action'] === 'SUBAGENT_SPAWN') {
          principals.push(String(row['principal']));
        }
      }
    }
    expect(principals).toHaveLength(2);
    expect(principals[0]).not.toBe(principals[1]);
  });
});

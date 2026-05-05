import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Conductor, type ParentContext } from '../conductor.js';
import { ToolRegistry } from '../tools.js';
import type { PolicyConfig } from '@pilot/shared/schemas';
import type { LlmProvider } from '@pilot/shared/llm';
import { SubagentRegistry, type SubagentDefinition } from '@pilot/shared/subagents';
import { SkillRegistry, type SkillDefinition } from '@pilot/shared/skills';

vi.mock('@pilot/db/schema', () => ({
  taskRuns: 'taskRuns',
  evidencePacks: 'evidencePacks',
  agentHandoffs: 'agentHandoffs',
  approvals: 'approvals',
  operatorMemory: 'operatorMemory',
}));

vi.mock('@pilot/shared/schemas', async () => {
  const actual =
    await vi.importActual<typeof import('@pilot/shared/schemas')>('@pilot/shared/schemas');
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
    skills: [],
    mcpServers: [],
    iterationBudget: 20,
    systemPrompt: 'You are scout X.',
    sourcePath: '/tmp/scout_x.md',
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'test-skill',
    description: 'Test skill',
    version: '1.0.0',
    tools: ['search_knowledge'],
    riskProfile: 'R1',
    permissionRequirements: ['knowledge.read'],
    evalStatus: 'not_evaluated',
    activation: 'auto',
    body: 'Use the test skill.',
    sourcePath: '/tmp/test-skill/SKILL.md',
    ...overrides,
  };
}

function makeMockDb(options: { failInsertTable?: unknown } = {}) {
  let autoId = 0;
  return {
    insert: vi.fn((table: unknown) => {
      if (table === options.failInsertTable) {
        throw new Error(`insert failed for ${String(table)}`);
      }
      return {
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: `row_${++autoId}` }]),
        })),
      };
    }),
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

    const spawnRun = valuesPayloads.find((p) => p['actionTool'] === 'subagent.spawn');
    expect(spawnRun).toEqual(
      expect.objectContaining({
        parentTaskRunId: 'tr-parent',
        rootTaskRunId: 'tr-parent',
        spawnedByActionId: 'tr-parent',
        lineageKind: 'subagent_spawn',
      }),
    );
  });

  it('loads explicit skill bodies into the child prompt and records metadata', async () => {
    const skill = makeSkill({
      name: 'yc-application-writing',
      tools: ['search_knowledge'],
      body: 'Use YC voice and never invent traction.',
    });
    const registry = new SubagentRegistry([
      makeDef({
        name: 'application_writer',
        skills: ['yc-application-writing'],
        toolScope: { allowedTools: ['search_knowledge'] },
      }),
    ]);
    const skillRegistry = new SkillRegistry([skill]);
    const db = makeMockDb();
    const insertSpy = db.insert;
    const llm = makeLlm();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(
      db,
      registry,
      tools,
      makePolicy(),
      llm,
      undefined,
      skillRegistry,
    );

    await conductor.spawn(baseCtx, {
      name: 'application_writer',
      task: 'Draft YC application sections',
    });

    expect(llm.complete).toHaveBeenCalledWith(expect.stringContaining('Use YC voice'));

    const valuesPayloads: Record<string, unknown>[] = [];
    for (const result of insertSpy.mock.results) {
      const chain = result.value as { values: ReturnType<typeof vi.fn> };
      for (const valCall of chain.values.mock.calls) {
        valuesPayloads.push(valCall[0] as Record<string, unknown>);
      }
    }
    const spawnRun = valuesPayloads.find((p) => p['actionTool'] === 'subagent.spawn');
    expect(spawnRun?.['skillInvocations']).toEqual([
      expect.objectContaining({
        name: 'yc-application-writing',
        version: '1.0.0',
        riskProfile: 'R1',
        evalStatus: 'not_evaluated',
        declaredTools: ['search_knowledge'],
      }),
    ]);

    const handoff = valuesPayloads.find((p) => p['handoffKind'] === 'subagent_spawn');
    expect(handoff?.['skillInvocations']).toEqual(spawnRun?.['skillInvocations']);
  });

  it('fails closed when an explicit skill is not loaded', async () => {
    const registry = new SubagentRegistry([
      makeDef({ name: 'application_writer', skills: ['missing-skill'] }),
    ]);
    const db = makeMockDb();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(
      db,
      registry,
      tools,
      makePolicy(),
      makeLlm(),
      undefined,
      new SkillRegistry([]),
    );

    const result = await conductor.spawn(baseCtx, {
      name: 'application_writer',
      task: 'Draft YC application sections',
    });

    expect(result.verdict).toBe('failed');
    expect(result.error).toBe('skill_not_loaded');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('fails closed when a matched skill requires tools outside subagent scope', async () => {
    const skill = makeSkill({
      name: 'yc-application-writing',
      tools: ['create_application_draft'],
    });
    const registry = new SubagentRegistry([
      makeDef({
        name: 'application_writer',
        skills: ['yc-application-writing'],
        toolScope: { allowedTools: ['search_knowledge'] },
      }),
    ]);
    const db = makeMockDb();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(
      db,
      registry,
      tools,
      makePolicy(),
      makeLlm(),
      undefined,
      new SkillRegistry([skill]),
    );

    const result = await conductor.spawn(baseCtx, {
      name: 'application_writer',
      task: 'Draft YC application sections',
    });

    expect(result.verdict).toBe('failed');
    expect(result.error).toBe('skill_tool_scope_denied');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips auto-matched skills that require tools outside subagent scope', async () => {
    const skill = makeSkill({
      name: 'yc-application-writing',
      description: 'Draft YC application sections',
      tools: ['create_application_draft'],
    });
    const registry = new SubagentRegistry([
      makeDef({
        name: 'scout_x',
        toolScope: { allowedTools: ['search_knowledge'] },
      }),
    ]);
    const db = makeMockDb();
    const insertSpy = db.insert;
    const llm = makeLlm();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(
      db,
      registry,
      tools,
      makePolicy(),
      llm,
      undefined,
      new SkillRegistry([skill]),
    );

    const result = await conductor.spawn(baseCtx, {
      name: 'scout_x',
      task: 'Draft YC application sections from market research',
    });

    expect(result.verdict).toBe('completed');
    expect(llm.complete).not.toHaveBeenCalledWith(expect.stringContaining('Use the test skill'));

    const valuesPayloads: Record<string, unknown>[] = [];
    for (const insertResult of insertSpy.mock.results) {
      const chain = insertResult.value as { values: ReturnType<typeof vi.fn> };
      for (const valCall of chain.values.mock.calls) {
        valuesPayloads.push(valCall[0] as Record<string, unknown>);
      }
    }
    const spawnRun = valuesPayloads.find((p) => p['actionTool'] === 'subagent.spawn');
    expect(spawnRun?.['skillInvocations']).toEqual([]);
  });

  it('fails closed when the durable handoff row cannot be persisted', async () => {
    const registry = new SubagentRegistry([makeDef({ name: 'scout_x' })]);
    const db = makeMockDb({ failInsertTable: 'agentHandoffs' });
    const llm = makeLlm();
    const tools = new ToolRegistry(db);
    const conductor = new Conductor(db, registry, tools, makePolicy(), llm);

    const result = await conductor.spawn(baseCtx, {
      name: 'scout_x',
      task: 'scan market',
    });

    expect(result.verdict).toBe('failed');
    expect(result.error).toBe('subagent_persistence_failed');
    expect(result.summary).toContain('Failed to persist agent handoff');
    expect(llm.complete).not.toHaveBeenCalled();
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
    expect(results.find((r) => r.verdict === 'failed')?.error).toBe('subagent_not_found');
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

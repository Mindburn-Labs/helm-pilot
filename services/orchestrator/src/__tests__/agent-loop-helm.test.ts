import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../agent-loop.js';

// Include evidencePacks in the mocked schema so the governance-mirroring path
// has a handle to import.
vi.mock('@helm-pilot/db/schema', () => ({
  taskRuns: 'taskRuns',
  approvals: 'approvals',
  operatorMemory: 'operatorMemory',
  evidencePacks: 'evidencePacks',
}));

vi.mock('@helm-pilot/shared/schemas', () => ({
  MAX_ITERATION_BUDGET: 200,
}));

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

function makeMockDb() {
  const inserts: InsertCall[] = [];
  const db = {
    insert: vi.fn((table: string) => ({
      values: vi.fn((row: Record<string, unknown>) => {
        inserts.push({ table, values: row });
        return {
          returning: vi.fn(() => Promise.resolve([{ id: `row-${inserts.length}` }])),
          then: (resolve: (v: unknown[]) => void) => resolve([]),
          catch: vi.fn(),
        };
      }),
    })),
  } as unknown as {
    insert: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
  return { db, inserts };
}

const mockTrust = {
  evaluate: vi.fn(() => ({ verdict: 'allow' })),
} as any;

const mockTools = {
  execute: vi.fn(async () => ({ result: 'ok' })),
  listTools: vi.fn(() => [{ name: 'search', description: 'Search' }]),
  listToolsForMode: vi.fn(() => [{ name: 'search', description: 'Search' }]),
} as any;

function governedLlm(options: { verdict?: 'ALLOW' | 'DENY' | 'ESCALATE'; decisionId?: string } = {}) {
  const governance = {
    decisionId: options.decisionId ?? 'dec-governed-1',
    verdict: options.verdict ?? 'ALLOW',
    policyVersion: 'founder-ops-v1',
    decisionHash: 'sha256:abc',
    principal: 'workspace:ws-1/operator:engineering',
  };
  return {
    complete: vi.fn(),
    completeWithUsage: vi
      .fn()
      .mockResolvedValueOnce({
        content: '{"tool":"finish","input":{"summary":"done"}}',
        usage: { tokensIn: 10, tokensOut: 5, model: 'anthropic/claude-sonnet-4' },
        governance,
      }),
  };
}

function baseParams() {
  return {
    taskId: 'task-1',
    workspaceId: 'ws-1',
    context: 'Test task',
    iterationBudget: 50,
  };
}

describe('AgentLoop — HELM governance persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrust.evaluate.mockReturnValue({ verdict: 'allow' });
  });

  it('persists the HELM decision id + policy version onto the task_runs row', async () => {
    const { db, inserts } = makeMockDb();
    const loop = new AgentLoop(db as never, mockTrust);
    loop.setLlm(governedLlm() as never);
    loop.setTools(mockTools);

    await loop.execute(baseParams());

    const taskRunInserts = inserts.filter((i) => i.table === 'taskRuns');
    expect(taskRunInserts.length).toBeGreaterThanOrEqual(1);
    const first = taskRunInserts[0]!.values;
    expect(first.helmDecisionId).toBe('dec-governed-1');
    expect(first.helmPolicyVersion).toBe('founder-ops-v1');
  });

  it('mirrors the receipt into evidence_packs scoped to the workspace', async () => {
    const { db, inserts } = makeMockDb();
    const loop = new AgentLoop(db as never, mockTrust);
    loop.setLlm(governedLlm() as never);
    loop.setTools(mockTools);

    await loop.execute(baseParams());

    const evidenceInserts = inserts.filter((i) => i.table === 'evidencePacks');
    expect(evidenceInserts).toHaveLength(1);
    const row = evidenceInserts[0]!.values;
    expect(row.workspaceId).toBe('ws-1');
    expect(row.decisionId).toBe('dec-governed-1');
    expect(row.verdict).toBe('ALLOW');
    expect(row.policyVersion).toBe('founder-ops-v1');
    expect(row.principal).toBe('workspace:ws-1/operator:engineering');
    expect(row.action).toBe('LLM_INFERENCE');
  });

  it('does NOT emit evidence_packs rows when the LLM call had no governance', async () => {
    const { db, inserts } = makeMockDb();
    const loop = new AgentLoop(db as never, mockTrust);

    // Non-HELM LLM — only supports the old completeWithUsage without governance
    const plainLlm = {
      complete: vi.fn(),
      completeWithUsage: vi.fn().mockResolvedValue({
        content: '{"tool":"finish","input":{"summary":"done"}}',
        usage: { tokensIn: 10, tokensOut: 5, model: 'gpt-4o-mini' },
        // no governance field
      }),
    } as any;
    loop.setLlm(plainLlm);
    loop.setTools(mockTools);

    await loop.execute(baseParams());

    const evidenceInserts = inserts.filter((i) => i.table === 'evidencePacks');
    expect(evidenceInserts).toHaveLength(0);
    const taskRun = inserts.find((i) => i.table === 'taskRuns');
    expect(taskRun!.values.helmDecisionId).toBeNull();
  });
});

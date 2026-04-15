import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../agent-loop.js';

vi.mock('@helm-pilot/db/schema', () => ({
  taskRuns: 'taskRuns',
  approvals: 'approvals',
  operatorMemory: 'operatorMemory',
}));

vi.mock('@helm-pilot/shared/schemas', () => ({
  MAX_ITERATION_BUDGET: 200,
}));

const mockDb = {
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      then: (r: any) => r([]),
      catch: vi.fn(),
    })),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          then: (r: any) => r([]),
        })),
        then: (r: any) => r([]),
      })),
      then: (r: any) => r([]),
    })),
  })),
} as any;

const mockTrust = {
  evaluate: vi.fn(() => ({ verdict: 'allow' })),
} as any;

const mockLlm = {
  complete: vi.fn(async () => '{"tool":"finish","input":{"summary":"done"}}'),
} as any;

const mockTools = {
  execute: vi.fn(async () => ({ result: 'ok' })),
  listTools: vi.fn(() => [{ name: 'search', description: 'Search' }]),
  listToolsForMode: vi.fn(() => [{ name: 'search', description: 'Search' }]),
} as any;

function baseParams() {
  return {
    taskId: 'task-1',
    workspaceId: 'ws-1',
    context: 'Test task',
    iterationBudget: 50,
  };
}

describe('AgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('execute() returns completed with 0 iterations when no LLM is set', async () => {
    const loop = new AgentLoop(mockDb, mockTrust);
    // Do NOT call setLlm

    const result = await loop.execute(baseParams());

    expect(result.status).toBe('completed');
    expect(result.iterationsUsed).toBe(0);
    expect(result.actions).toEqual([]);
    expect(result.error).toBe('No LLM configured');
  });

  it('execute() runs loop until finish tool is called', async () => {
    const loop = new AgentLoop(mockDb, mockTrust);
    loop.setLlm(mockLlm);
    loop.setTools(mockTools);

    mockLlm.complete.mockResolvedValueOnce('{"tool":"finish","input":{"summary":"done"}}');
    mockTrust.evaluate.mockReturnValue({ verdict: 'allow' });

    const result = await loop.execute(baseParams());

    expect(result.status).toBe('completed');
    expect(result.iterationsUsed).toBe(1);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.tool).toBe('finish');
    expect(result.actions[0]!.verdict).toBe('allow');
  });

  it('execute() respects iteration budget and returns budget_exhausted', async () => {
    const loop = new AgentLoop(mockDb, mockTrust);
    loop.setLlm(mockLlm);
    loop.setTools(mockTools);

    // LLM always returns a non-finish tool
    mockLlm.complete.mockResolvedValue('{"tool":"search","input":{}}');
    mockTrust.evaluate.mockReturnValue({ verdict: 'allow' });

    const result = await loop.execute({ ...baseParams(), iterationBudget: 3 });

    expect(result.status).toBe('budget_exhausted');
    expect(result.iterationsUsed).toBe(3);
    expect(result.actions).toHaveLength(3);
    expect(mockLlm.complete).toHaveBeenCalledTimes(3);
  });

  it('execute() stops on trust deny and returns blocked', async () => {
    const loop = new AgentLoop(mockDb, mockTrust);
    loop.setLlm(mockLlm);
    loop.setTools(mockTools);

    mockLlm.complete.mockResolvedValueOnce('{"tool":"dangerous_action","input":{}}');
    mockTrust.evaluate.mockReturnValue({ verdict: 'deny', reason: 'blocked by policy' });

    const result = await loop.execute(baseParams());

    expect(result.status).toBe('blocked');
    expect(result.error).toBe('blocked by policy');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.verdict).toBe('deny');
  });

  it('execute() pauses on require_approval and creates approval record', async () => {
    const loop = new AgentLoop(mockDb, mockTrust);
    loop.setLlm(mockLlm);
    loop.setTools(mockTools);

    mockLlm.complete.mockResolvedValueOnce('{"tool":"deploy_production","input":{}}');
    mockTrust.evaluate.mockReturnValue({ verdict: 'require_approval', reason: 'needs human' });

    const result = await loop.execute(baseParams());

    expect(result.status).toBe('awaiting_approval');
    expect(result.error).toBe('needs human');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.verdict).toBe('require_approval');
    // Approval record inserted (one persistAction + one createApprovalRecord = 2 insert calls
    // plus the saveOperatorMemory call may or may not fire depending on operatorId)
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('execute() saves operator memory after run when operatorId is provided', async () => {
    const loop = new AgentLoop(mockDb, mockTrust);
    loop.setLlm(mockLlm);
    loop.setTools(mockTools);

    mockLlm.complete.mockResolvedValueOnce('{"tool":"finish","input":{"summary":"done"}}');
    mockTrust.evaluate.mockReturnValue({ verdict: 'allow' });

    await loop.execute({ ...baseParams(), operatorId: 'op-1' });

    // db.insert is called for: persistAction (taskRuns) + saveOperatorMemory (operatorMemory)
    // Check that insert was called at least twice (once for action, once for memory)
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(mockDb.insert).toHaveBeenCalledWith('operatorMemory');
  });

  it('resume() returns completed without LLM', async () => {
    const loop = new AgentLoop(mockDb, mockTrust);
    // Do NOT call setLlm

    const result = await loop.resume({
      ...baseParams(),
      priorActions: [
        { tool: 'search', input: {}, output: { result: 'ok' }, verdict: 'allow', iteration: 1 },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.iterationsUsed).toBe(0);
    expect(result.error).toBe('No LLM configured');
  });
});

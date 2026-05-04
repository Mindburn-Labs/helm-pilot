import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerJobHandlers } from '../jobs.js';

vi.mock('@pilot/db/schema', () => ({
  opportunities: 'opportunities',
  opportunityScores: 'opportunityScores',
  taskRuns: 'taskRuns',
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: any, val: any) => ({ col: _col, val })),
}));

vi.mock('@pilot/shared/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let mockDb: any;

function freshMockDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            then: (r: any) => r([]),
          })),
          then: (r: any) => r([]),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        then: (r: any) => r([]),
        catch: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  };
}

describe('registerJobHandlers', () => {
  const handlers = new Map<string, Function>();
  const mockBoss = {
    work: vi.fn((name: string, handler: Function) => {
      handlers.set(name, handler);
    }),
    schedule: vi.fn(),
    send: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockDb = freshMockDb();
  });

  it('registers all expected job handlers', () => {
    registerJobHandlers(mockBoss, { db: mockDb });

    const registeredNames = mockBoss.work.mock.calls.map((c: any[]) => c[0]);
    expect(registeredNames).toContain('opportunity.score');
    expect(registeredNames).toContain('knowledge.recompile');
    expect(registeredNames).toContain('task.resume');
    expect(registeredNames).toContain('pipeline.yc-scrape');
    expect(registeredNames).toContain('pipeline.ingest-knowledge');

    // Schedule called for yc-scrape
    expect(mockBoss.schedule).toHaveBeenCalledWith(
      'pipeline.yc-scrape',
      expect.any(String),
      expect.anything(),
      expect.anything(),
    );
  });

  describe('opportunity.score', () => {
    it('skips when opportunity not found', async () => {
      registerJobHandlers(mockBoss, { db: mockDb, llm: { complete: vi.fn() } as any });
      const handler = handlers.get('opportunity.score')!;

      // db.select returns empty array (opportunity not found)
      await handler([{ data: { opportunityId: 'opp-1' } }]);

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('falls back to heuristic scoring when no LLM configured', async () => {
      // Phase 3a: the job always produces a score — heuristic when no LLM.
      // This is a contract change from the pre-Phase-3a behaviour (which
      // silently no-op'd) so Discover never serves null scores.
      registerJobHandlers(mockBoss, { db: mockDb });
      const handler = handlers.get('opportunity.score')!;

      let selectCount = 0;
      mockDb.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              then: (r: any) => {
                selectCount++;
                if (selectCount === 1)
                  return r([
                    {
                      id: 'opp-1',
                      title: 'Test Opp',
                      description: 'A test',
                      source: 'hn',
                      workspaceId: null,
                    },
                  ]);
                return r([]);
              },
            })),
          })),
        })),
      }));

      await handler([{ data: { opportunityId: 'opp-1' } }]);

      // Heuristic path still inserts a row with scoringMethod='heuristic'.
      expect(mockDb.insert).toHaveBeenCalledWith('opportunityScores');
    });

    it('scores via LLM (completeWithUsage) and inserts scores', async () => {
      let selectCount = 0;
      mockDb.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              then: (r: any) => {
                selectCount++;
                if (selectCount === 1)
                  return r([
                    {
                      id: 'opp-1',
                      title: 'Test Opp',
                      description: 'A test opportunity',
                      source: 'hn',
                      workspaceId: null,
                    },
                  ]);
                return r([]);
              },
            })),
          })),
        })),
      }));

      const mockLlm = {
        complete: vi.fn(),
        completeWithUsage: vi.fn(async () => ({
          content:
            '{"overall":80,"founderFit":70,"marketSignal":75,"timing":60,"feasibility":85,"rationale":"ok"}',
          usage: { tokensIn: 100, tokensOut: 50, model: 'test' },
        })),
      } as any;

      registerJobHandlers(mockBoss, { db: mockDb, llm: mockLlm });
      const handler = handlers.get('opportunity.score')!;

      await handler([{ data: { opportunityId: 'opp-1' } }]);

      expect(mockLlm.completeWithUsage).toHaveBeenCalledOnce();
      expect(mockDb.insert).toHaveBeenCalledWith('opportunityScores');
    });
  });

  describe('knowledge.recompile', () => {
    it('calls memory.recompileTruth', async () => {
      const mockMemory = { recompileTruth: vi.fn(async () => {}) } as any;

      registerJobHandlers(mockBoss, { db: mockDb, memory: mockMemory });
      const handler = handlers.get('knowledge.recompile')!;

      await handler([{ data: { pageId: 'page-1' } }]);

      expect(mockMemory.recompileTruth).toHaveBeenCalledWith('page-1');
    });

    it('skips when memory not available', async () => {
      registerJobHandlers(mockBoss, { db: mockDb });
      const handler = handlers.get('knowledge.recompile')!;

      // Should not throw
      await expect(handler([{ data: { pageId: 'page-1' } }])).resolves.toBeUndefined();
    });
  });

  describe('task.resume', () => {
    it('calls orchestrator.resumeTask', async () => {
      const mockOrchestrator = {
        resumeTask: vi.fn(async () => ({
          status: 'completed',
          iterationsUsed: 1,
          iterationBudget: 50,
          actions: [],
        })),
      } as any;

      registerJobHandlers(mockBoss, { db: mockDb, orchestrator: mockOrchestrator });
      const handler = handlers.get('task.resume')!;

      await handler([
        { data: { taskId: 'task-1', workspaceId: 'ws-1', context: 'test' } },
      ]);

      expect(mockOrchestrator.resumeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          workspaceId: 'ws-1',
          context: 'test',
          priorActions: [],
        }),
      );
    });

    it('skips when orchestrator not available', async () => {
      registerJobHandlers(mockBoss, { db: mockDb });
      const handler = handlers.get('task.resume')!;

      // Should not throw
      await expect(
        handler([{ data: { taskId: 'task-1', workspaceId: 'ws-1', context: 'test' } }]),
      ).resolves.toBeUndefined();
    });
  });
});

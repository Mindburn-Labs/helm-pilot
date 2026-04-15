import { describe, it, expect, vi } from 'vitest';
import { DecisionCourt, VERDICT_VALUES } from '../index.js';
import type { LlmProvider, CourtParams, Verdict } from '../index.js';

// ─── Mock LLM ───

function createMockLlm(responses: Record<string, string>): LlmProvider {
  const complete = vi.fn().mockImplementation((prompt: string) => {
    if (prompt.includes('strongest possible case FOR')) {
      return Promise.resolve(responses.bull ?? 'Bull case argument');
    }
    if (prompt.includes('strongest possible case AGAINST')) {
      return Promise.resolve(responses.bear ?? 'Bear case argument');
    }
    if (prompt.includes('impartial referee')) {
      return Promise.resolve(
        responses.referee ??
          JSON.stringify({
            verdict: 'yes',
            confidence: 75,
            reasoning: 'Strong fundamentals with manageable risks',
          }),
      );
    }
    return Promise.resolve('Unknown prompt');
  });

  return {
    complete,
    completeWithUsage: vi.fn().mockResolvedValue({
      content: '',
      usage: { tokensIn: 0, tokensOut: 0, model: 'mock' },
    }),
  };
}

// ─── Fixtures ───

const SAMPLE_PARAMS: CourtParams = {
  shortlist: [
    { id: 'opp-1', title: 'AI Widget', description: 'ML-powered widget platform' },
    { id: 'opp-2', title: 'Green Energy SaaS', description: 'Carbon tracking dashboard' },
  ],
};

const SINGLE_OPP_PARAMS: CourtParams = {
  shortlist: [
    { id: 'opp-1', title: 'Solo Opportunity', description: 'A single opportunity' },
  ],
};

// ─── Tests ───

describe('DecisionCourt', () => {
  // Test 1: Completes all 5 stages
  it('completes all 5 stages with timing data', async () => {
    const llm = createMockLlm({});
    const court = new DecisionCourt(llm);

    const result = await court.runCourt(SAMPLE_PARAMS);

    const stageNames = result.stages.map((s) => s.stage);
    expect(stageNames).toEqual([
      'buildDocket',
      'researchBull',
      'researchBear',
      'referee',
      'synthesize',
    ]);
    expect(result.stages.every((s) => s.durationMs >= 0)).toBe(true);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.ranking.length).toBe(2);
  });

  // Test 2: Returns ranking sorted by confidence
  it('returns ranking sorted by verdict weight * confidence descending', async () => {
    const callCount = { referee: 0 };
    const llm = createMockLlm({});
    // Override the mock to return different confidence per opportunity
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((prompt: string) => {
      if (prompt.includes('case FOR')) return Promise.resolve('Bull argument');
      if (prompt.includes('case AGAINST')) return Promise.resolve('Bear argument');
      if (prompt.includes('impartial referee')) {
        callCount.referee++;
        // First call gets low confidence, second gets high
        const response = callCount.referee === 1
          ? { verdict: 'neutral', confidence: 30, reasoning: 'Uncertain' }
          : { verdict: 'strong_yes', confidence: 90, reasoning: 'Very promising' };
        return Promise.resolve(JSON.stringify(response));
      }
      return Promise.resolve('');
    });

    const court = new DecisionCourt(llm);
    const result = await court.runCourt(SAMPLE_PARAMS);

    expect(result.ranking[0]!.rank).toBe(1);
    expect(result.ranking[1]!.rank).toBe(2);
    // strong_yes(5)*90=450 > neutral(3)*30=90
    expect(result.ranking[0]!.confidence).toBe(90);
    expect(result.ranking[0]!.verdict).toBe('strong_yes');
    expect(result.ranking[1]!.confidence).toBe(30);
  });

  // Test 3: Handles empty shortlist
  it('handles empty shortlist gracefully', async () => {
    const llm = createMockLlm({});
    const court = new DecisionCourt(llm);

    const result = await court.runCourt({ shortlist: [] });

    expect(result.ranking).toEqual([]);
    // Only buildDocket runs — pipeline short-circuits on empty docket
    expect(result.stages.length).toBe(1);
    expect(result.stages[0]!.stage).toBe('buildDocket');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  // Test 4: Bull and bear produce distinct outputs
  it('bull and bear cases produce distinct outputs', async () => {
    const llm = createMockLlm({
      bull: 'This opportunity has massive upside potential.',
      bear: 'This opportunity faces severe market headwinds.',
    });
    const court = new DecisionCourt(llm);

    const result = await court.runCourt(SINGLE_OPP_PARAMS);

    const ranked = result.ranking[0]!;
    expect(ranked.bullCase).toBe('This opportunity has massive upside potential.');
    expect(ranked.bearCase).toBe('This opportunity faces severe market headwinds.');
    expect(ranked.bullCase).not.toBe(ranked.bearCase);
  });

  // Test 5: Graceful without LLM (heuristic verdicts)
  it('returns heuristic neutral verdicts when no LLM is provided', async () => {
    const court = new DecisionCourt(); // No LLM

    const result = await court.runCourt(SAMPLE_PARAMS);

    expect(result.ranking.length).toBe(2);
    for (const opp of result.ranking) {
      expect(opp.verdict).toBe('neutral');
      expect(opp.confidence).toBe(50);
      expect(opp.reasoning).toContain('heuristic');
      expect(opp.bullCase).toContain('heuristic bull case');
      expect(opp.bearCase).toContain('heuristic bear case');
    }
    // All 5 stages should still run
    expect(result.stages.length).toBe(5);
  });

  // Test 6: Verdict is in valid enum
  it('verdict is always a valid enum value', async () => {
    const verdictValues: readonly string[] = VERDICT_VALUES;
    const llm = createMockLlm({
      referee: JSON.stringify({
        verdict: 'strong_no',
        confidence: 85,
        reasoning: 'Too risky',
      }),
    });
    const court = new DecisionCourt(llm);

    const result = await court.runCourt(SINGLE_OPP_PARAMS);

    for (const opp of result.ranking) {
      expect(verdictValues).toContain(opp.verdict);
    }

    // Also verify that invalid verdicts get normalized to 'neutral'
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((prompt: string) => {
      if (prompt.includes('case FOR')) return Promise.resolve('Bull');
      if (prompt.includes('case AGAINST')) return Promise.resolve('Bear');
      if (prompt.includes('impartial referee')) {
        return Promise.resolve(JSON.stringify({
          verdict: 'INVALID_VALUE',
          confidence: 60,
          reasoning: 'Bad verdict',
        }));
      }
      return Promise.resolve('');
    });

    const result2 = await court.runCourt(SINGLE_OPP_PARAMS);
    expect(result2.ranking[0]!.verdict).toBe('neutral');
    expect(verdictValues).toContain(result2.ranking[0]!.verdict);
  });
});

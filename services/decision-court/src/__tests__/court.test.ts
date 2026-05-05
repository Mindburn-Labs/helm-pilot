import { describe, it, expect, vi } from 'vitest';
import { DecisionCourt, VERDICT_VALUES } from '../index.js';
import type { LlmProvider, CourtParams, Verdict } from '../index.js';

// ─── Mock LLM ───

function createMockLlm(responses: Record<string, string>): LlmProvider {
  const completeWithUsage = vi.fn().mockImplementation((prompt: string) => {
    let content = 'Unknown prompt';
    if (prompt.includes('strongest possible case FOR')) {
      content = responses.bull ?? 'Bull case argument';
    }
    if (prompt.includes('strongest possible case AGAINST')) {
      content = responses.bear ?? 'Bear case argument';
    }
    if (prompt.includes('impartial referee')) {
      content =
        responses.referee ??
        JSON.stringify({
          verdict: 'yes',
          confidence: 75,
          reasoning: 'Strong fundamentals with manageable risks',
        });
    }
    return Promise.resolve({
      content,
      usage: { tokensIn: 100, tokensOut: 40, model: 'gpt-4o-mini' },
      governance: governance(`dec-${String(completeWithUsage.mock.calls.length).padStart(2, '0')}`),
    });
  });

  return {
    complete: vi.fn(async (prompt: string) => (await completeWithUsage(prompt)).content),
    completeWithUsage,
  };
}

function governance(decisionId: string) {
  return {
    decisionId,
    verdict: 'ALLOW' as const,
    policyVersion: 'founder-ops-v1',
    principal: 'workspace:ws-1/operator:decision-court',
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
  shortlist: [{ id: 'opp-1', title: 'Solo Opportunity', description: 'A single opportunity' }],
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
    expect(result.mode).toBe('governed_llm_court');
    expect(result.status).toBe('completed');
    expect(result.productionReady).toBe(false);
    expect(result.modelCalls).toHaveLength(6);
  });

  // Test 2: Returns ranking sorted by confidence
  it('returns ranking sorted by verdict weight * confidence descending', async () => {
    const callCount = { referee: 0 };
    const llm = createMockLlm({});
    // Override the mock to return different confidence per opportunity
    const completeWithUsage = llm.completeWithUsage as ReturnType<typeof vi.fn>;
    completeWithUsage.mockImplementation((prompt: string) => {
      let content = '';
      if (prompt.includes('case FOR')) content = 'Bull argument';
      if (prompt.includes('case AGAINST')) content = 'Bear argument';
      if (prompt.includes('impartial referee')) {
        callCount.referee++;
        // First call gets low confidence, second gets high
        const response =
          callCount.referee === 1
            ? { verdict: 'neutral', confidence: 30, reasoning: 'Uncertain' }
            : { verdict: 'strong_yes', confidence: 90, reasoning: 'Very promising' };
        content = JSON.stringify(response);
      }
      return Promise.resolve({
        content,
        usage: { tokensIn: 100, tokensOut: 40, model: 'gpt-4o-mini' },
        governance: governance(`dec-sort-${completeWithUsage.mock.calls.length}`),
      });
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
    expect(llm.completeWithUsage).not.toHaveBeenCalled();
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

  // Test 5: Explicit heuristic preview
  it('returns heuristic neutral verdicts only in heuristic_preview mode', async () => {
    const court = new DecisionCourt(); // No LLM

    const result = await court.runCourt({ ...SAMPLE_PARAMS, mode: 'heuristic_preview' });

    expect(result.mode).toBe('heuristic_preview');
    expect(result.status).toBe('completed');
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
    expect(result.modelCalls).toEqual([]);
  });

  it('returns unavailable instead of fake court output when governed provider is absent', async () => {
    const court = new DecisionCourt();

    const result = await court.runCourt(SAMPLE_PARAMS);

    expect(result.mode).toBe('unavailable');
    expect(result.status).toBe('unavailable');
    expect(result.ranking).toEqual([]);
    expect(result.unavailableReason).toContain('HELM-governed LLM provider');
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
    const completeWithUsage = llm.completeWithUsage as ReturnType<typeof vi.fn>;
    completeWithUsage.mockImplementation((prompt: string) => {
      let content = '';
      if (prompt.includes('case FOR')) content = 'Bull';
      if (prompt.includes('case AGAINST')) content = 'Bear';
      if (prompt.includes('impartial referee')) {
        content = JSON.stringify({
          verdict: 'INVALID_VALUE',
          confidence: 60,
          reasoning: 'Bad verdict',
        });
      }
      return Promise.resolve({
        content,
        usage: { tokensIn: 100, tokensOut: 40, model: 'gpt-4o-mini' },
        governance: governance(`dec-invalid-${completeWithUsage.mock.calls.length}`),
      });
    });

    const result2 = await court.runCourt(SINGLE_OPP_PARAMS);
    expect(result2.ranking[0]!.verdict).toBe('neutral');
    expect(verdictValues).toContain(result2.ranking[0]!.verdict);
  });

  it('returns governance_denied when a model call lacks HELM governance metadata', async () => {
    const llm = createMockLlm({});
    (llm.completeWithUsage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: 'Ungoverned bull',
      usage: { tokensIn: 10, tokensOut: 5, model: 'gpt-4o-mini' },
    });
    const court = new DecisionCourt(llm);

    const result = await court.runCourt(SINGLE_OPP_PARAMS);

    expect(result.status).toBe('governance_denied');
    expect(result.ranking).toEqual([]);
    expect(result.modelCalls[0]).toMatchObject({
      participant: 'bull',
      status: 'governance_denied',
    });
  });

  it('does not synthesize a final recommendation when the referee fails', async () => {
    const llm = createMockLlm({ referee: 'not json' });
    const court = new DecisionCourt(llm);

    const result = await court.runCourt(SINGLE_OPP_PARAMS);

    expect(result.status).toBe('referee_failed');
    expect(result.finalRecommendation).toBeUndefined();
    expect(result.ranking).toEqual([]);
  });
});

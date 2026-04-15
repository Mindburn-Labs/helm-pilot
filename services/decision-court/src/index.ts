import type { LlmProvider } from '@helm-pilot/shared/llm';
import pino from 'pino';
import type {
  BullBearCase,
  CourtParams,
  CourtResult,
  CourtStage,
  OpportunityInput,
  OpportunityVerdict,
  RankedOpportunity,
  StageTiming,
  Verdict,
} from './types.js';

export type { LlmProvider };
export * from './types.js';

const VERDICT_WEIGHT: Record<Verdict, number> = {
  strong_yes: 5,
  yes: 4,
  neutral: 3,
  no: 2,
  strong_no: 1,
};

/**
 * DecisionCourt — 5-stage adversarial evaluation of opportunities.
 *
 *   1. buildDocket  — gather opportunity data
 *   2. researchBull — LLM argues FOR each opportunity
 *   3. researchBear — LLM argues AGAINST each opportunity
 *   4. referee      — LLM weighs both sides, produces verdict + confidence
 *   5. synthesize   — rank opportunities by verdict strength * confidence
 *
 * When no LLM is provided the court returns heuristic neutral verdicts
 * so the pipeline never blocks.
 */
export class DecisionCourt {
  private readonly log: pino.Logger;

  constructor(private readonly llm?: LlmProvider) {
    this.log = pino({ name: 'decision-court' });
  }

  async runCourt(params: CourtParams): Promise<CourtResult> {
    const t0 = Date.now();
    const stages: StageTiming[] = [];
    this.log.info({ count: params.shortlist.length }, 'court session starting');

    // Stage 1 — Build Docket
    const docket = await this.timed('buildDocket', stages, () =>
      this.buildDocket(params),
    );

    if (docket.length === 0) {
      return { ranking: [], stages, totalDurationMs: Date.now() - t0 };
    }

    // Stage 2 — Bull Research
    const bullCases = await this.timed('researchBull', stages, () =>
      this.researchBull(docket, params.systemContext),
    );

    // Stage 3 — Bear Research
    const bearCases = await this.timed('researchBear', stages, () =>
      this.researchBear(docket, params.systemContext),
    );

    // Stage 4 — Referee
    const verdicts = await this.timed('referee', stages, () =>
      this.referee(docket, bullCases, bearCases, params.systemContext),
    );

    // Stage 5 — Synthesize
    const ranking = await this.timed('synthesize', stages, () =>
      this.synthesize(verdicts, bullCases, bearCases),
    );

    return { ranking, stages, totalDurationMs: Date.now() - t0 };
  }

  // ─── Stage Implementations ───

  private buildDocket(params: CourtParams): readonly OpportunityInput[] {
    return params.shortlist;
  }

  private async researchBull(
    docket: readonly OpportunityInput[],
    systemContext?: string,
  ): Promise<readonly BullBearCase[]> {
    if (!this.llm) return docket.map((o) => heuristicCase(o.id, 'bull'));

    const results: BullBearCase[] = [];
    for (const opp of docket) {
      const prompt = buildBullPrompt(opp, systemContext);
      const response = await this.llm.complete(prompt);
      results.push({ opportunityId: opp.id, argument: response.trim() });
    }
    return results;
  }

  private async researchBear(
    docket: readonly OpportunityInput[],
    systemContext?: string,
  ): Promise<readonly BullBearCase[]> {
    if (!this.llm) return docket.map((o) => heuristicCase(o.id, 'bear'));

    const results: BullBearCase[] = [];
    for (const opp of docket) {
      const prompt = buildBearPrompt(opp, systemContext);
      const response = await this.llm.complete(prompt);
      results.push({ opportunityId: opp.id, argument: response.trim() });
    }
    return results;
  }

  private async referee(
    docket: readonly OpportunityInput[],
    bullCases: readonly BullBearCase[],
    bearCases: readonly BullBearCase[],
    systemContext?: string,
  ): Promise<readonly OpportunityVerdict[]> {
    if (!this.llm) return docket.map((o) => heuristicVerdict(o.id));

    const results: OpportunityVerdict[] = [];
    for (const opp of docket) {
      const bull = bullCases.find((c) => c.opportunityId === opp.id);
      const bear = bearCases.find((c) => c.opportunityId === opp.id);
      const prompt = buildRefereePrompt(opp, bull?.argument ?? '', bear?.argument ?? '', systemContext);
      const response = await this.llm.complete(prompt);
      results.push(parseRefereeResponse(opp.id, response));
    }
    return results;
  }

  private synthesize(
    verdicts: readonly OpportunityVerdict[],
    bullCases: readonly BullBearCase[],
    bearCases: readonly BullBearCase[],
  ): readonly RankedOpportunity[] {
    const scored = verdicts.map((v) => ({
      ...v,
      score: (VERDICT_WEIGHT[v.verdict] ?? 3) * v.confidence,
      bullCase: bullCases.find((c) => c.opportunityId === v.opportunityId)?.argument ?? '',
      bearCase: bearCases.find((c) => c.opportunityId === v.opportunityId)?.argument ?? '',
    }));

    const sorted = [...scored].sort((a, b) => b.score - a.score);

    return sorted.map((s, i) => ({
      opportunityId: s.opportunityId,
      rank: i + 1,
      verdict: s.verdict,
      confidence: s.confidence,
      reasoning: s.reasoning,
      bullCase: s.bullCase,
      bearCase: s.bearCase,
    }));
  }

  // ─── Helpers ───

  private async timed<T>(
    stage: CourtStage,
    stages: StageTiming[],
    fn: () => T | Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    const result = await fn();
    stages.push({ stage, durationMs: Date.now() - start });
    return result;
  }
}

// ─── Prompt Builders ───

function wrapContext(text: string): string {
  return `<context>\n${text}\n</context>`;
}

function buildBullPrompt(opp: OpportunityInput, systemContext?: string): string {
  const ctx = systemContext ? `\nSystem context: ${wrapContext(systemContext)}\n` : '';
  return `You are an optimistic analyst. Build the strongest possible case FOR this opportunity.${ctx}

Opportunity:
${wrapContext(`Title: ${opp.title}\nDescription: ${opp.description}`)}

Respond with a concise, compelling bull case (2-4 paragraphs). Focus on upside potential, market fit, and competitive advantages.`;
}

function buildBearPrompt(opp: OpportunityInput, systemContext?: string): string {
  const ctx = systemContext ? `\nSystem context: ${wrapContext(systemContext)}\n` : '';
  return `You are a skeptical analyst. Build the strongest possible case AGAINST this opportunity.${ctx}

Opportunity:
${wrapContext(`Title: ${opp.title}\nDescription: ${opp.description}`)}

Respond with a concise, compelling bear case (2-4 paragraphs). Focus on risks, market headwinds, and execution challenges.`;
}

function buildRefereePrompt(
  opp: OpportunityInput,
  bullCase: string,
  bearCase: string,
  systemContext?: string,
): string {
  const ctx = systemContext ? `\nSystem context: ${wrapContext(systemContext)}\n` : '';
  return `You are an impartial referee evaluating an opportunity based on bull and bear arguments.${ctx}

Opportunity:
${wrapContext(`Title: ${opp.title}\nDescription: ${opp.description}`)}

Bull Case:
${wrapContext(bullCase)}

Bear Case:
${wrapContext(bearCase)}

Weigh both arguments and produce a verdict. Respond with JSON only (no markdown, no fences):

{
  "verdict": "strong_yes|yes|neutral|no|strong_no",
  "confidence": <0-100>,
  "reasoning": "1-2 sentence explanation"
}`;
}

// ─── Response Parsing ───

function parseRefereeResponse(opportunityId: string, raw: string): OpportunityVerdict {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const verdict = normalizeVerdict(String(parsed.verdict ?? 'neutral'));
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence ?? 50)));
    const reasoning = String(parsed.reasoning ?? '');
    return { opportunityId, verdict, confidence, reasoning };
  } catch {
    return heuristicVerdict(opportunityId);
  }
}

function normalizeVerdict(raw: string): Verdict {
  const valid = new Set<string>(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']);
  return valid.has(raw) ? (raw as Verdict) : 'neutral';
}

// ─── Heuristic Fallbacks ───

function heuristicCase(opportunityId: string, side: 'bull' | 'bear'): BullBearCase {
  const argument = side === 'bull'
    ? 'No LLM available — heuristic bull case: opportunity exists and was shortlisted.'
    : 'No LLM available — heuristic bear case: insufficient data to assess risks.';
  return { opportunityId, argument };
}

function heuristicVerdict(opportunityId: string): OpportunityVerdict {
  return {
    opportunityId,
    verdict: 'neutral',
    confidence: 50,
    reasoning: 'No LLM available — heuristic neutral verdict.',
  };
}

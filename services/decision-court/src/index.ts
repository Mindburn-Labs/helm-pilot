import type { LlmProvider } from '@pilot/shared/llm';
import { computeCostUsd } from '@pilot/shared/llm/pricing';
import pino from 'pino';
import type {
  BullBearCase,
  CourtModelCall,
  CourtParams,
  CourtResult,
  CourtStatus,
  CourtStage,
  DecisionCourtMode,
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
 * Governed mode never falls back to heuristics. If a HELM-governed provider
 * is not supplied, the court reports `unavailable` rather than simulating
 * production adversarial reasoning. Heuristic output is available only through
 * explicit `heuristic_preview` mode.
 */
export class DecisionCourt {
  private readonly log: pino.Logger;
  private readonly llm?: LlmProvider;
  private readonly defaultMode: DecisionCourtMode;

  constructor(input?: LlmProvider | DecisionCourtOptions) {
    if (isLlmProvider(input)) {
      this.llm = input;
      this.defaultMode = 'governed_llm_court';
    } else {
      this.llm = input?.llm;
      this.defaultMode = input?.mode ?? (input?.llm ? 'governed_llm_court' : 'unavailable');
    }
    this.log = pino({ name: 'decision-court' });
  }

  async runCourt(params: CourtParams): Promise<CourtResult> {
    const t0 = Date.now();
    const stages: StageTiming[] = [];
    const modelCalls: CourtModelCall[] = [];
    const mode = params.mode ?? this.defaultMode;
    this.log.info({ count: params.shortlist.length }, 'court session starting');

    if (mode === 'unavailable' || (mode === 'governed_llm_court' && !this.llm)) {
      return {
        mode: 'unavailable',
        status: 'unavailable',
        productionReady: false,
        ranking: [],
        stages,
        totalDurationMs: Date.now() - t0,
        modelCalls,
        unavailableReason:
          'Decision Court governed_llm_court requires a HELM-governed LLM provider.',
      };
    }

    // Stage 1 — Build Docket
    const docket = await this.timed('buildDocket', stages, () => this.buildDocket(params));

    if (docket.length === 0) {
      return this.result({
        mode,
        status: 'completed',
        ranking: [],
        stages,
        startedAt: t0,
        modelCalls,
      });
    }

    try {
      // Stage 2 — Bull Research
      const bullCases = await this.timed('researchBull', stages, () =>
        this.researchBull(docket, params.systemContext, mode, modelCalls),
      );

      // Stage 3 — Bear Research
      const bearCases = await this.timed('researchBear', stages, () =>
        this.researchBear(docket, params.systemContext, mode, modelCalls),
      );

      // Stage 4 — Referee
      const verdicts = await this.timed('referee', stages, () =>
        this.referee(docket, bullCases, bearCases, params.systemContext, mode, modelCalls),
      );

      // Stage 5 — Synthesize
      const ranking = await this.timed('synthesize', stages, () =>
        this.synthesize(verdicts, bullCases, bearCases),
      );

      return this.result({
        mode,
        status: 'completed',
        ranking,
        stages,
        startedAt: t0,
        modelCalls,
      });
    } catch (err) {
      if (err instanceof CourtStop) {
        return this.result({
          mode,
          status: err.status,
          ranking: [],
          stages,
          startedAt: t0,
          modelCalls,
          governanceDenialReason: err.status === 'governance_denied' ? err.message : undefined,
          unavailableReason: err.status === 'unavailable' ? err.message : undefined,
        });
      }
      throw err;
    }
  }

  // ─── Stage Implementations ───

  private buildDocket(params: CourtParams): readonly OpportunityInput[] {
    return params.shortlist;
  }

  private async researchBull(
    docket: readonly OpportunityInput[],
    systemContext?: string,
    mode: DecisionCourtMode = 'heuristic_preview',
    modelCalls: CourtModelCall[] = [],
  ): Promise<readonly BullBearCase[]> {
    if (mode === 'heuristic_preview') return docket.map((o) => heuristicCase(o.id, 'bull'));

    const results: BullBearCase[] = [];
    for (const opp of docket) {
      const prompt = buildBullPrompt(opp, systemContext);
      const response = await this.completeGoverned('bull', opp.id, prompt, modelCalls);
      results.push({ opportunityId: opp.id, argument: response.trim() });
    }
    return results;
  }

  private async researchBear(
    docket: readonly OpportunityInput[],
    systemContext?: string,
    mode: DecisionCourtMode = 'heuristic_preview',
    modelCalls: CourtModelCall[] = [],
  ): Promise<readonly BullBearCase[]> {
    if (mode === 'heuristic_preview') return docket.map((o) => heuristicCase(o.id, 'bear'));

    const results: BullBearCase[] = [];
    for (const opp of docket) {
      const prompt = buildBearPrompt(opp, systemContext);
      const response = await this.completeGoverned('bear', opp.id, prompt, modelCalls);
      results.push({ opportunityId: opp.id, argument: response.trim() });
    }
    return results;
  }

  private async referee(
    docket: readonly OpportunityInput[],
    bullCases: readonly BullBearCase[],
    bearCases: readonly BullBearCase[],
    systemContext?: string,
    mode: DecisionCourtMode = 'heuristic_preview',
    modelCalls: CourtModelCall[] = [],
  ): Promise<readonly OpportunityVerdict[]> {
    if (mode === 'heuristic_preview') return docket.map((o) => heuristicVerdict(o.id));

    const results: OpportunityVerdict[] = [];
    for (const opp of docket) {
      const bull = bullCases.find((c) => c.opportunityId === opp.id);
      const bear = bearCases.find((c) => c.opportunityId === opp.id);
      const prompt = buildRefereePrompt(
        opp,
        bull?.argument ?? '',
        bear?.argument ?? '',
        systemContext,
      );
      const response = await this.completeGoverned('referee', opp.id, prompt, modelCalls);
      const parsed = parseRefereeResponse(opp.id, response, { strict: true });
      if (!parsed) {
        throw new CourtStop(
          'referee_failed',
          `Referee response for "${opp.id}" was not valid JSON.`,
        );
      }
      results.push(parsed);
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
    try {
      return await fn();
    } finally {
      stages.push({ stage, durationMs: Date.now() - start });
    }
  }

  private async completeGoverned(
    participant: CourtModelCall['participant'],
    opportunityId: string,
    prompt: string,
    modelCalls: CourtModelCall[],
  ): Promise<string> {
    if (!this.llm) {
      throw new CourtStop(
        'unavailable',
        'Decision Court governed_llm_court requires a HELM-governed LLM provider.',
      );
    }

    try {
      const result = await this.llm.completeWithUsage(prompt);
      const costUsd = computeCostUsd(
        result.usage.model,
        result.usage.tokensIn,
        result.usage.tokensOut,
      );
      if (!result.governance || result.governance.verdict !== 'ALLOW') {
        modelCalls.push(
          modelCallFromResult(participant, opportunityId, prompt, result, {
            status: 'governance_denied',
            error: 'HELM governance metadata missing or non-ALLOW for Decision Court model call.',
            costUsd,
          }),
        );
        throw new CourtStop(
          'governance_denied',
          'HELM governance metadata missing or non-ALLOW for Decision Court model call.',
        );
      }
      modelCalls.push(
        modelCallFromResult(participant, opportunityId, prompt, result, {
          status: 'completed',
          costUsd,
        }),
      );
      return result.content;
    } catch (err) {
      if (err instanceof CourtStop) throw err;
      const maybeReceipt = extractReceipt(err);
      modelCalls.push({
        participant,
        opportunityId,
        prompt,
        status: maybeReceipt ? 'governance_denied' : 'failed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        policyDecisionId: maybeReceipt?.decisionId,
        policyVersion: maybeReceipt?.policyVersion,
        receipt: maybeReceipt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new CourtStop(
        maybeReceipt ? 'governance_denied' : 'unavailable',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private result(params: {
    mode: DecisionCourtMode;
    status: CourtStatus;
    ranking: readonly RankedOpportunity[];
    stages: readonly StageTiming[];
    startedAt: number;
    modelCalls: readonly CourtModelCall[];
    unavailableReason?: string;
    governanceDenialReason?: string;
  }): CourtResult {
    return {
      mode: params.mode,
      status: params.status,
      productionReady: false,
      ranking: params.ranking,
      stages: params.stages,
      totalDurationMs: Date.now() - params.startedAt,
      modelCalls: params.modelCalls,
      finalRecommendation: params.status === 'completed' ? params.ranking[0] : undefined,
      unavailableReason: params.unavailableReason,
      governanceDenialReason: params.governanceDenialReason,
    };
  }
}

export interface DecisionCourtOptions {
  llm?: LlmProvider;
  mode?: DecisionCourtMode;
}

class CourtStop extends Error {
  constructor(
    public readonly status: CourtStatus,
    message: string,
  ) {
    super(message);
    this.name = 'CourtStop';
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

function parseRefereeResponse(
  opportunityId: string,
  raw: string,
  opts: { strict?: boolean } = {},
): OpportunityVerdict | null {
  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const verdict = normalizeVerdict(String(parsed.verdict ?? 'neutral'));
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence ?? 50)));
    const reasoning = String(parsed.reasoning ?? '');
    return { opportunityId, verdict, confidence, reasoning };
  } catch {
    if (opts.strict) return null;
    return heuristicVerdict(opportunityId);
  }
}

function normalizeVerdict(raw: string): Verdict {
  const valid = new Set<string>(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']);
  return valid.has(raw) ? (raw as Verdict) : 'neutral';
}

// ─── Heuristic Fallbacks ───

function heuristicCase(opportunityId: string, side: 'bull' | 'bear'): BullBearCase {
  const argument =
    side === 'bull'
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

function isLlmProvider(input: unknown): input is LlmProvider {
  return (
    typeof input === 'object' &&
    input !== null &&
    'completeWithUsage' in input &&
    typeof (input as { completeWithUsage?: unknown }).completeWithUsage === 'function'
  );
}

function modelCallFromResult(
  participant: CourtModelCall['participant'],
  opportunityId: string,
  prompt: string,
  result: Awaited<ReturnType<LlmProvider['completeWithUsage']>>,
  opts: {
    status: CourtModelCall['status'];
    costUsd: number;
    error?: string;
  },
): CourtModelCall {
  const receipt = result.governance
    ? {
        decisionId: result.governance.decisionId,
        verdict: result.governance.verdict,
        policyVersion: result.governance.policyVersion,
        decisionHash: result.governance.decisionHash,
        principal: result.governance.principal,
      }
    : undefined;
  return {
    participant,
    opportunityId,
    prompt,
    output: result.content,
    status: opts.status,
    model: result.usage.model,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    costUsd: opts.costUsd,
    policyDecisionId: result.governance?.decisionId,
    policyVersion: result.governance?.policyVersion,
    receipt,
    error: opts.error,
  };
}

function extractReceipt(err: unknown): CourtModelCall['receipt'] | undefined {
  if (typeof err !== 'object' || err === null || !('receipt' in err)) return undefined;
  const receipt = (err as { receipt?: Record<string, unknown> }).receipt;
  if (!receipt || typeof receipt.decisionId !== 'string') return undefined;
  return {
    decisionId: receipt.decisionId,
    verdict: typeof receipt.verdict === 'string' ? receipt.verdict : 'DENY',
    policyVersion: typeof receipt.policyVersion === 'string' ? receipt.policyVersion : 'unknown',
    decisionHash: typeof receipt.decisionHash === 'string' ? receipt.decisionHash : undefined,
    principal: typeof receipt.principal === 'string' ? receipt.principal : 'unknown',
  };
}

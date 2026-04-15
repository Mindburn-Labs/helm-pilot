import type { LlmProvider } from '../llm/index.js';
import {
  buildOpportunityScorePrompt,
  OPPORTUNITY_SCORE_PROMPT_VERSION,
  parseOpportunityScoreResponse,
  type OpportunityScoreInput,
  type OpportunityScoreOutput,
} from '../prompts/opportunity-score.v1.js';

/**
 * Opportunity scoring engine (Phase 3a).
 *
 * Produces a five-dimensional score for a given (opportunity, founderProfile)
 * pair. Uses the caller-provided LlmProvider — in production this is the
 * HELM-governed one from the orchestrator, so every score call is subject
 * to the workspace's budget + policy envelope and emits an evidence pack.
 *
 * The engine is stateless: it takes an input, returns an output. Persistence
 * is the caller's responsibility (the pg-boss `opportunity.score` worker).
 */

export interface ScoringResult extends OpportunityScoreOutput {
  /** Prompt version that produced this score — useful for replay audits. */
  promptVersion: string;
  /** 'llm' when a provider was available, 'heuristic' for fallback. */
  method: 'llm' | 'heuristic';
  /** Raw model response — kept for debugging. Not persisted by default. */
  rawResponse?: string;
}

/**
 * Heuristic fallback when no LLM is configured. Uses founder-fit weighting
 * from the description length + source quality — crude but doesn't return
 * zeroes so the Discover surface stays usable in dev environments.
 */
export function heuristicScore(input: OpportunityScoreInput): ScoringResult {
  const descLen = typeof input.description === 'string' ? input.description.length : 0;
  const sourceWeight = sourceQualityWeight(input.source);
  const base = Math.min(100, Math.floor((descLen / 1000) * 30) + sourceWeight);
  return {
    overall: base,
    founderFit: base,
    marketSignal: Math.floor(base * 0.8),
    timing: 50,
    feasibility: 60,
    rationale: 'heuristic score — configure an LLM provider for nuanced evaluation',
    promptVersion: OPPORTUNITY_SCORE_PROMPT_VERSION,
    method: 'heuristic',
  };
}

function sourceQualityWeight(source: string | null | undefined): number {
  if (typeof source !== 'string') return 15;
  const weights: Record<string, number> = {
    yc: 40,
    hn: 35,
    producthunt: 30,
    indiehackers: 28,
    'github-trending': 25,
    crunchbase: 35,
    reddit: 20,
    manual: 50,
  };
  return weights[source.toLowerCase()] ?? 15;
}

/**
 * Call the LLM to produce a real score. Throws when the LLM returns an
 * unparseable response — callers should catch and fall through to
 * `heuristicScore` rather than poison the pipeline.
 */
export async function scoreWithLlm(
  llm: LlmProvider,
  input: OpportunityScoreInput,
): Promise<ScoringResult> {
  const prompt = buildOpportunityScorePrompt(input);
  const result = await llm.completeWithUsage(prompt);
  const parsed = parseOpportunityScoreResponse(result.content);
  return {
    ...parsed,
    promptVersion: OPPORTUNITY_SCORE_PROMPT_VERSION,
    method: 'llm',
    rawResponse: result.content,
  };
}

/**
 * Combined API — tries LLM, falls back to heuristic on any failure.
 * Log on failure but never throw back to the caller; scoring must not be
 * a "bubble up to the user" layer.
 */
export async function scoreOpportunity(
  input: OpportunityScoreInput,
  llm?: LlmProvider,
): Promise<ScoringResult> {
  if (!llm) return heuristicScore(input);
  try {
    return await scoreWithLlm(llm, input);
  } catch {
    // Intentionally silent — heuristic still returns useful numbers, and
    // LLM failures are common in dev (rate limits, malformed responses).
    return heuristicScore(input);
  }
}

export {
  OPPORTUNITY_SCORE_PROMPT_VERSION,
  buildOpportunityScorePrompt,
  parseOpportunityScoreResponse,
  type OpportunityScoreInput,
  type OpportunityScoreOutput,
};

import type { LlmGovernance, LlmProvider, LlmUsage } from '../llm/index.js';
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
  /** Token/model usage when a model produced the score. */
  usage?: LlmUsage;
  /** HELM governance receipt metadata when the score used a governed model. */
  governance?: LlmGovernance;
  /** Present only when a caller explicitly allowed heuristic fallback after LLM failure. */
  fallbackReason?: string;
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
 * unparseable response so production callers cannot silently downgrade a
 * governed scoring path into a heuristic score.
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
    usage: result.usage,
    governance: result.governance,
  };
}

export interface ScoreOpportunityOptions {
  /**
   * Explicit demo/dev escape hatch. Production job paths must leave this false
   * so HELM/model failures block instead of being disguised as heuristics.
   */
  allowHeuristicFallbackOnLlmFailure?: boolean;
}

/**
 * Combined API. Heuristic scoring is allowed when no LLM is configured.
 * Once a caller supplies an LLM, failures propagate unless the caller opts
 * into a clearly marked fallback. That prevents production HELM failures from
 * being persisted as if autonomous scoring succeeded.
 */
export async function scoreOpportunity(
  input: OpportunityScoreInput,
  llm?: LlmProvider,
  options: ScoreOpportunityOptions = {},
): Promise<ScoringResult> {
  if (!llm) return heuristicScore(input);
  try {
    return await scoreWithLlm(llm, input);
  } catch (err) {
    if (options.allowHeuristicFallbackOnLlmFailure) {
      return {
        ...heuristicScore(input),
        fallbackReason: err instanceof Error ? err.message : String(err),
      };
    }
    throw err;
  }
}

export interface OpportunityEvidenceScoreInput {
  title: string;
  description: string;
  source: string;
  sourceUrl?: string;
  rawData: unknown;
  aiFriendlyOk: boolean;
  founderSignals: string[];
  citations: Array<{ url?: string; title?: string; note?: string }>;
}

export interface OpportunityEvidenceScore {
  overall: number;
  dimensions: {
    marketPain: number;
    urgency: number;
    icpClarity: number;
    monetization: number;
    channelAccessibility: number;
    competition: number;
    founderFit: number;
    technicalFeasibility: number;
    evidenceQuality: number;
    confidence: number;
  };
  assumptions: string[];
  citations: Array<{ url: string; title?: string; note?: string }>;
  rationale: string;
}

export function scoreOpportunityEvidence(
  input: OpportunityEvidenceScoreInput,
): OpportunityEvidenceScore {
  const text = `${input.title}\n${input.description}`.toLowerCase();
  const citations = normalizeEvidenceCitations(input);
  const marketPain = keywordScore(
    text,
    ['pain', 'problem', 'manual', 'expensive', 'slow', 'broken', 'friction', 'waste'],
    35,
    92,
  );
  const urgency = keywordScore(
    text,
    ['urgent', 'deadline', 'compliance', 'regulation', 'risk', 'now', 'critical', 'churn'],
    30,
    88,
  );
  const icpClarity = keywordScore(
    text,
    [
      'for ',
      'teams',
      'founders',
      'developers',
      'operators',
      'sales',
      'finance',
      'enterprise',
      'smb',
    ],
    35,
    90,
  );
  const monetization = keywordScore(
    text,
    ['budget', 'paid', 'pricing', 'subscription', 'revenue', 'cost', 'roi', 'workflow'],
    28,
    86,
  );
  const channelAccessibility = Math.max(
    sourceSignal(input.source),
    keywordScore(
      text,
      [
        'community',
        'yc',
        'hacker news',
        'product hunt',
        'linkedin',
        'reddit',
        'newsletter',
        'marketplace',
      ],
      25,
      84,
    ),
  );
  const competition =
    100 -
    keywordScore(text, ['crowded', 'incumbent', 'commodity', 'red ocean', 'saturated'], 8, 70);
  const founderFit = Math.max(
    input.aiFriendlyOk ? 72 : 45,
    keywordOverlapScore(text, input.founderSignals, 35, 92),
  );
  const technicalFeasibility =
    100 -
    keywordScore(
      text,
      ['hardware', 'medical device', 'bank charter', 'deeptech', 'regulated', 'biometric'],
      10,
      72,
    );
  const evidenceQuality = Math.min(
    100,
    25 +
      (input.sourceUrl ? 20 : 0) +
      citations.length * 15 +
      (hasRawEvidence(input.rawData) ? 15 : 0) +
      Math.min(25, Math.floor(input.description.length / 80)),
  );
  const confidence = clampScore(
    Math.round(evidenceQuality * 0.65 + citationConfidence(citations) * 0.35),
  );
  const dimensions = {
    marketPain,
    urgency,
    icpClarity,
    monetization,
    channelAccessibility,
    competition,
    founderFit,
    technicalFeasibility,
    evidenceQuality,
    confidence,
  };
  const overall = clampScore(
    Math.round(
      marketPain * 0.14 +
        urgency * 0.1 +
        icpClarity * 0.1 +
        monetization * 0.11 +
        channelAccessibility * 0.09 +
        competition * 0.08 +
        founderFit * 0.14 +
        technicalFeasibility * 0.1 +
        evidenceQuality * 0.08 +
        confidence * 0.06,
    ),
  );
  return {
    overall,
    dimensions,
    assumptions: buildScoreAssumptions(input, dimensions),
    citations,
    rationale: `Evidence-backed score ${overall}/100: pain=${marketPain}, founder_fit=${founderFit}, evidence=${evidenceQuality}, confidence=${confidence}.`,
  };
}

function normalizeEvidenceCitations(input: OpportunityEvidenceScoreInput) {
  const explicit = input.citations
    .filter((citation) => typeof citation.url === 'string' && citation.url.length > 0)
    .map((citation) => ({
      url: citation.url!,
      ...(citation.title ? { title: citation.title } : {}),
      ...(citation.note ? { note: citation.note } : {}),
    }));
  if (explicit.length > 0) return explicit.slice(0, 5);
  return input.sourceUrl ? [{ url: input.sourceUrl, title: input.source }] : [];
}

function keywordScore(text: string, keywords: string[], base: number, max: number): number {
  const hits = keywords.filter((keyword) => text.includes(keyword)).length;
  return clampScore(base + hits * Math.ceil((max - base) / Math.max(1, keywords.length / 2)));
}

function keywordOverlapScore(text: string, signals: string[], base: number, max: number): number {
  if (signals.length === 0) return base;
  const normalized = signals.map((signal) => signal.toLowerCase()).filter(Boolean);
  const hits = normalized.filter((signal) =>
    signal
      .split(/[^a-z0-9]+/u)
      .filter((part) => part.length > 2)
      .some((part) => text.includes(part)),
  ).length;
  return clampScore(base + hits * Math.ceil((max - base) / Math.max(1, normalized.length)));
}

function sourceSignal(source: string): number {
  const normalized = source.toLowerCase();
  if (normalized.includes('yc')) return 84;
  if (normalized.includes('hn') || normalized.includes('hacker')) return 76;
  if (normalized.includes('producthunt')) return 70;
  if (normalized.includes('manual')) return 68;
  if (normalized.includes('reddit')) return 58;
  return 45;
}

function hasRawEvidence(rawData: unknown): boolean {
  if (!rawData) return false;
  if (Array.isArray(rawData)) return rawData.length > 0;
  if (typeof rawData === 'object')
    return Object.keys(rawData as Record<string, unknown>).length > 0;
  return true;
}

function citationConfidence(citations: Array<{ url: string }>): number {
  if (citations.length === 0) return 25;
  return clampScore(45 + citations.length * 12);
}

function buildScoreAssumptions(
  input: OpportunityEvidenceScoreInput,
  dimensions: OpportunityEvidenceScore['dimensions'],
): string[] {
  const assumptions = [
    'Scores are directional until validated with customer discovery evidence.',
    'No external outreach or spend was performed by this scoring tool.',
  ];
  if (input.founderSignals.length === 0) {
    assumptions.push(
      'Founder fit used generic AI-friendly/default signals because no founder signals were supplied.',
    );
  }
  if (dimensions.evidenceQuality < 55) {
    assumptions.push(
      'Evidence quality is weak; collect citations, customer quotes, or logged-in account data before committing.',
    );
  }
  if (dimensions.competition < 55) {
    assumptions.push(
      'Competition risk is high; require differentiation evidence before prioritizing.',
    );
  }
  return assumptions;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export {
  OPPORTUNITY_SCORE_PROMPT_VERSION,
  buildOpportunityScorePrompt,
  parseOpportunityScoreResponse,
  type OpportunityScoreInput,
  type OpportunityScoreOutput,
};

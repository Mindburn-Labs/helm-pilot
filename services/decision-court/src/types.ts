export type Verdict = 'strong_yes' | 'yes' | 'neutral' | 'no' | 'strong_no';

export type DecisionCourtRequestedMode = 'heuristic_preview' | 'governed_llm_court';
export type DecisionCourtMode = DecisionCourtRequestedMode | 'unavailable';
export type CourtStatus = 'completed' | 'unavailable' | 'governance_denied' | 'referee_failed';

export const VERDICT_VALUES: readonly Verdict[] = [
  'strong_yes',
  'yes',
  'neutral',
  'no',
  'strong_no',
] as const;

export type CourtStage = 'buildDocket' | 'researchBull' | 'researchBear' | 'referee' | 'synthesize';

export interface OpportunityInput {
  id: string;
  title: string;
  description: string;
  /** Any extra context the caller wants the court to consider. */
  metadata?: Record<string, unknown>;
}

export interface CourtParams {
  shortlist: readonly OpportunityInput[];
  /** Optional system-level context injected into all LLM prompts. */
  systemContext?: string;
  /** Explicit court mode. Governed mode never falls back to heuristics. */
  mode?: DecisionCourtRequestedMode;
}

export interface BullBearCase {
  opportunityId: string;
  argument: string;
}

export interface OpportunityVerdict {
  opportunityId: string;
  verdict: Verdict;
  confidence: number;
  reasoning: string;
}

export interface RankedOpportunity {
  opportunityId: string;
  rank: number;
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  bullCase: string;
  bearCase: string;
}

export interface CourtModelCall {
  participant: 'bull' | 'bear' | 'referee';
  opportunityId: string;
  prompt: string;
  output?: string;
  status: 'completed' | 'governance_denied' | 'failed';
  model?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  policyDecisionId?: string;
  policyVersion?: string;
  receipt?: {
    decisionId: string;
    verdict: string;
    policyVersion: string;
    decisionHash?: string;
    principal: string;
  };
  error?: string;
}

export interface StageTiming {
  stage: CourtStage;
  durationMs: number;
}

export interface CourtResult {
  mode: DecisionCourtMode;
  status: CourtStatus;
  /** Always false until Gate 10 eval promotion attaches passing evidence. */
  productionReady: false;
  ranking: readonly RankedOpportunity[];
  stages: readonly StageTiming[];
  totalDurationMs: number;
  modelCalls: readonly CourtModelCall[];
  finalRecommendation?: RankedOpportunity;
  unavailableReason?: string;
  governanceDenialReason?: string;
}

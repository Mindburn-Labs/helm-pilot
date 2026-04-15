export type Verdict = 'strong_yes' | 'yes' | 'neutral' | 'no' | 'strong_no';

export const VERDICT_VALUES: readonly Verdict[] = [
  'strong_yes',
  'yes',
  'neutral',
  'no',
  'strong_no',
] as const;

export type CourtStage =
  | 'buildDocket'
  | 'researchBull'
  | 'researchBear'
  | 'referee'
  | 'synthesize';

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

export interface StageTiming {
  stage: CourtStage;
  durationMs: number;
}

export interface CourtResult {
  ranking: readonly RankedOpportunity[];
  stages: readonly StageTiming[];
  totalDurationMs: number;
}

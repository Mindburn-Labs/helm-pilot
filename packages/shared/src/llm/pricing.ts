/**
 * LLM pricing table — USD per 1M tokens.
 *
 * Used by the agent loop to accumulate per-task cost and enforce budgets.
 * Update when providers change pricing. Values are listed at retail rates; actual
 * billing may differ (volume discounts, cached input, batch API).
 *
 * Unknown models fall back to FALLBACK_PRICING (conservative overestimate).
 */

export interface ModelPrice {
  inUsdPer1M: number;
  outUsdPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Anthropic (direct + OpenRouter prefix)
  'claude-sonnet-4-20250514': { inUsdPer1M: 3, outUsdPer1M: 15 },
  'claude-sonnet-4': { inUsdPer1M: 3, outUsdPer1M: 15 },
  'anthropic/claude-sonnet-4': { inUsdPer1M: 3, outUsdPer1M: 15 },
  'anthropic/claude-sonnet-4-20250514': { inUsdPer1M: 3, outUsdPer1M: 15 },
  'claude-3-5-sonnet-20241022': { inUsdPer1M: 3, outUsdPer1M: 15 },
  'claude-3-5-haiku-20241022': { inUsdPer1M: 0.8, outUsdPer1M: 4 },

  // OpenAI
  'gpt-4o': { inUsdPer1M: 2.5, outUsdPer1M: 10 },
  'gpt-4o-mini': { inUsdPer1M: 0.15, outUsdPer1M: 0.6 },
  'openai/gpt-4o': { inUsdPer1M: 2.5, outUsdPer1M: 10 },
  'openai/gpt-4o-mini': { inUsdPer1M: 0.15, outUsdPer1M: 0.6 },

  // Embeddings (OpenAI)
  'text-embedding-3-small': { inUsdPer1M: 0.02, outUsdPer1M: 0 },
  'text-embedding-3-large': { inUsdPer1M: 0.13, outUsdPer1M: 0 },
};

/** Conservative fallback for unknown models — picks a mid-tier rate. */
export const FALLBACK_PRICING: ModelPrice = { inUsdPer1M: 3, outUsdPer1M: 15 };

/**
 * Compute the USD cost of a single call given token usage.
 */
export function computeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = MODEL_PRICING[model] ?? MODEL_PRICING[model.toLowerCase()] ?? FALLBACK_PRICING;
  return (tokensIn / 1_000_000) * price.inUsdPer1M + (tokensOut / 1_000_000) * price.outUsdPer1M;
}

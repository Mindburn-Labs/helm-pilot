import { describe, it, expect } from 'vitest';
import { computeCostUsd, MODEL_PRICING, FALLBACK_PRICING } from '../llm/pricing.js';

describe('computeCostUsd', () => {
  it('computes cost for a known model', () => {
    // claude-sonnet-4: $3/1M in, $15/1M out
    const cost = computeCostUsd('claude-sonnet-4', 1_000_000, 1_000_000);
    expect(cost).toBe(18); // 3 + 15
  });

  it('scales linearly with tokens', () => {
    const cost = computeCostUsd('gpt-4o-mini', 500_000, 500_000);
    // gpt-4o-mini: $0.15/1M in, $0.60/1M out → 0.075 + 0.30 = 0.375
    expect(cost).toBeCloseTo(0.375, 5);
  });

  it('uses fallback for unknown models', () => {
    const cost = computeCostUsd('some-unknown-model', 1_000_000, 1_000_000);
    const expected = FALLBACK_PRICING.inUsdPer1M + FALLBACK_PRICING.outUsdPer1M;
    expect(cost).toBe(expected);
  });

  it('handles zero tokens', () => {
    expect(computeCostUsd('claude-sonnet-4', 0, 0)).toBe(0);
  });

  it('handles embedding models (no output cost)', () => {
    const cost = computeCostUsd('text-embedding-3-small', 1_000_000, 0);
    expect(cost).toBeCloseTo(0.02, 5);
  });

  it('provides pricing for all OpenRouter-prefixed Anthropic variants', () => {
    const a = computeCostUsd('anthropic/claude-sonnet-4', 1000, 1000);
    const b = computeCostUsd('claude-sonnet-4', 1000, 1000);
    expect(a).toBe(b);
  });

  it('pricing table contains required entries', () => {
    expect(MODEL_PRICING['claude-sonnet-4']).toBeDefined();
    expect(MODEL_PRICING['gpt-4o-mini']).toBeDefined();
    expect(MODEL_PRICING['text-embedding-3-small']).toBeDefined();
  });
});

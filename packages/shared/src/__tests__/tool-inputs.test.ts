import { describe, expect, it } from 'vitest';
import { DecisionCourtRequestInput } from '../schemas/index.js';

describe('DecisionCourtRequestInput', () => {
  it('defaults to governed LLM court mode', () => {
    const parsed = DecisionCourtRequestInput.parse({ opportunityIds: ['opp-1'] });

    expect(parsed.mode).toBe('governed_llm_court');
  });

  it('allows explicit heuristic preview but rejects empty shortlists', () => {
    expect(
      DecisionCourtRequestInput.parse({
        opportunityIds: ['opp-1'],
        mode: 'heuristic_preview',
      }).mode,
    ).toBe('heuristic_preview');

    expect(() => DecisionCourtRequestInput.parse({ opportunityIds: [] })).toThrow();
  });
});

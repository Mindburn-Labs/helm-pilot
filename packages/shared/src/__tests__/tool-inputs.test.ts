import { describe, expect, it } from 'vitest';
import {
  BrowserReadObservationInput,
  CreateBrowserSessionGrantInput,
  CreateBrowserSessionInput,
  DecisionCourtRequestInput,
} from '../schemas/index.js';

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

describe('browser operation inputs', () => {
  it('requires scoped browser session origins and read-only observation identifiers', () => {
    const session = CreateBrowserSessionInput.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      name: 'Founder Chrome',
      allowedOrigins: ['https://www.ycombinator.com'],
    });
    expect(session.browser).toBe('unknown');

    const grant = CreateBrowserSessionGrantInput.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      allowedOrigins: ['https://www.ycombinator.com'],
    });
    expect(grant.scope).toBe('read_extract');

    const observation = BrowserReadObservationInput.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      grantId: '00000000-0000-4000-8000-000000000003',
      url: 'https://www.ycombinator.com/account',
      domSnapshot: '<main>YC account</main>',
    });
    expect(observation.extractedData).toEqual({});
    expect(observation.redactions).toEqual([]);
  });

  it('rejects non-origin browser session scopes', () => {
    expect(() =>
      CreateBrowserSessionInput.parse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        name: 'Founder Chrome',
        allowedOrigins: ['https://www.ycombinator.com/account'],
      }),
    ).toThrow(/must be a URL origin/u);
  });
});

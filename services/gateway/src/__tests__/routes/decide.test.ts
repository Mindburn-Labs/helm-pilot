import { describe, expect, it, vi } from 'vitest';
import { decideRoutes } from '../../routes/decide.js';
import { createMockDeps, expectJson, mockOpportunity, testApp } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const partnerHeaders = {
  'X-Workspace-Id': workspaceId,
  'X-Workspace-Role': 'partner',
};

function mockHelmClient() {
  const chatCompletion = vi.fn(
    async (
      principal: string | undefined,
      body: { model: string; messages: { content: string }[] },
    ) => {
      const prompt = body.messages[0]?.content ?? '';
      const content = prompt.includes('strongest possible case FOR')
        ? 'Bull case argument'
        : prompt.includes('strongest possible case AGAINST')
          ? 'Bear case argument'
          : JSON.stringify({
              verdict: 'yes',
              confidence: 82,
              reasoning: 'Strong fit with manageable risk.',
            });
      const callNumber = chatCompletion.mock.calls.length;
      return {
        body: {
          id: `chatcmpl-${callNumber}`,
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        },
        receipt: {
          decisionId: `helm-dec-${callNumber}`,
          verdict: 'ALLOW',
          policyVersion: 'founder-ops-v1',
          principal: principal ?? 'anonymous',
          action: 'LLM_INFERENCE',
          resource: body.model,
          receivedAt: new Date('2026-05-05T00:00:00.000Z'),
        },
      };
    },
  );

  return { chatCompletion };
}

describe('decideRoutes', () => {
  it('requires partner role to run Decision Court', async () => {
    const deps = createMockDeps();
    const { fetch } = testApp(decideRoutes, deps);

    const res = await fetch(
      'POST',
      '/court',
      { opportunityIds: ['opp-1'] },
      { 'X-Workspace-Id': workspaceId, 'X-Workspace-Role': 'member' },
    );
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('partner');
    expect(deps.db.select).not.toHaveBeenCalled();
  });

  it('returns unavailable in governed mode when no HELM LLM provider is configured', async () => {
    const deps = createMockDeps();
    deps.db._setResult([mockOpportunity({ id: 'opp-1', workspaceId })]);
    const { fetch } = testApp(decideRoutes, deps);

    const res = await fetch('POST', '/court', { opportunityIds: ['opp-1'] }, partnerHeaders);
    const body = await expectJson<Record<string, unknown>>(res, 200);

    expect(body).toMatchObject({
      mode: 'unavailable',
      status: 'unavailable',
      productionReady: false,
    });
    expect(String(body.unavailableReason)).toContain('HELM-governed LLM provider');
    expect(deps.db.insert).toHaveBeenCalled();
  });

  it('runs heuristic preview only when explicitly requested', async () => {
    const deps = createMockDeps();
    deps.db._setResult([mockOpportunity({ id: 'opp-1', workspaceId })]);
    const { fetch } = testApp(decideRoutes, deps);

    const res = await fetch(
      'POST',
      '/court',
      { opportunityIds: ['opp-1'], mode: 'heuristic_preview' },
      partnerHeaders,
    );
    const body = await expectJson<{
      mode: string;
      status: string;
      productionReady: boolean;
      ranking: Array<{ verdict: string; reasoning: string }>;
      modelCalls: unknown[];
    }>(res, 200);

    expect(body.mode).toBe('heuristic_preview');
    expect(body.status).toBe('completed');
    expect(body.productionReady).toBe(false);
    expect(body.modelCalls).toEqual([]);
    expect(body.ranking[0]?.verdict).toBe('neutral');
    expect(body.ranking[0]?.reasoning).toContain('heuristic neutral verdict');
  });

  it('validates request shape before loading opportunities', async () => {
    const deps = createMockDeps();
    const { fetch } = testApp(decideRoutes, deps);

    const res = await fetch('POST', '/court', { opportunityIds: [] }, partnerHeaders);
    const body = await expectJson<{ error: string }>(res, 400);

    expect(body.error).toBe('Invalid decision court request');
    expect(deps.db.select).not.toHaveBeenCalled();
  });

  it('uses a workspace-scoped HELM principal for governed court model calls', async () => {
    const helmClient = mockHelmClient();
    const deps = createMockDeps({ helmClient: helmClient as never });
    deps.db._setResult([mockOpportunity({ id: 'opp-1', workspaceId })]);
    const { fetch } = testApp(decideRoutes, deps);

    const res = await fetch(
      'POST',
      '/court',
      { opportunityIds: ['opp-1'], mode: 'governed_llm_court' },
      partnerHeaders,
    );
    const body = await expectJson<{
      mode: string;
      status: string;
      modelCalls: { policyDecisionId?: string; status: string }[];
      finalRecommendation?: { opportunityId: string };
    }>(res, 200);

    expect(body.mode).toBe('governed_llm_court');
    expect(body.status).toBe('completed');
    expect(body.modelCalls).toHaveLength(3);
    expect(body.modelCalls.every((call) => call.status === 'completed')).toBe(true);
    expect(body.modelCalls.every((call) => call.policyDecisionId?.startsWith('helm-dec-'))).toBe(
      true,
    );
    expect(body.finalRecommendation).toMatchObject({ opportunityId: 'opp-1' });
    expect(helmClient.chatCompletion).toHaveBeenCalledTimes(3);
    expect(helmClient.chatCompletion.mock.calls.map((call) => call[0])).toEqual([
      `workspace:${workspaceId}/operator:decision_court`,
      `workspace:${workspaceId}/operator:decision_court`,
      `workspace:${workspaceId}/operator:decision_court`,
    ]);
  });
});

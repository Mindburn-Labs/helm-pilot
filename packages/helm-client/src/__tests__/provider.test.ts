import { describe, it, expect, vi } from 'vitest';
import { HelmClient, HelmLlmProvider, HelmDeniedError } from '../index.js';

function mockHelmResponse(opts: {
  status: number;
  body?: unknown;
  verdict?: string;
  headers?: Record<string, string>;
}): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opts.headers,
  };
  if (opts.verdict) {
    headers['x-helm-decision-id'] = 'dec-p-1';
    headers['x-helm-verdict'] = opts.verdict;
    headers['x-helm-policy-version'] = 'founder-ops-v1';
    headers['x-helm-decision-hash'] = 'sha256:provider-test';
  }
  return new Response(JSON.stringify(opts.body ?? {}), { status: opts.status, headers });
}

function chatBody() {
  return {
    id: 'chatcmpl-p-1',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'anthropic/claude-sonnet-4',
    choices: [{ index: 0, message: { role: 'assistant', content: 'planned response' } }],
    usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
  };
}

describe('HelmLlmProvider', () => {
  it('returns content + usage + governance on ALLOW', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockHelmResponse({ status: 200, body: chatBody(), verdict: 'ALLOW' }),
    );
    const helm = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const provider = new HelmLlmProvider({
      helm,
      defaultPrincipal: 'workspace:w1/op:eng',
      model: 'anthropic/claude-sonnet-4',
    });

    const result = await provider.completeWithUsage('hello');
    expect(result.content).toBe('planned response');
    expect(result.usage).toEqual({
      tokensIn: 42,
      tokensOut: 17,
      model: 'anthropic/claude-sonnet-4',
    });
    expect(result.governance).toMatchObject({
      decisionId: 'dec-p-1',
      verdict: 'ALLOW',
      policyVersion: 'founder-ops-v1',
      decisionHash: 'sha256:provider-test',
      principal: 'workspace:w1/op:eng',
    });
  });

  it('complete() returns just the content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockHelmResponse({ status: 200, body: chatBody(), verdict: 'ALLOW' }),
    );
    const helm = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const provider = new HelmLlmProvider({
      helm,
      defaultPrincipal: 'p',
      model: 'anthropic/claude-sonnet-4',
    });
    const content = await provider.complete('hi');
    expect(content).toBe('planned response');
  });

  it('propagates HelmDeniedError on 403 DENY so the loop can end the iteration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockHelmResponse({
        status: 403,
        body: { reason: 'daily budget exceeded' },
        verdict: 'DENY',
      }),
    );
    const helm = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const provider = new HelmLlmProvider({
      helm,
      defaultPrincipal: 'p',
      model: 'anthropic/claude-sonnet-4',
    });
    await expect(provider.completeWithUsage('hi')).rejects.toBeInstanceOf(HelmDeniedError);
  });

  it('sends X-Helm-Principal header via HelmClient chatCompletion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockHelmResponse({ status: 200, body: chatBody(), verdict: 'ALLOW' }),
    );
    const helm = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const provider = new HelmLlmProvider({
      helm,
      defaultPrincipal: 'workspace:w1/op:growth',
      model: 'anthropic/claude-sonnet-4',
    });
    await provider.complete('hi');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Helm-Principal']).toBe('workspace:w1/op:growth');
  });

  it('throws when upstream returns no content (protocol sanity check)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockHelmResponse({
        status: 200,
        body: { ...chatBody(), choices: [] },
        verdict: 'ALLOW',
      }),
    );
    const helm = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const provider = new HelmLlmProvider({
      helm,
      defaultPrincipal: 'p',
      model: 'anthropic/claude-sonnet-4',
    });
    await expect(provider.completeWithUsage('hi')).rejects.toThrow(/no content/);
  });
});

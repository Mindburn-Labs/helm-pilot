import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HelmClient,
  HelmDeniedError,
  HelmEscalationError,
  HelmNotImplementedError,
  HelmUnreachableError,
  parseReceiptHeaders,
  normalizeVerdict,
} from '../index.js';

function makeResponse(opts: {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  return new Response(JSON.stringify(opts.body ?? {}), {
    status: opts.status,
    headers: opts.headers,
  });
}

function goodReceiptHeaders(verdict = 'ALLOW', extras: Record<string, string> = {}): Record<string, string> {
  return {
    'x-helm-decision-id': 'dec-123',
    'x-helm-verdict': verdict,
    'x-helm-policy-version': 'founder-ops-v1',
    'x-helm-decision-hash': 'sha256:abc',
    'content-type': 'application/json',
    ...extras,
  };
}

function sampleChatBody() {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'gpt-4',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hi' } }],
  };
}

describe('HelmClient.chatCompletion', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('returns body + receipt on ALLOW', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ status: 200, body: sampleChatBody(), headers: goodReceiptHeaders('ALLOW') }),
    );
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const { body, receipt } = await client.chatCompletion('workspace:w1/op:eng', {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.id).toBe('chatcmpl-1');
    expect(receipt.verdict).toBe('ALLOW');
    expect(receipt.decisionId).toBe('dec-123');
    expect(receipt.action).toBe('LLM_INFERENCE');
    expect(receipt.resource).toBe('gpt-4');
    expect(receipt.principal).toBe('workspace:w1/op:eng');
  });

  it('throws HelmDeniedError on 403 DENY', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        status: 403,
        body: { reason: 'budget exceeded' },
        headers: goodReceiptHeaders('DENY'),
      }),
    );
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmDeniedError);
  });

  it('throws HelmEscalationError on 403 ESCALATE', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        status: 403,
        body: { reason: 'human approval required' },
        headers: goodReceiptHeaders('ESCALATE'),
      }),
    );
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmEscalationError);
  });

  it('invokes onReceipt callback on both ALLOW and DENY', async () => {
    const onReceipt = vi.fn();
    const client = new HelmClient({
      baseUrl: 'http://helm:8080',
      fetchImpl: fetchMock,
      onReceipt,
    });

    // ALLOW
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 200, body: sampleChatBody(), headers: goodReceiptHeaders('ALLOW') }),
    );
    await client.chatCompletion('p', { model: 'gpt-4', messages: [] });

    // DENY
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 403, body: { reason: 'nope' }, headers: goodReceiptHeaders('DENY') }),
    );
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmDeniedError);

    expect(onReceipt).toHaveBeenCalledTimes(2);
    expect(onReceipt.mock.calls[0][0].verdict).toBe('ALLOW');
    expect(onReceipt.mock.calls[1][0].verdict).toBe('DENY');
  });

  it('fails closed when 2xx response is missing governance headers (protocol violation)', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        status: 200,
        body: sampleChatBody(),
        headers: { 'content-type': 'application/json' }, // no x-helm-* headers
      }),
    );
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmUnreachableError);
  });

  it('fails closed when 403 is missing governance headers', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ status: 403, body: { reason: 'rogue deny' } }),
    );
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmUnreachableError);
  });

  it('retries on 5xx and succeeds on later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse({ status: 502 }))
      .mockResolvedValueOnce(makeResponse({ status: 503 }))
      .mockResolvedValueOnce(
        makeResponse({ status: 200, body: sampleChatBody(), headers: goodReceiptHeaders('ALLOW') }),
      );
    const client = new HelmClient({
      baseUrl: 'http://helm:8080',
      fetchImpl: fetchMock,
      maxRetries: 3,
      baseBackoffMs: 1,
    });
    const result = await client.chatCompletion('p', { model: 'gpt-4', messages: [] });
    expect(result.receipt.verdict).toBe('ALLOW');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails closed when all retries exhaust on 5xx', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 500 }));
    const client = new HelmClient({
      baseUrl: 'http://helm:8080',
      fetchImpl: fetchMock,
      maxRetries: 2,
      baseBackoffMs: 1,
    });
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmUnreachableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 403 (definitive verdict)', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ status: 403, body: { reason: 'blocked' }, headers: goodReceiptHeaders('DENY') }),
    );
    const client = new HelmClient({
      baseUrl: 'http://helm:8080',
      fetchImpl: fetchMock,
      maxRetries: 5,
      baseBackoffMs: 1,
    });
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmDeniedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends X-Helm-Principal header and uses defaultPrincipal fallback', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ status: 200, body: sampleChatBody(), headers: goodReceiptHeaders('ALLOW') }),
    );
    const client = new HelmClient({
      baseUrl: 'http://helm:8080',
      fetchImpl: fetchMock,
      defaultPrincipal: 'default-principal',
    });
    await client.chatCompletion(undefined, { model: 'gpt-4', messages: [] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Helm-Principal']).toBe('default-principal');
  });

  it('network error propagates as HelmUnreachableError after retries', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const client = new HelmClient({
      baseUrl: 'http://helm:8080',
      fetchImpl: fetchMock,
      maxRetries: 2,
      baseBackoffMs: 1,
    });
    await expect(
      client.chatCompletion('p', { model: 'gpt-4', messages: [] }),
    ).rejects.toBeInstanceOf(HelmUnreachableError);
  });
});

describe('HelmClient.health', () => {
  it('returns ok + latency on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ status: 200, body: { status: 'ok', version: '0.3.0' } }),
    );
    const client = new HelmClient({
      baseUrl: 'http://helm:8080',
      healthUrl: 'http://helm:8081',
      fetchImpl: fetchMock,
    });
    const snap = await client.health();
    expect(snap.gatewayOk).toBe(true);
    expect(snap.version).toBe('0.3.0');
    expect(snap.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns not-ok on HTTP error without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ status: 500 }));
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const snap = await client.health();
    expect(snap.gatewayOk).toBe(false);
    expect(snap.error).toBe('HTTP 500');
  });

  it('returns not-ok on network failure without throwing', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: fetchMock });
    const snap = await client.health();
    expect(snap.gatewayOk).toBe(false);
    expect(snap.error).toBe('connect ECONNREFUSED');
  });
});

describe('HelmClient.evaluate (not yet implemented upstream)', () => {
  it('throws HelmNotImplementedError with a clear message', async () => {
    const client = new HelmClient({ baseUrl: 'http://helm:8080', fetchImpl: vi.fn() });
    await expect(
      client.evaluate({ principal: 'p', action: 'tool.use', resource: 'github.commit' }),
    ).rejects.toBeInstanceOf(HelmNotImplementedError);
  });
});

describe('parseReceiptHeaders', () => {
  it('parses a full set of headers', () => {
    const headers = new Headers({
      'x-helm-decision-id': 'd1',
      'x-helm-verdict': 'ALLOW',
      'x-helm-policy-version': 'v1',
      'x-helm-decision-hash': 'sha256:xx',
    });
    const r = parseReceiptHeaders(headers, { action: 'LLM_INFERENCE', resource: 'gpt-4', principal: 'p' });
    expect(r).not.toBeNull();
    expect(r!.verdict).toBe('ALLOW');
    expect(r!.decisionHash).toBe('sha256:xx');
  });

  it('returns null when required headers are missing', () => {
    const headers = new Headers({ 'x-helm-verdict': 'ALLOW' });
    expect(parseReceiptHeaders(headers, { action: 'x', resource: 'y', principal: 'z' })).toBeNull();
  });

  it('returns null on unknown verdict', () => {
    const headers = new Headers({
      'x-helm-decision-id': 'd1',
      'x-helm-verdict': 'MAYBE',
      'x-helm-policy-version': 'v1',
    });
    expect(parseReceiptHeaders(headers, { action: 'x', resource: 'y', principal: 'z' })).toBeNull();
  });
});

describe('normalizeVerdict', () => {
  it('accepts canonical forms', () => {
    expect(normalizeVerdict('ALLOW')).toBe('ALLOW');
    expect(normalizeVerdict('DENY')).toBe('DENY');
    expect(normalizeVerdict('ESCALATE')).toBe('ESCALATE');
  });
  it('normalizes casing', () => {
    expect(normalizeVerdict('allow')).toBe('ALLOW');
    expect(normalizeVerdict(' Deny ')).toBe('DENY');
  });
  it('returns null on nonsense', () => {
    expect(normalizeVerdict('MAYBE')).toBeNull();
    expect(normalizeVerdict('')).toBeNull();
  });
});

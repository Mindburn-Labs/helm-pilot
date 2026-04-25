import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../llm/ollama.js';

// ─── OllamaProvider tests (Phase 16 Track Q) ───
//
// All HTTP is stubbed via vi.stubGlobal('fetch', ...). No real network.

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const SAMPLE_RESPONSE = {
  message: { role: 'assistant', content: 'hello back' },
  eval_count: 25,
  prompt_eval_count: 10,
  model: 'llama3.1:8b',
};

describe('OllamaProvider', () => {
  it('complete() returns content string', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok(SAMPLE_RESPONSE));
    const provider = new OllamaProvider({ model: 'llama3.1:8b' });
    const result = await provider.complete('hi');
    expect(result).toBe('hello back');
  });

  it('completeWithUsage() maps eval_count → tokensIn/tokensOut/model', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok(SAMPLE_RESPONSE));
    const provider = new OllamaProvider({ model: 'llama3.1:8b' });
    const result = await provider.completeWithUsage('hi');
    expect(result.content).toBe('hello back');
    expect(result.usage).toEqual({
      tokensIn: 10,
      tokensOut: 25,
      model: 'llama3.1:8b',
    });
  });

  it('completeStructured() splits system + user messages', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok(SAMPLE_RESPONSE));
    const provider = new OllamaProvider({ model: 'llama3.1:8b' });
    await provider.completeStructured({ system: 'you are pilot', user: 'hi' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toEqual([
      { role: 'system', content: 'you are pilot' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('default base URL is http://localhost:11434', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok(SAMPLE_RESPONSE));
    const provider = new OllamaProvider({ model: 'llama3.1:8b' });
    await provider.complete('x');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/chat');
  });

  it('custom baseUrl with trailing slash is normalized', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok(SAMPLE_RESPONSE));
    const provider = new OllamaProvider({
      baseUrl: 'http://ollama.test:9999/',
      model: 'qwen2.5',
    });
    await provider.complete('x');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ollama.test:9999/api/chat');
  });

  it('passes model + num_predict + stream:false in body', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok(SAMPLE_RESPONSE));
    const provider = new OllamaProvider({ model: 'phi4', maxTokens: 500 });
    await provider.complete('x');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      options: { num_predict: number };
    };
    expect(body.model).toBe('phi4');
    expect(body.stream).toBe(false);
    expect(body.options.num_predict).toBe(500);
  });

  it('throws on HTTP 5xx', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    const provider = new OllamaProvider({ model: 'llama3.1' });
    await expect(provider.complete('x')).rejects.toThrow(/Ollama HTTP 502/);
  });

  it('wraps fetch errors as transport errors', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const provider = new OllamaProvider({ model: 'llama3.1' });
    await expect(provider.complete('x')).rejects.toThrow(/Ollama transport error/);
  });

  it('handles empty content gracefully', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok({ message: { role: 'assistant' } }));
    const provider = new OllamaProvider({ model: 'llama3.1' });
    const result = await provider.completeWithUsage('x');
    expect(result.content).toBe('');
    expect(result.usage.tokensIn).toBe(0);
    expect(result.usage.tokensOut).toBe(0);
  });

  it('falls back to provider.cfg.model when response omits model', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({ message: { content: 'hi' }, eval_count: 1, prompt_eval_count: 1 }),
    );
    const provider = new OllamaProvider({ model: 'configured-model' });
    const result = await provider.completeWithUsage('x');
    expect(result.usage.model).toBe('configured-model');
  });
});

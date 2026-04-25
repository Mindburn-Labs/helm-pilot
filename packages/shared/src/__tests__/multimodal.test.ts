import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultimodalError, analyzeImage, parsePdf, parsePdfBase64 } from '../multimodal/index.js';

// ─── Multimodal tests (Phase 15 Track K) ───
//
// Pure: all HTTP is stubbed via vi.stubGlobal('fetch', ...). The
// `pdf-parse` optional peer dep is absent in the test env, so the
// "not_installed" path is exercised as the primary happy-path assertion.

// 1x1 transparent PNG, base64-encoded.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FAKE_ANTHROPIC_KEY = 'sk-ant-FAKE-test-key';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['NODE_ENV'];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parsePdf', () => {
  it('rejects empty bytes with MultimodalError{invalid_input}', async () => {
    await expect(parsePdf(new Uint8Array(0))).rejects.toMatchObject({
      name: 'MultimodalError',
      code: 'invalid_input',
    });
  });

  it('throws not_installed when pdf-parse is absent', async () => {
    // pdf-parse is not in the test env's node_modules, so this fires.
    const bytes = new Uint8Array(Buffer.from('%PDF-1.4\n%fake'));
    await expect(parsePdf(bytes)).rejects.toMatchObject({
      name: 'MultimodalError',
      code: 'not_installed',
    });
  });
});

describe('parsePdfBase64', () => {
  it('rejects empty string', async () => {
    await expect(parsePdfBase64('')).rejects.toMatchObject({
      name: 'MultimodalError',
      code: 'invalid_input',
    });
  });
});

describe('analyzeImage', () => {
  it('rejects empty imageBase64', async () => {
    await expect(
      analyzeImage({
        imageBase64: '',
        mediaType: 'image/png',
        question: 'what is this',
        apiKey: FAKE_ANTHROPIC_KEY,
      }),
    ).rejects.toMatchObject({ name: 'MultimodalError', code: 'invalid_input' });
  });

  it('rejects empty question', async () => {
    await expect(
      analyzeImage({
        imageBase64: TINY_PNG_BASE64,
        mediaType: 'image/png',
        question: '   ',
        apiKey: FAKE_ANTHROPIC_KEY,
      }),
    ).rejects.toMatchObject({ name: 'MultimodalError', code: 'invalid_input' });
  });

  it('throws not_installed when ANTHROPIC_API_KEY is unset and no override', async () => {
    await expect(
      analyzeImage({
        imageBase64: TINY_PNG_BASE64,
        mediaType: 'image/png',
        question: 'what',
      }),
    ).rejects.toMatchObject({ name: 'MultimodalError', code: 'not_installed' });
  });

  it('blocks direct provider calls in production', async () => {
    process.env['NODE_ENV'] = 'production';
    await expect(
      analyzeImage({
        imageBase64: TINY_PNG_BASE64,
        mediaType: 'image/png',
        question: 'what',
        apiKey: FAKE_ANTHROPIC_KEY,
      }),
    ).rejects.toMatchObject({ name: 'MultimodalError', code: 'not_installed' });
  });

  it('happy path parses Anthropic response + attributes usage', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'a 1x1 image' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-sonnet-4-20250514',
        }),
        { status: 200 },
      ),
    );
    const result = await analyzeImage({
      imageBase64: TINY_PNG_BASE64,
      mediaType: 'image/png',
      question: 'what is this?',
      apiKey: FAKE_ANTHROPIC_KEY,
    });
    expect(result.text).toBe('a 1x1 image');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.model).toBe('claude-sonnet-4-20250514');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(FAKE_ANTHROPIC_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const content = body.messages[0]?.content;
    expect(content).toBeDefined();
    expect(content).toHaveLength(2);
    expect(content?.[0]).toMatchObject({ type: 'image' });
    expect(content?.[1]).toMatchObject({ type: 'text', text: 'what is this?' });
  });

  it('throws vision_failed on HTTP 5xx', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(
      analyzeImage({
        imageBase64: TINY_PNG_BASE64,
        mediaType: 'image/png',
        question: 'q',
        apiKey: FAKE_ANTHROPIC_KEY,
      }),
    ).rejects.toMatchObject({ name: 'MultimodalError', code: 'vision_failed' });
  });

  it('reads ANTHROPIC_API_KEY from env when no override supplied', async () => {
    process.env['ANTHROPIC_API_KEY'] = FAKE_ANTHROPIC_KEY;
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
      }),
    );
    await analyzeImage({
      imageBase64: TINY_PNG_BASE64,
      mediaType: 'image/png',
      question: 'q',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(FAKE_ANTHROPIC_KEY);
  });
});

describe('MultimodalError', () => {
  it('exposes code + message', () => {
    const e = new MultimodalError('bad', 'parse_failed');
    expect(e.name).toBe('MultimodalError');
    expect(e.code).toBe('parse_failed');
    expect(e.message).toBe('bad');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackConnector, SlackError } from '../slack.js';
import { NotionConnector, NotionError } from '../notion.js';

// ─── Slack + Notion connector tests (Phase 15 Track I) ───
//
// All HTTP is stubbed via vi.stubGlobal('fetch', ...). No real network.

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('SlackConnector', () => {
  it('rejects empty token at construction time', () => {
    expect(() => new SlackConnector('')).toThrow(SlackError);
  });

  it('postMessage parses {channel,ts}', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok({ ok: true, channel: 'C0123', ts: '1718.1' }));
    const slack = new SlackConnector('xoxb-test');
    const res = await slack.postMessage('#general', 'hi');
    expect(res).toEqual({ channel: 'C0123', ts: '1718.1' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer xoxb-test');
  });

  it('listChannels parses array of channels', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        ok: true,
        channels: [
          { id: 'C1', name: 'general', is_private: false },
          { id: 'C2', name: 'eng', is_private: true },
        ],
      }),
    );
    const channels = await new SlackConnector('xoxb-test').listChannels();
    expect(channels).toEqual([
      { id: 'C1', name: 'general', isPrivate: false },
      { id: 'C2', name: 'eng', isPrivate: true },
    ]);
  });

  it('search parses message matches', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        ok: true,
        messages: {
          matches: [
            {
              ts: '17.0',
              channel: { id: 'C1', name: 'general' },
              user: 'U1',
              text: 'hello',
              permalink: 'https://slack.test/x',
            },
          ],
        },
      }),
    );
    const matches = await new SlackConnector('xoxb-test').search('hello');
    expect(matches).toEqual([
      {
        ts: '17.0',
        channel: { id: 'C1', name: 'general' },
        user: 'U1',
        text: 'hello',
        permalink: 'https://slack.test/x',
      },
    ]);
  });

  it('throws SlackError on {ok:false}', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok({ ok: false, error: 'channel_not_found' }));
    await expect(new SlackConnector('xoxb-test').postMessage('C0', 'x')).rejects.toMatchObject({
      name: 'SlackError',
      slackError: 'channel_not_found',
    });
  });

  it('throws SlackError on HTTP 5xx', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(new SlackConnector('xoxb-test').listChannels()).rejects.toThrow(SlackError);
  });
});

describe('NotionConnector', () => {
  it('rejects empty token', () => {
    expect(() => new NotionConnector('')).toThrow(NotionError);
  });

  it('search extracts title + url + id from results array', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        results: [
          {
            id: 'p1',
            url: 'https://www.notion.so/p1',
            last_edited_time: '2026-04-19T19:00:00.000Z',
            properties: {
              Name: { title: [{ plain_text: 'My page' }] },
            },
          },
        ],
      }),
    );
    const out = await new NotionConnector('secret_test').search('my');
    expect(out).toEqual([
      {
        id: 'p1',
        url: 'https://www.notion.so/p1',
        title: 'My page',
        lastEditedTime: '2026-04-19T19:00:00.000Z',
      },
    ]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret_test');
    expect(headers['Notion-Version']).toBe('2022-06-28');
  });

  it('createPage returns id+url and emits children blocks', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok({ id: 'p2', url: 'https://www.notion.so/p2' }));
    const res = await new NotionConnector('secret_test').createPage('parent-1', 'New', ['hello']);
    expect(res).toEqual({ id: 'p2', url: 'https://www.notion.so/p2' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { children: unknown[] };
    expect(Array.isArray(body.children)).toBe(true);
    expect(body.children).toHaveLength(1);
  });

  it('getPage returns title fallback when no title property', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        id: 'p3',
        url: 'https://www.notion.so/p3',
        last_edited_time: '2026-04-19T19:00:00.000Z',
        properties: {},
      }),
    );
    const out = await new NotionConnector('secret_test').getPage('p3');
    expect(out.title).toBe('(untitled)');
    expect(out.id).toBe('p3');
  });

  it('throws NotionError on HTTP 401 with code', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }),
    );
    await expect(new NotionConnector('secret_test').getPage('p3')).rejects.toMatchObject({
      name: 'NotionError',
      notionCode: 'unauthorized',
    });
  });
});

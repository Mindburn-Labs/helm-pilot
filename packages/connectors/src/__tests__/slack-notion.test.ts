import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  SlackConnector,
  SlackError,
  formatSlackWorkspaceAgentRunSummary,
  slackWorkspaceAgentRequestFromSlashCommand,
  verifySlackRequestSignature,
} from '../slack.js';
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

  it('verifies Slack request signatures with timestamp tolerance', () => {
    const rawBody = 'channel_id=C1&user_id=U1&command=%2Fpilot&text=launch';
    const timestamp = '1000';
    const signature = `v0=${createHmac('sha256', 'secret')
      .update(`v0:${timestamp}:${rawBody}`)
      .digest('hex')}`;

    expect(
      verifySlackRequestSignature({
        signingSecret: 'secret',
        timestamp,
        rawBody,
        signature,
        nowSeconds: 1000,
      }),
    ).toBe(true);
    expect(
      verifySlackRequestSignature({
        signingSecret: 'secret',
        timestamp,
        rawBody,
        signature,
        nowSeconds: 2000,
      }),
    ).toBe(false);
  });

  it('normalizes slash commands into workspace-agent requests', () => {
    const request = slackWorkspaceAgentRequestFromSlashCommand(
      'ws-1',
      'team_id=T1&team_domain=mindburn&channel_id=C1&channel_name=founder-os&user_id=U1&user_name=ivan&command=%2Fpilot&text=prepare%20launch%20brief&response_url=https%3A%2F%2Fslack.test%2Fresponse&trigger_id=trig-1',
    );

    expect(request).toEqual({
      workspaceId: 'ws-1',
      source: 'slash_command',
      teamId: 'T1',
      teamDomain: 'mindburn',
      channelId: 'C1',
      channelName: 'founder-os',
      userId: 'U1',
      userName: 'ivan',
      command: '/pilot',
      text: 'prepare launch brief',
      responseUrl: 'https://slack.test/response',
      triggerId: 'trig-1',
    });
  });

  it('posts workspace-agent summaries with HELM approval and receipt trail', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(ok({ ok: true, channel: 'C1', ts: '1718.2' }));

    const result = await new SlackConnector('xoxb-test').postWorkspaceAgentRunSummary(
      'C1',
      {
        title: 'Launch brief',
        status: 'awaiting_approval',
        steps: ['Drafted outbound copy', 'Queued CRM update'],
        approvals: [
          {
            approvalId: 'appr-1',
            action: 'gmail_send',
            status: 'pending',
            receiptId: 'rcpt-1',
          },
        ],
        evidencePackId: 'evp-1',
      },
      { threadTs: '1718.1' },
    );

    expect(result).toEqual({ channel: 'C1', ts: '1718.2' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string; thread_ts: string };
    expect(body.thread_ts).toBe('1718.1');
    expect(body.text).toContain('HELM approvals and receipts');
    expect(body.text).toContain('approval=appr-1');
    expect(body.text).toContain('Evidence pack: evp-1');
  });

  it('formats empty receipt trails without losing status context', () => {
    expect(
      formatSlackWorkspaceAgentRunSummary({
        title: 'Workspace agent',
        status: 'completed',
        steps: [],
        approvals: [],
      }),
    ).toContain('No approvals required.');
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  A2AClient,
  A2AError,
  A2A_PROTOCOL_VERSION,
  buildPilotAgentCard,
} from '../a2a/index.js';

// ─── A2A tests (Phase 15 Track J) ───

const BASE_URL = 'https://pilot.example.test';
const TOKEN = 'a2a-test-token';

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

describe('buildPilotAgentCard', () => {
  it('produces a valid AgentCard with protocol version + skills', () => {
    const card = buildPilotAgentCard({
      url: `${BASE_URL}/a2a`,
      version: '1.2.0',
    });
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.version).toBe('1.2.0');
    expect(card.url).toBe(`${BASE_URL}/a2a`);
    expect(card.skills.length).toBeGreaterThan(0);
    expect(card.authentication.schemes).toEqual(['bearer']);
    expect(card.capabilities.stateTransitionHistory).toBe(true);
  });

  it('accepts custom auth schemes + provider metadata', () => {
    const card = buildPilotAgentCard({
      url: `${BASE_URL}/a2a`,
      version: '1.2.0',
      authSchemes: ['oauth2'],
      organization: 'Mindburn Labs',
      organizationUrl: 'https://mindburn.org',
    });
    expect(card.authentication.schemes).toEqual(['oauth2']);
    expect(card.provider?.organization).toBe('Mindburn Labs');
  });
});

describe('A2AClient config', () => {
  it('rejects missing baseUrl', () => {
    expect(
      () => new A2AClient({ baseUrl: '' as string, bearerToken: TOKEN }),
    ).toThrow(A2AError);
  });
});

describe('A2AClient.fetchAgentCard', () => {
  it('fetches /.well-known/agent-card.json', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        name: 'Peer',
        description: 'peer',
        url: `${BASE_URL}/a2a`,
        protocolVersion: '0.3.0',
        version: '0.1.0',
        capabilities: {},
        authentication: { schemes: ['none'] },
        skills: [],
      }),
    );
    const client = new A2AClient({ baseUrl: BASE_URL });
    const card = await client.fetchAgentCard();
    expect(card.name).toBe('Peer');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/.well-known/agent-card.json`);
  });

  it('maps HTTP 5xx into transport_error', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    const client = new A2AClient({ baseUrl: BASE_URL });
    await expect(client.fetchAgentCard()).rejects.toMatchObject({
      name: 'A2AError',
      code: 'transport_error',
    });
  });
});

describe('A2AClient.sendTask', () => {
  it('happy path returns Task with bearer header attached', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        jsonrpc: '2.0',
        id: 1,
        result: {
          task: {
            id: 't-1',
            status: { state: 'completed', timestamp: '2026-04-20T12:00:00Z' },
          },
        },
      }),
    );
    const client = new A2AClient({ baseUrl: BASE_URL, bearerToken: TOKEN });
    const task = await client.sendTask({
      message: { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    });
    expect(task.id).toBe('t-1');
    expect(task.status.state).toBe('completed');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body as string) as { method: string };
    expect(body.method).toBe('tasks/send');
  });

  it('maps HTTP 401 into auth_error', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    const client = new A2AClient({ baseUrl: BASE_URL, bearerToken: 'wrong' });
    await expect(
      client.sendTask({
        message: { role: 'user', parts: [{ type: 'text', text: 'x' }] },
      }),
    ).rejects.toMatchObject({ name: 'A2AError', code: 'auth_error' });
  });

  it('maps JSON-RPC error envelope into protocol_error', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      }),
    );
    const client = new A2AClient({ baseUrl: BASE_URL, bearerToken: TOKEN });
    await expect(client.getTask('ghost')).rejects.toMatchObject({
      name: 'A2AError',
      code: 'protocol_error',
    });
  });
});

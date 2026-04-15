import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setAuthToken, authenticate, getStatus, getTasks, getOperators, getProfile } from '../api.js';

// ─── Fetch mock ───

function mockFetch(status: number, body: unknown, headers?: Record<string, string>) {
  const headerMap = new Map(Object.entries(headers ?? {}));
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headerMap.get(k) ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  setAuthToken('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setAuthToken', () => {
  it('stores the token for subsequent requests', async () => {
    const mock = mockFetch(200, []);
    vi.stubGlobal('fetch', mock);

    setAuthToken('my-secret-token');
    await getTasks('ws-1');

    const [, init] = mock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-token');

    vi.unstubAllGlobals();
  });

  it('sends no Authorization header when token is empty string', async () => {
    const mock = mockFetch(200, []);
    vi.stubGlobal('fetch', mock);

    setAuthToken('');
    await getTasks('ws-1');

    const [, init] = mock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

describe('authenticate', () => {
  it('sends POST to /api/auth/telegram with initData', async () => {
    const responseBody = {
      token: 'jwt-123',
      user: { id: 'u1', name: 'Alice', telegramId: '999' },
      workspace: { id: 'ws1', name: "Alice's Workspace" },
    };
    const mock = mockFetch(200, responseBody);
    vi.stubGlobal('fetch', mock);

    const result = await authenticate('telegram-init-data-string');

    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe('/api/auth/telegram');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ initData: 'telegram-init-data-string' });
    expect(result).toEqual(responseBody);

    vi.unstubAllGlobals();
  });

  it('sets Content-Type to application/json', async () => {
    const mock = mockFetch(200, { token: 'x', user: {}, workspace: {} });
    vi.stubGlobal('fetch', mock);

    await authenticate('data');

    const [, init] = mock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    const mock = mockFetch(401, 'Unauthorized');
    vi.stubGlobal('fetch', mock);

    await expect(authenticate('bad-data')).rejects.toThrow('401');

    vi.unstubAllGlobals();
  });
});

describe('getStatus', () => {
  it('returns the canonical status payload', async () => {
    const statusResponse = {
      workspace: { id: 'ws-42', name: 'Workspace', currentMode: 'discover' },
      tasks: { total: 5, running: 2, queued: 1, completed: 1, failed: 1 },
      operators: 3,
      pendingApprovals: 1,
    };
    const mock = mockFetch(200, statusResponse);
    vi.stubGlobal('fetch', mock);

    setAuthToken('tok');
    const status = await getStatus('ws-42');

    expect(status.workspace.id).toBe('ws-42');
    expect(status.tasks.total).toBe(5);
    expect(status.tasks.running).toBe(2);
    expect(status.tasks.queued).toBe(1);
    expect(status.tasks.completed).toBe(1);
    expect(status.tasks.failed).toBe(1);
    expect(status.operators).toBe(3);
    expect(status.pendingApprovals).toBe(1);

    vi.unstubAllGlobals();
  });

  it('passes workspaceId as query param', async () => {
    const mock = mockFetch(200, { workspace: {}, tasks: {}, operators: 0, pendingApprovals: 0 });
    vi.stubGlobal('fetch', mock);

    await getStatus('ws-99');

    const [url] = mock.mock.calls[0]!;
    expect(url).toBe('/api/status?workspaceId=ws-99');

    vi.unstubAllGlobals();
  });
});

describe('getTasks', () => {
  it('calls /api/tasks with workspaceId query param', async () => {
    const mock = mockFetch(200, []);
    vi.stubGlobal('fetch', mock);

    const result = await getTasks('ws-1');

    const [url] = mock.mock.calls[0]!;
    expect(url).toBe('/api/tasks?workspaceId=ws-1');
    expect(result).toEqual([]);

    vi.unstubAllGlobals();
  });
});

describe('getOperators', () => {
  it('calls /api/operators with workspaceId query param', async () => {
    const mock = mockFetch(200, [{ id: 'op1', name: 'CTO', role: 'tech', goal: 'Build' }]);
    vi.stubGlobal('fetch', mock);

    const result = await getOperators('ws-5');

    const [url] = mock.mock.calls[0]!;
    expect(url).toBe('/api/operators?workspaceId=ws-5');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('CTO');

    vi.unstubAllGlobals();
  });
});

describe('getProfile', () => {
  it('calls /api/founder/:workspaceId', async () => {
    const profile = {
      id: 'fp-1',
      name: 'Alice',
      background: 'Engineer',
      experience: '5yr',
      interests: ['AI'],
    };
    const mock = mockFetch(200, profile);
    vi.stubGlobal('fetch', mock);

    const result = await getProfile('ws-7');

    const [url] = mock.mock.calls[0]!;
    expect(url).toBe('/api/founder/ws-7');
    expect(result).toEqual(profile);

    vi.unstubAllGlobals();
  });

  it('returns null on error', async () => {
    const mock = mockFetch(404, 'Not Found');
    vi.stubGlobal('fetch', mock);

    const result = await getProfile('ws-nonexistent');
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe('session rotation', () => {
  it('picks up X-New-Token and uses it in next request', async () => {
    const mock1 = mockFetch(200, [], { 'X-New-Token': 'rotated-tok' });
    vi.stubGlobal('fetch', mock1);

    setAuthToken('old-tok');
    await getTasks('ws-1');

    // Next request should use rotated token
    const mock2 = mockFetch(200, []);
    vi.stubGlobal('fetch', mock2);

    await getTasks('ws-1');

    const [, init] = mock2.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer rotated-tok');

    vi.unstubAllGlobals();
  });
});

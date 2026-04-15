import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must import after setup.ts mocks are applied
let apiFetch: typeof import('../../lib/api').apiFetch;
let getWorkspaceId: typeof import('../../lib/api').getWorkspaceId;
let isAuthenticated: typeof import('../../lib/api').isAuthenticated;
let logout: typeof import('../../lib/api').logout;

beforeEach(async () => {
  // Re-import to get fresh module with mocked globals
  const mod = await import('../../lib/api.js');
  apiFetch = mod.apiFetch;
  getWorkspaceId = mod.getWorkspaceId;
  isAuthenticated = mod.isAuthenticated;
  logout = mod.logout;
});

describe('apiFetch', () => {
  it('adds Bearer token from localStorage', async () => {
    localStorage.setItem('helm_token', 'test-token-123');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }),
    );

    await apiFetch('/api/test');

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer test-token-123');
  });

  it('works without token', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: 1 }), { headers: { 'content-type': 'application/json' } }),
    );

    const result = await apiFetch('/api/test');
    expect(result).toEqual({ data: 1 });
  });

  it('redirects to /login on 401', async () => {
    localStorage.setItem('helm_token', 'expired');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    const result = await apiFetch('/api/protected');

    expect(result).toBeNull();
    expect(localStorage.getItem('helm_token')).toBeNull();
    expect(globalThis.location.href).toBe('/login');
  });

  it('returns null on 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 401 }),
    );
    const result = await apiFetch('/api/test');
    expect(result).toBeNull();
  });

  it('returns JSON on success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ users: [1, 2] }), { headers: { 'content-type': 'application/json' } }),
    );

    const result = await apiFetch<{ users: number[] }>('/api/users');
    expect(result).toEqual({ users: [1, 2] });
  });

  it('returns null for non-JSON responses', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    const result = await apiFetch('/api/health');
    expect(result).toBeNull();
  });
});

describe('getWorkspaceId', () => {
  it('parses workspace ID from localStorage', () => {
    localStorage.setItem('helm_workspace', JSON.stringify({ id: 'ws-123', name: 'Test' }));
    expect(getWorkspaceId()).toBe('ws-123');
  });

  it('returns null when not set', () => {
    expect(getWorkspaceId()).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    localStorage.setItem('helm_workspace', 'not-json');
    expect(getWorkspaceId()).toBeNull();
  });

  it('returns null when id is missing', () => {
    localStorage.setItem('helm_workspace', JSON.stringify({ name: 'Test' }));
    expect(getWorkspaceId()).toBeNull();
  });
});

describe('isAuthenticated', () => {
  it('returns true when token exists', () => {
    localStorage.setItem('helm_token', 'abc');
    expect(isAuthenticated()).toBe(true);
  });

  it('returns false without token', () => {
    expect(isAuthenticated()).toBe(false);
  });
});

describe('logout', () => {
  it('removes all auth keys and redirects to /login', () => {
    localStorage.setItem('helm_token', 'abc');
    localStorage.setItem('helm_workspace', '{}');
    localStorage.setItem('helm_user', '{}');

    logout();

    expect(localStorage.getItem('helm_token')).toBeNull();
    expect(localStorage.getItem('helm_workspace')).toBeNull();
    expect(localStorage.getItem('helm_user')).toBeNull();
    expect(globalThis.location.href).toBe('/login');
  });
});

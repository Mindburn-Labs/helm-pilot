'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Authenticated fetch wrapper. Uses HttpOnly session cookies and adds
 * workspace + CSRF headers from browser-local, non-secret state.
 * Returns null and redirects to /login on 401.
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  const workspaceId = typeof window !== 'undefined' ? getWorkspaceId() : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (workspaceId && path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
    headers['X-Workspace-Id'] = workspaceId;
  }
  const csrfToken = typeof document !== 'undefined' ? readCookie('helm_csrf') : null;
  if (csrfToken && isMutatingRequest(options?.method)) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    credentials: options?.credentials ?? 'include',
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('helm_token');
      localStorage.removeItem('helm_workspace');
      window.location.href = '/login';
    }
    return null;
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    return null;
  }
  return response.json() as Promise<T>;
}

export function getWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const ws = localStorage.getItem('helm_workspace');
    if (!ws) return null;
    const parsed = JSON.parse(ws);
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('helm_user');
}

export function logout() {
  const csrfToken = typeof document !== 'undefined' ? readCookie('helm_csrf') : null;
  void fetch(`${API}/api/auth/session`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
  }).catch(() => {});
  localStorage.removeItem('helm_token');
  localStorage.removeItem('helm_workspace');
  localStorage.removeItem('helm_user');
  window.location.href = '/login';
}

export { API };

function isMutatingRequest(method?: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes((method ?? 'GET').toUpperCase());
}

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Authenticated fetch wrapper. Adds Bearer token from localStorage.
 * Returns null and redirects to /login on 401.
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('helm_token') : null;
  const workspaceId = typeof window !== 'undefined' ? getWorkspaceId() : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (workspaceId && path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
    headers['X-Workspace-Id'] = workspaceId;
  }

  const response = await fetch(`${API}${path}`, { ...options, headers });

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
  return !!localStorage.getItem('helm_token');
}

export function logout() {
  localStorage.removeItem('helm_token');
  localStorage.removeItem('helm_workspace');
  localStorage.removeItem('helm_user');
  window.location.href = '/login';
}

export { API };

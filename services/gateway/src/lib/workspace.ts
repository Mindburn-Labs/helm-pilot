import { type Context } from 'hono';

export function getWorkspaceId(c: Context): string | undefined {
  return (c.get('workspaceId') as string | undefined) ?? undefined;
}

export function requireWorkspaceId(c: Context): string {
  const workspaceId = getWorkspaceId(c);
  if (!workspaceId) {
    throw new Error('workspaceId required');
  }
  return workspaceId;
}

export function workspaceIdMismatch(c: Context, candidate: unknown): boolean {
  const workspaceId = getWorkspaceId(c);
  return typeof candidate === 'string' && !!workspaceId && candidate !== workspaceId;
}

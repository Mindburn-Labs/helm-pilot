import { type Context } from 'hono';

export function getWorkspaceId(c: Context): string | undefined {
  return (c.get('workspaceId') as string | undefined) ?? c.req.query('workspaceId') ?? c.req.header('X-Workspace-Id') ?? undefined;
}

export function requireWorkspaceId(c: Context): string {
  const workspaceId = getWorkspaceId(c);
  if (!workspaceId) {
    throw new Error('workspaceId required');
  }
  return workspaceId;
}

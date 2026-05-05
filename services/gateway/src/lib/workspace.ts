import { type Context } from 'hono';
import { WorkspaceRoleSchema, type WorkspaceRole } from '@pilot/shared/schemas';

const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  member: 1,
  partner: 2,
  owner: 3,
};

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

export function getWorkspaceRole(c: Context): WorkspaceRole | undefined {
  const parsed = WorkspaceRoleSchema.safeParse(c.get('workspaceRole'));
  return parsed.success ? parsed.data : undefined;
}

export function requireWorkspaceRole(
  c: Context,
  minimumRole: WorkspaceRole,
  action = 'perform this action',
): Response | null {
  const workspaceId = getWorkspaceId(c);
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

  const role = getWorkspaceRole(c);
  if (!role || WORKSPACE_ROLE_RANK[role] < WORKSPACE_ROLE_RANK[minimumRole]) {
    return c.json(
      {
        error: 'insufficient workspace role',
        action,
        requiredRole: minimumRole,
        currentRole: role ?? null,
      },
      403,
    );
  }

  return null;
}

export function workspaceIdMismatch(c: Context, candidate: unknown): boolean {
  const workspaceId = getWorkspaceId(c);
  return typeof candidate === 'string' && !!workspaceId && candidate !== workspaceId;
}

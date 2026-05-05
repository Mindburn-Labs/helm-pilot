import { type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { type Db } from '@pilot/db/client';
import { operators } from '@pilot/db/schema';
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

export async function workspaceOperatorBelongsToWorkspace(
  db: Db,
  workspaceId: string,
  operatorId?: string | null,
): Promise<boolean> {
  if (!operatorId) return true;
  const [operator] = await db
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(operator);
}

export async function requireWorkspaceOperator(
  db: Db,
  c: Context,
  workspaceId: string,
  operatorId?: string | null,
): Promise<Response | null> {
  if (await workspaceOperatorBelongsToWorkspace(db, workspaceId, operatorId)) return null;
  return c.json({ error: 'operatorId does not belong to authenticated workspace' }, 403);
}

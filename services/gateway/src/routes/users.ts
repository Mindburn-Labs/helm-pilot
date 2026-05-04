import { Hono } from 'hono';
import { eq, and, inArray, not } from 'drizzle-orm';
import { users, workspaces, workspaceMembers } from '@pilot/db/schema';
import { type GatewayDeps } from '../index.js';
import { createLogger } from '@pilot/shared/logger';

const log = createLogger('users');

export function userRoutes(deps: GatewayDeps) {
  const app = new Hono();

  // DELETE /api/users/me — GDPR right-to-erasure.
  //
  // Deletes the authenticated user and cascades to their sessions, api_keys,
  // and workspace memberships. Additionally, any workspace where the user is
  // the SOLE member is deleted (cascades to its tasks, operators, etc.).
  app.delete('/me', async (c) => {
    const userId = c.get('userId');
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    // 1. Find workspaces where this user is the only member — these become orphaned.
    const memberships = await deps.db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));

    const soloWorkspaces: string[] = [];
    for (const m of memberships) {
      const others = await deps.db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, m.workspaceId),
            not(eq(workspaceMembers.userId, userId)),
          ),
        );
      if (others.length === 0) {
        soloWorkspaces.push(m.workspaceId);
      }
    }

    // 2. Delete those workspaces (cascades to tasks, operators, audit_log, etc.).
    if (soloWorkspaces.length > 0) {
      await deps.db.delete(workspaces).where(inArray(workspaces.id, soloWorkspaces));
    }

    // 3. Delete the user (cascades to sessions, api_keys, remaining workspace_members).
    await deps.db.delete(users).where(eq(users.id, userId));

    log.warn({ userId, deletedWorkspaces: soloWorkspaces.length }, 'User deleted (GDPR erasure)');

    return c.json({
      deleted: true,
      deletedWorkspaces: soloWorkspaces.length,
    });
  });

  return app;
}

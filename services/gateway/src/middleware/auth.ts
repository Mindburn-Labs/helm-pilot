import { type Context, type Next } from 'hono';
import { eq, and, gt } from 'drizzle-orm';
import { sessions, apiKeys, workspaceMembers } from '@helm-pilot/db/schema';
import { type Db } from '@helm-pilot/db/client';
import { createHash, randomBytes } from 'node:crypto';

const ROTATION_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Auth context stored per-request via Hono's c.set/c.get ───
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    workspaceId: string;
  }
}

/**
 * requireAuth middleware — checks Bearer token (session) or X-API-Key header.
 * Sets userId and workspaceId on the Hono context.
 * Returns 401 if neither is valid.
 */
export function requireAuth(db: Db) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const apiKeyHeader = c.req.header('X-API-Key');

    let userId: string | undefined;

    // Try session token first
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const [sess] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
        .limit(1);
      if (sess) {
        userId = sess.userId;
        // Session rotation: if session is > 24h old, issue new token
        const sessionAge = Date.now() - new Date(sess.createdAt).getTime();
        if (sessionAge > ROTATION_THRESHOLD_MS) {
          const newToken = generateToken();
          const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          // Create new session, delete old (fire-and-forget)
          db.insert(sessions)
            .values({
              userId: sess.userId,
              token: newToken,
              channel: sess.channel,
              expiresAt: newExpiry,
            })
            .then(() => db.delete(sessions).where(eq(sessions.id, sess.id)))
            .then(() => {})
            .catch(() => {});
          c.header('X-New-Token', newToken);
        }
      }
    }

    // Fall back to API key
    if (!userId && apiKeyHeader) {
      const hash = hashApiKey(apiKeyHeader);
      const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
      if (key && (!key.expiresAt || key.expiresAt > new Date())) {
        userId = key.userId;
        // Update last used (fire-and-forget)
        db.update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.id))
          .then(() => {});
      }
    }

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Resolve workspace membership
    const workspaceId = c.req.query('workspaceId') ?? c.req.header('X-Workspace-Id');
    if (workspaceId) {
      const [membership] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)),
        )
        .limit(1);
      if (!membership) {
        return c.json({ error: 'Not a member of this workspace' }, 403);
      }
      c.set('workspaceId', workspaceId);
    }

    c.set('userId', userId);
    await next();
  };
}

// ─── Helpers ───

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateApiKey(): string {
  return `hp_${randomBytes(24).toString('hex')}`;
}

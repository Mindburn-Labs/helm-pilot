import { type Context, type Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { eq, and, gt } from 'drizzle-orm';
import { sessions, apiKeys, workspaceMembers } from '@pilot/db/schema';
import { type Db } from '@pilot/db/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ROTATION_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = 'helm_session';
export const CSRF_COOKIE_NAME = 'helm_csrf';

// ─── Auth context stored per-request via Hono's c.set/c.get ───
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    workspaceId: string;
    workspaceRole: string;
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
    const cookieToken = getCookie(c, SESSION_COOKIE_NAME);

    let userId: string | undefined;
    let authenticatedViaCookie = false;

    // Try session token first
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const sessionToken = bearerToken ?? cookieToken;
    if (sessionToken) {
      const [sess] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.token, sessionToken), gt(sessions.expiresAt, new Date())))
        .limit(1);
      if (sess) {
        userId = sess.userId;
        authenticatedViaCookie = !bearerToken && sessionToken === cookieToken;
        if (authenticatedViaCookie && isMutatingRequest(c.req.method) && !hasValidCsrf(c)) {
          return c.json({ error: 'CSRF token invalid' }, 403);
        }
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
          if (authenticatedViaCookie) {
            setSessionCookies(c, newToken, newExpiry);
          }
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
      c.set('workspaceRole', membership.role);
    }

    c.set('userId', userId);
    await next();
  };
}

// ─── Helpers ───

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function setSessionCookies(c: Context, token: string, expiresAt: Date): string {
  const csrfToken = generateToken();
  const secure = process.env['NODE_ENV'] === 'production';
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
    maxAge: SESSION_TTL_SECONDS,
  });
  setCookie(c, CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
    maxAge: SESSION_TTL_SECONDS,
  });
  return csrfToken;
}

export function clearSessionCookies(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  deleteCookie(c, CSRF_COOKIE_NAME, { path: '/' });
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateApiKey(): string {
  return `hp_${randomBytes(24).toString('hex')}`;
}

function isMutatingRequest(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function hasValidCsrf(c: Context): boolean {
  const cookieToken = getCookie(c, CSRF_COOKIE_NAME);
  const headerToken = c.req.header('X-CSRF-Token');
  if (!cookieToken || !headerToken) return false;
  const left = Buffer.from(cookieToken);
  const right = Buffer.from(headerToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

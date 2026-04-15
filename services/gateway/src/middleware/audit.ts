import { type Context, type Next } from 'hono';
import { auditLog } from '@helm-pilot/db/schema';
import { type Db } from '@helm-pilot/db/client';

/**
 * Audit middleware — logs every mutating API request (POST, PUT, DELETE)
 * to the audit_log table with userId, path, status code, and timestamp.
 */
export function auditMiddleware(db: Db) {
  return async (c: Context, next: Next) => {
    await next();

    const method = c.req.method;
    if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return;

    const userId = c.get('userId') as string | undefined;
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.query('workspaceId') ?? c.req.header('X-Workspace-Id') ?? undefined;

    // Fire-and-forget — never block the response
    db.insert(auditLog)
      .values({
        workspaceId: workspaceId ?? null,
        action: `${method} ${c.req.path}`,
        actor: userId ?? 'anonymous',
        target: c.req.path,
        verdict: c.res.status < 400 ? 'allow' : 'deny',
        reason: c.res.status < 400 ? 'ok' : `status ${c.res.status}`,
        metadata: { method, path: c.req.path, status: c.res.status },
      })
      .then(() => {})
      .catch(() => {});
  };
}

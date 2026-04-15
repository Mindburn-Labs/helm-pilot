import { type MiddlewareHandler } from 'hono';

/**
 * Body size limit middleware.
 *
 * Checks `Content-Length` before reading the body. Returns 413 if oversized.
 * This is defense-in-depth: Hono's default parser has its own limits but
 * different node-server runtimes can bypass them.
 *
 * Usage:
 *   app.use('*', bodyLimit(1_000_000))           // 1MB global
 *   app.use('/api/auth/*', bodyLimit(100_000))   // 100KB on auth
 *   app.use('/api/uploads/*', bodyLimit(10_000_000)) // 10MB on uploads
 */
export function bodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    // GET / HEAD / DELETE / OPTIONS: no body, skip
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE' || method === 'OPTIONS') {
      return next();
    }
    const len = c.req.header('content-length');
    if (len !== undefined) {
      const size = parseInt(len, 10);
      if (!Number.isNaN(size) && size > maxBytes) {
        return c.json({ error: 'Request body too large', maxBytes }, 413);
      }
    }
    return next();
  };
}

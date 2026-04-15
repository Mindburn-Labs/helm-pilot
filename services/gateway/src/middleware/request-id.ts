import { type MiddlewareHandler } from 'hono';
import { randomUUID } from 'node:crypto';

/**
 * Request ID middleware — generates or propagates a unique request ID.
 *
 * Sets `X-Request-Id` response header. If the incoming request already has
 * an `X-Request-Id` header (e.g., from a load balancer), it is reused.
 *
 * The ID is also stored in the Hono context for use by downstream middleware
 * (logging, audit, error reporting).
 */
export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header('X-Request-Id') ?? randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  };
}

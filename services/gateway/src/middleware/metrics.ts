import { type MiddlewareHandler } from 'hono';
import client from 'prom-client';

// ─── Metrics Registry ───

const register = new client.Registry();

// Collect default Node.js metrics (event loop lag, memory, CPU)
client.collectDefaultMetrics({ register, prefix: 'helm_pilot_' });

// ─── Custom Metrics ───

const httpRequestDuration = new client.Histogram({
  name: 'helm_pilot_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'helm_pilot_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

const httpRequestErrors = new client.Counter({
  name: 'helm_pilot_http_errors_total',
  help: 'Total number of HTTP errors (4xx and 5xx)',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const activeConnections = new client.Gauge({
  name: 'helm_pilot_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

export const jobQueueDepth = new client.Gauge({
  name: 'helm_pilot_job_queue_depth',
  help: 'Number of pending background jobs',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const activeSessions = new client.Gauge({
  name: 'helm_pilot_active_sessions',
  help: 'Number of active user sessions',
  registers: [register],
});

export const llmTokensTotal = new client.Counter({
  name: 'helm_pilot_llm_tokens_total',
  help: 'Total LLM tokens consumed',
  labelNames: ['direction', 'model'] as const,
  registers: [register],
});

// ─── Middleware ───

/**
 * Normalize route paths to avoid high-cardinality labels.
 * Replaces UUIDs and numeric IDs with :id placeholder.
 */
function normalizeRoute(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id');
}

/**
 * Prometheus metrics middleware — records request duration, counts, and errors.
 */
export function metricsMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    activeConnections.inc();
    const end = httpRequestDuration.startTimer();

    await next();

    const route = normalizeRoute(c.req.path);
    const method = c.req.method;
    const statusCode = String(c.res.status);
    const labels = { method, route, status_code: statusCode };

    end(labels);
    httpRequestsTotal.inc(labels);
    activeConnections.dec();

    if (c.res.status >= 400) {
      httpRequestErrors.inc(labels);
    }
  };
}

/**
 * Serve Prometheus metrics at the given path.
 * Returns text/plain in Prometheus exposition format.
 */
export function metricsEndpoint(): MiddlewareHandler {
  return async (c) => {
    const metrics = await register.metrics();
    return c.text(metrics, 200, {
      'Content-Type': register.contentType,
    });
  };
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * Connection pool configuration.
 *
 * postgres.js manages a pool internally. These settings prevent
 * connection exhaustion, detect stale connections, and bound memory.
 */
const POOL_DEFAULTS = {
  /** Maximum simultaneous connections (postgres.js default is 10) */
  max: parseInt(process.env['DB_POOL_MAX'] ?? '20', 10),
  /** Seconds a connection can sit idle before being closed */
  idle_timeout: parseInt(process.env['DB_IDLE_TIMEOUT'] ?? '30', 10),
  /** Seconds to wait for a connection before throwing */
  connect_timeout: parseInt(process.env['DB_CONNECT_TIMEOUT'] ?? '10', 10),
  /** Maximum seconds a connection can live (prevents long-lived stale conns) */
  max_lifetime: parseInt(process.env['DB_MAX_LIFETIME'] ?? '3600', 10),
} as const;

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: POOL_DEFAULTS.max,
    idle_timeout: POOL_DEFAULTS.idle_timeout,
    connect_timeout: POOL_DEFAULTS.connect_timeout,
    max_lifetime: POOL_DEFAULTS.max_lifetime,
    // Prepare statements for repeated queries (performance)
    prepare: true,
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>['db'];

import { serve } from '@hono/node-server';
import { createDb } from '@pilot/db/client';
import { MemoryService } from '@pilot/memory';
import { createLogger } from '@pilot/shared/logger';
import { createMcpApp } from './app.js';

// ─── Standalone Pilot MCP server (Phase 14 Track A) ───
//
// Boot sequence:
//   1. Read env: DATABASE_URL (required),
//      MCP_SERVER_ACCESS_TOKEN (required — refuses to boot without it),
//      MCP_SERVER_PORT (default 3200),
//      MCP_SERVER_PUBLIC_URL (default http://pilot-mcp:3200)
//   2. Connect DB + memory service.
//   3. Build Hono app, expose /mcp, /mcp/health,
//      /.well-known/oauth-protected-resource.
//   4. Listen. Emit startup log. Shut down on SIGTERM/SIGINT.

async function main() {
  const log = createLogger('mcp-server');

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }
  const bearer = process.env['MCP_SERVER_ACCESS_TOKEN'];
  if (!bearer || bearer.length < 16) {
    log.error(
      'MCP_SERVER_ACCESS_TOKEN must be set (>=16 chars). Refusing to boot anonymously.',
    );
    process.exit(1);
  }
  const port = Number(process.env['MCP_SERVER_PORT'] ?? '3200');
  const publicBaseUrl =
    process.env['MCP_SERVER_PUBLIC_URL'] ?? `http://pilot-mcp:${port}`;

  const { db, close } = createDb(databaseUrl);
  const memory = new MemoryService(db);

  const app = createMcpApp({
    db,
    memory,
    bearerToken: bearer,
    publicBaseUrl,
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    log.info({ port: info.port, publicBaseUrl }, 'Pilot MCP server listening');
  });

  const shutdown = async () => {
    log.info('Shutting down MCP server');
    server.close();
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

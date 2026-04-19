import { describe, expect, it } from 'vitest';
import type { Db } from '@helm-pilot/db/client';
import { createMcpApp } from '../app.js';

// ─── Pilot MCP provider app tests (Phase 14 Track A) ───
//
// Exercises initialize / tools/list / auth errors purely through
// Hono's `app.fetch(new Request(...))` — no real DB, no real port.

const BEARER = 'test-token-1234567890abcdef';
const dbStub = {} as unknown as Db;

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://test.local/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('createMcpApp', () => {
  const app = createMcpApp({ db: dbStub, bearerToken: BEARER });

  it('GET /mcp/health returns tool count', async () => {
    const res = await app.fetch(new Request('http://test.local/mcp/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tools: number };
    expect(body.ok).toBe(true);
    expect(body.tools).toBeGreaterThan(0);
  });

  it('GET /.well-known/oauth-protected-resource returns metadata', async () => {
    const res = await app.fetch(
      new Request('http://test.local/.well-known/oauth-protected-resource'),
    );
    expect(res.status).toBe(200);
    const meta = (await res.json()) as {
      resource: string;
      bearer_methods_supported: string[];
    };
    expect(meta.resource).toMatch(/\/mcp$/);
    expect(meta.bearer_methods_supported).toContain('header');
  });

  it('rejects missing Authorization header with 401', async () => {
    const res = await app.fetch(
      post({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects wrong bearer token with 401', async () => {
    const res = await app.fetch(
      post(
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { authorization: 'Bearer wrong-token-1234567890' },
      ),
    );
    expect(res.status).toBe(401);
  });

  it('initialize returns MCP 2025-11-25 server info', async () => {
    const res = await app.fetch(
      post(
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { authorization: `Bearer ${BEARER}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jsonrpc: string;
      id: number;
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2025-11-25');
    expect(body.result.serverInfo.name).toBe('helm-pilot-mcp');
  });

  it('tools/list returns the DB-only whitelist', async () => {
    const res = await app.fetch(
      post(
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { authorization: `Bearer ${BEARER}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain('list_opportunities');
    expect(names).toContain('search_knowledge');
    expect(names).toContain('get_workspace_context');
    expect(names).toContain('create_task');
    expect(names).toContain('create_artifact');
    expect(names).not.toContain('github_create_repo'); // intentionally excluded
  });

  it('tools/call on unknown tool returns JSON-RPC error -32601', async () => {
    const res = await app.fetch(
      post(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'no_such_tool', arguments: {} },
        },
        { authorization: `Bearer ${BEARER}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      error: { code: number; message: string };
    };
    expect(body.error.code).toBe(-32601);
  });

  it('malformed JSON returns -32700', async () => {
    const res = await app.fetch(
      new Request('http://test.local/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${BEARER}`,
        },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it('unknown method returns -32601', async () => {
    const res = await app.fetch(
      post(
        { jsonrpc: '2.0', id: 9, method: 'resources/list' },
        { authorization: `Bearer ${BEARER}` },
      ),
    );
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it('server with no bearer token configured refuses with 503', async () => {
    const noAuth = createMcpApp({ db: dbStub, bearerToken: undefined });
    const res = await noAuth.fetch(
      post(
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { authorization: 'Bearer anything' },
      ),
    );
    expect(res.status).toBe(503);
  });
});

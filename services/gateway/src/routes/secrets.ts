import { Hono } from 'hono';
import { TenantSecretStore } from '@pilot/db/tenant-secret-store';
import { SECRET_KINDS, type SecretKind, SecretDecryptionError } from '@pilot/shared/secrets';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole } from '../lib/workspace.js';

/**
 * Per-tenant secret management.
 *
 * Every endpoint is workspace-scoped — the caller's workspace context comes
 * from `requireAuth` and is verified on each write. Plaintext bodies are
 * accepted on `PUT` but never returned by GET; reads only expose metadata.
 *
 * Allowed kinds include the canonical list plus any `custom_<string>`
 * variant so connectors can register ad-hoc secrets at the cost of a
 * one-line update to the connector's own code.
 */
export function secretsRoutes(deps: GatewayDeps) {
  const app = new Hono();
  const store = new TenantSecretStore(deps.db);

  // GET /api/workspace/secrets — list kinds + metadata, no plaintexts.
  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'inspect workspace secret metadata');
    if (roleDenied) return roleDenied;
    const rows = await store.list(workspaceId);
    return c.json({ secrets: rows });
  });

  // PUT /api/workspace/secrets/:kind — set (or overwrite) a secret.
  //
  // Body: { value: string, expiresAt?: ISO string }
  // Validates `kind` against the canonical enum unless it starts with
  // `custom_` to allow connector extensibility without a deploy.
  app.put('/:kind', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'write workspace secrets');
    if (roleDenied) return roleDenied;

    const kind = c.req.param('kind') as SecretKind;
    if (!isValidKind(kind)) {
      return c.json({ error: `Unknown kind '${kind}' — must be canonical or start with 'custom_'` }, 400);
    }

    const body = (await c.req.json().catch(() => null)) as { value?: unknown; expiresAt?: string } | null;
    if (!body || typeof body.value !== 'string' || body.value.length === 0) {
      return c.json({ error: 'body.value (string, non-empty) is required' }, 400);
    }
    if (body.value.length > 10_000) {
      return c.json({ error: 'value too long (10 KB max)' }, 400);
    }
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return c.json({ error: 'expiresAt must be an ISO-8601 date' }, 400);
    }

    await store.set(workspaceId, kind, body.value, { expiresAt });
    return c.json({ stored: true, kind, expiresAt: expiresAt?.toISOString() ?? null });
  });

  // DELETE /api/workspace/secrets/:kind
  app.delete('/:kind', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'delete workspace secrets');
    if (roleDenied) return roleDenied;
    const kind = c.req.param('kind') as SecretKind;
    const deleted = await store.delete(workspaceId, kind);
    if (!deleted) return c.json({ error: 'Secret not found' }, 404);
    return c.json({ deleted: true });
  });

  // POST /api/workspace/secrets/:kind/verify
  //
  // Attempts a decryption round-trip and reports ok/failure. Used by the
  // Mini App / web dashboard to surface "looks like your master key rotated
  // without a re-encrypt" before the founder hits a runtime auth-tag error.
  app.post('/:kind/verify', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'verify workspace secrets');
    if (roleDenied) return roleDenied;
    const kind = c.req.param('kind') as SecretKind;
    try {
      const value = await store.get(workspaceId, kind);
      if (value === null) return c.json({ ok: false, reason: 'not_found' }, 404);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof SecretDecryptionError) {
        return c.json({ ok: false, reason: 'decryption_failed' }, 422);
      }
      throw err;
    }
  });

  return app;
}

function isValidKind(kind: string): kind is SecretKind {
  if (kind.startsWith('custom_') && kind.length > 'custom_'.length) return true;
  return (SECRET_KINDS as readonly string[]).includes(kind);
}

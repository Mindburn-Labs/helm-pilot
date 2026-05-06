import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { appendEvidenceItem } from '@pilot/db';
import { auditLog } from '@pilot/db/schema';
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
      return c.json(
        { error: `Unknown kind '${kind}' — must be canonical or start with 'custom_'` },
        400,
      );
    }

    const body = (await c.req.json().catch(() => null)) as {
      value?: unknown;
      expiresAt?: string;
    } | null;
    if (!body || typeof body.value !== 'string' || body.value.length === 0) {
      return c.json({ error: 'body.value (string, non-empty) is required' }, 400);
    }
    if (body.value.length > 10_000) {
      return c.json({ error: 'value too long (10 KB max)' }, 400);
    }
    const secretValue = body.value;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return c.json({ error: 'expiresAt must be an ISO-8601 date' }, 400);
    }

    const stored = await deps.db
      .transaction(async (tx) => {
        const txStore = new TenantSecretStore(tx as never);
        await txStore.set(workspaceId, kind, secretValue, { expiresAt });

        const auditEventId = randomUUID();
        const replayRef = `workspace-secret:${workspaceId}:${kind}:set`;
        const evidenceMetadata = {
          kind,
          expiresAt: expiresAt?.toISOString() ?? null,
          plaintextStoredInEvidence: false,
        };

        await tx.insert(auditLog).values({
          id: auditEventId,
          workspaceId,
          action: 'WORKSPACE_SECRET_SET',
          actor: `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`,
          target: kind,
          verdict: 'allow',
          metadata: {
            evidenceType: 'workspace_secret_set',
            replayRef,
            ...evidenceMetadata,
          },
        });

        const evidenceItemId = await appendEvidenceItem(tx, {
          workspaceId,
          auditEventId,
          evidenceType: 'workspace_secret_set',
          sourceType: 'gateway_secrets',
          title: `Workspace secret set: ${kind}`,
          summary: 'Workspace secret metadata changed; plaintext was not stored in evidence.',
          redactionState: 'redacted',
          sensitivity: 'restricted',
          replayRef,
          metadata: evidenceMetadata,
        });

        await tx
          .update(auditLog)
          .set({
            metadata: {
              evidenceType: 'workspace_secret_set',
              replayRef,
              evidenceItemId,
              ...evidenceMetadata,
            },
          })
          .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.id, auditEventId)));

        return true;
      })
      .catch(() => false);

    if (!stored) return c.json({ error: 'failed to persist workspace secret evidence' }, 500);
    return c.json({ stored: true, kind, expiresAt: expiresAt?.toISOString() ?? null });
  });

  // DELETE /api/workspace/secrets/:kind
  app.delete('/:kind', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'delete workspace secrets');
    if (roleDenied) return roleDenied;
    const kind = c.req.param('kind') as SecretKind;
    const deleted = await deps.db
      .transaction(async (tx) => {
        const txStore = new TenantSecretStore(tx as never);
        const removed = await txStore.delete(workspaceId, kind);
        if (!removed) return false;

        const auditEventId = randomUUID();
        const replayRef = `workspace-secret:${workspaceId}:${kind}:deleted`;
        const evidenceMetadata = {
          kind,
          plaintextStoredInEvidence: false,
        };

        await tx.insert(auditLog).values({
          id: auditEventId,
          workspaceId,
          action: 'WORKSPACE_SECRET_DELETED',
          actor: `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`,
          target: kind,
          verdict: 'allow',
          metadata: {
            evidenceType: 'workspace_secret_deleted',
            replayRef,
            ...evidenceMetadata,
          },
        });

        const evidenceItemId = await appendEvidenceItem(tx, {
          workspaceId,
          auditEventId,
          evidenceType: 'workspace_secret_deleted',
          sourceType: 'gateway_secrets',
          title: `Workspace secret deleted: ${kind}`,
          summary: 'Workspace secret was deleted; plaintext was not stored in evidence.',
          redactionState: 'redacted',
          sensitivity: 'restricted',
          replayRef,
          metadata: evidenceMetadata,
        });

        await tx
          .update(auditLog)
          .set({
            metadata: {
              evidenceType: 'workspace_secret_deleted',
              replayRef,
              evidenceItemId,
              ...evidenceMetadata,
            },
          })
          .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.id, auditEventId)));

        return true;
      })
      .catch(() => null);

    if (deleted === null) {
      return c.json({ error: 'failed to persist workspace secret evidence' }, 500);
    }
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

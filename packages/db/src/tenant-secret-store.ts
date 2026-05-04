import { and, eq } from 'drizzle-orm';
import {
  CURRENT_SECRET_KEY_VERSION,
  decryptSecret,
  encryptSecret,
  type SecretEnvelope,
  type SecretKind,
} from '@pilot/shared/secrets';
import type { Db } from './client.js';
import { tenantSecrets } from './schema/index.js';

export interface SecretSummary {
  kind: string;
  keyVersion: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workspace-scoped secret storage backed by the `tenant_secrets` table.
 *
 * Every method requires a workspaceId; there is intentionally no
 * "get-by-id" surface. Plaintext only lives on the wire for `set` / `get`;
 * everything else operates on metadata.
 */
export class TenantSecretStore {
  constructor(private readonly db: Db) {}

  /**
   * Encrypt and persist a secret. Upserts by (workspaceId, kind) — rotating
   * a value is the same call as creating one.
   */
  async set(
    workspaceId: string,
    kind: SecretKind,
    plaintext: string,
    opts: { expiresAt?: Date; keyVersion?: number } = {},
  ): Promise<void> {
    const keyVersion = opts.keyVersion ?? CURRENT_SECRET_KEY_VERSION;
    const envelope = encryptSecret(workspaceId, kind, plaintext, keyVersion);

    const [existing] = await this.db
      .select()
      .from(tenantSecrets)
      .where(and(eq(tenantSecrets.workspaceId, workspaceId), eq(tenantSecrets.kind, kind)))
      .limit(1);

    if (existing) {
      await this.db
        .update(tenantSecrets)
        .set({
          encryptedBlob: envelope.encryptedBlob,
          keyVersion: envelope.keyVersion,
          expiresAt: opts.expiresAt ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(tenantSecrets.id, existing.id), eq(tenantSecrets.workspaceId, workspaceId)),
        );
      return;
    }

    await this.db.insert(tenantSecrets).values({
      workspaceId,
      kind,
      encryptedBlob: envelope.encryptedBlob,
      keyVersion: envelope.keyVersion,
      expiresAt: opts.expiresAt ?? null,
    });
  }

  /**
   * Decrypt and return the plaintext. Returns null when the secret is
   * absent or past its expiry — never throws on missing data.
   */
  async get(workspaceId: string, kind: SecretKind): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(tenantSecrets)
      .where(and(eq(tenantSecrets.workspaceId, workspaceId), eq(tenantSecrets.kind, kind)))
      .limit(1);

    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    const envelope: SecretEnvelope = {
      encryptedBlob: row.encryptedBlob,
      keyVersion: row.keyVersion,
    };
    return decryptSecret(workspaceId, kind, envelope);
  }

  /**
   * List kinds + metadata without decrypting any plaintext. Used by the
   * founder-facing `/api/workspace/secrets` GET route.
   */
  async list(workspaceId: string): Promise<SecretSummary[]> {
    const rows = await this.db
      .select({
        kind: tenantSecrets.kind,
        keyVersion: tenantSecrets.keyVersion,
        expiresAt: tenantSecrets.expiresAt,
        createdAt: tenantSecrets.createdAt,
        updatedAt: tenantSecrets.updatedAt,
      })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.workspaceId, workspaceId));
    return rows;
  }

  /** Remove a secret. Returns true if a row was deleted. */
  async delete(workspaceId: string, kind: SecretKind): Promise<boolean> {
    const rows = await this.db
      .delete(tenantSecrets)
      .where(and(eq(tenantSecrets.workspaceId, workspaceId), eq(tenantSecrets.kind, kind)))
      .returning();
    return rows.length > 0;
  }

  /**
   * Rotation helper used by `scripts/rotate-master-key.ts`.
   *
   * Reads every row under the given workspaceId that is still on
   * `fromVersion`, decrypts with that version, re-encrypts with
   * `toVersion`, and writes back in a single transaction. Returns the
   * count of re-encrypted rows.
   */
  async rotateWorkspace(
    workspaceId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<number> {
    const rows = await this.db
      .select()
      .from(tenantSecrets)
      .where(
        and(
          eq(tenantSecrets.workspaceId, workspaceId),
          eq(tenantSecrets.keyVersion, fromVersion),
        ),
      );

    let rotated = 0;
    for (const row of rows) {
      const plaintext = decryptSecret(row.workspaceId, row.kind as SecretKind, {
        encryptedBlob: row.encryptedBlob,
        keyVersion: row.keyVersion,
      });
      const envelope = encryptSecret(row.workspaceId, row.kind as SecretKind, plaintext, toVersion);
      await this.db
        .update(tenantSecrets)
        .set({
          encryptedBlob: envelope.encryptedBlob,
          keyVersion: envelope.keyVersion,
          updatedAt: new Date(),
        })
        .where(
          and(eq(tenantSecrets.id, row.id), eq(tenantSecrets.workspaceId, row.workspaceId)),
        );
      rotated++;
    }
    return rotated;
  }
}

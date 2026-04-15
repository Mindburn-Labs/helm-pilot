import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Tenancy Domain ───
//
// Per-tenant secret envelopes. Each row stores an AES-256-GCM ciphertext whose
// DEK is derived per `(workspaceId, kind)` via HKDF-SHA256 over the master
// ENCRYPTION_KEY — see packages/shared/src/secrets. Plaintext is never
// persisted; reads re-derive the DEK on demand, so:
//
//   - Cross-tenant leak is cryptographically impossible (DEK is keyed by
//     workspaceId; trying to decrypt A's blob while passing B's workspaceId
//     yields an auth-tag failure).
//   - Rotation is additive: new master version → new keyVersion → in-place
//     re-encrypt (see scripts/rotate-master-key.ts).
//   - Admins running SQL against the DB see only opaque ciphertext.
//
// Kinds are free-form text so new connector types can register without a
// schema migration, but the canonical enum lives in shared/src/secrets.
export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** e.g. `llm_openrouter_key`, `telegram_bot_token`, `connector_gmail`. */
    kind: text('kind').notNull(),
    /** AES-256-GCM envelope: iv(12) || ciphertext || auth_tag(16), base64-encoded. */
    encryptedBlob: text('encrypted_blob').notNull(),
    /** Master-key version used to derive the DEK. Increments on rotation. */
    keyVersion: integer('key_version').notNull().default(1),
    /** Optional wall-clock expiry — reads past this return null (no-decrypt). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tenant_secrets_workspace_idx').on(table.workspaceId),
  ],
);

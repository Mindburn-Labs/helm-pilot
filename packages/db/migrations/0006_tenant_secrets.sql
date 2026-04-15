-- 0006 — per-tenant secret envelope (Phase 2b)
--
-- Stores AES-256-GCM ciphertexts keyed by (workspaceId, kind). DEKs are
-- derived from the master ENCRYPTION_KEY via HKDF-SHA256 using workspace_id
-- as salt, so cross-tenant decryption is cryptographically impossible even
-- with direct DB access.

CREATE TABLE IF NOT EXISTS "tenant_secrets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "encrypted_blob" text NOT NULL,
    "key_version" integer NOT NULL DEFAULT 1,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;

-- Enforce one live secret per (workspace, kind). Rotation updates in place
-- rather than inserting a new row, so this also blocks duplicate writes.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_secrets_workspace_kind_unique"
    ON "tenant_secrets" ("workspace_id", "kind");

CREATE INDEX IF NOT EXISTS "tenant_secrets_workspace_idx"
    ON "tenant_secrets" ("workspace_id");

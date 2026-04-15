-- 0008 — workspace soft-delete tracking (Phase 2d)
--
-- Separate table rather than a `deleted_at` column on `workspaces` so existing
-- workspace-scoped queries don't need to learn about soft-delete semantics.
-- The admin surface and the cleanup cron consult this table explicitly.

CREATE TABLE IF NOT EXISTS "workspace_deletions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL UNIQUE,
    "soft_deleted_at" timestamp with time zone NOT NULL DEFAULT now(),
    "soft_deleted_by" uuid,
    "reason" text,
    "hard_delete_after" timestamp with time zone NOT NULL,
    "hard_deleted_at" timestamp with time zone
);

ALTER TABLE "workspace_deletions"
    ADD CONSTRAINT "workspace_deletions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;

-- Composite index lets the cleanup cron find rows to hard-delete with a
-- single index scan: `WHERE hard_delete_after < now() AND hard_deleted_at IS NULL`.
CREATE INDEX IF NOT EXISTS "workspace_deletions_hard_idx"
    ON "workspace_deletions" ("hard_delete_after", "hard_deleted_at");

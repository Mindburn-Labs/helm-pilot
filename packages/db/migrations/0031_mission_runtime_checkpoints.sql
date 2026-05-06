-- 0031 - Durable mission runtime checkpoints
--
-- Stores mission checkpoint snapshots as first-class durable rows in addition
-- to evidence_items. The route remains checkpoint/recovery-plan only; this
-- migration does not add rollback, automatic resume, or production autonomy.

CREATE TABLE IF NOT EXISTS "mission_runtime_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "venture_id" uuid REFERENCES "ventures"("id") ON DELETE set null,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE cascade,
  "checkpoint_id" text NOT NULL,
  "checkpoint_kind" text NOT NULL DEFAULT 'manual_checkpoint',
  "reason" text,
  "content_hash" text NOT NULL,
  "replay_ref" text NOT NULL,
  "evidence_item_id" uuid REFERENCES "evidence_items"("id") ON DELETE set null,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "node_statuses" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mission_runtime_checkpoints_workspace_checkpoint_idx"
  ON "mission_runtime_checkpoints" ("workspace_id", "checkpoint_id");

CREATE UNIQUE INDEX IF NOT EXISTS "mission_runtime_checkpoints_workspace_replay_idx"
  ON "mission_runtime_checkpoints" ("workspace_id", "replay_ref");

CREATE INDEX IF NOT EXISTS "mission_runtime_checkpoints_mission_created_idx"
  ON "mission_runtime_checkpoints" ("mission_id", "created_at");

CREATE INDEX IF NOT EXISTS "mission_runtime_checkpoints_workspace_kind_idx"
  ON "mission_runtime_checkpoints" ("workspace_id", "checkpoint_kind");

CREATE INDEX IF NOT EXISTS "mission_runtime_checkpoints_content_hash_idx"
  ON "mission_runtime_checkpoints" ("content_hash");

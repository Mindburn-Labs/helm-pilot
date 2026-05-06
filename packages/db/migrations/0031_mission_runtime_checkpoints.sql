-- 0031 - Gate 9 mission runtime checkpoints
--
-- Add explicit mission-level checkpoint records for lifecycle DAG recovery and
-- constrained rollback planning. This table is intentionally append-only from
-- the runtime perspective: it records snapshots and plans without deleting or
-- reversing external effects.

CREATE TABLE IF NOT EXISTS "mission_runtime_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE cascade,
  "checkpoint_kind" text NOT NULL,
  "checkpoint_status" text DEFAULT 'recorded' NOT NULL,
  "mission_status" text NOT NULL,
  "cursor_node_id" uuid REFERENCES "mission_nodes"("id") ON DELETE set null,
  "cursor_node_key" text,
  "node_status_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ready_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "blocked_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "failed_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "awaiting_approval_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "task_run_checkpoint_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recovery_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "rollback_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "evidence_item_id" uuid,
  "content_hash" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mission_runtime_checkpoints_workspace_mission_idx"
  ON "mission_runtime_checkpoints" ("workspace_id", "mission_id", "created_at");

CREATE INDEX IF NOT EXISTS "mission_runtime_checkpoints_kind_idx"
  ON "mission_runtime_checkpoints" ("mission_id", "checkpoint_kind");

CREATE INDEX IF NOT EXISTS "mission_runtime_checkpoints_status_idx"
  ON "mission_runtime_checkpoints" ("workspace_id", "mission_status");

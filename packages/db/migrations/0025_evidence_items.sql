-- 0025 - Canonical evidence item ledger
--
-- Creates a first-class cross-surface evidence index. Source tables still own
-- specialized payloads; this table links HELM receipts, tool executions,
-- browser observations, computer actions, artifacts, audit events, and runtime
-- rows for replayable founder inspection. This does not by itself promote
-- evidence_ledger to production_ready because writers and evals must prove
-- every meaningful action appends evidence.

CREATE TABLE IF NOT EXISTS "evidence_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "venture_id" uuid REFERENCES "ventures"("id") ON DELETE set null,
  "mission_id" uuid REFERENCES "missions"("id") ON DELETE set null,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "task_run_id" uuid REFERENCES "task_runs"("id") ON DELETE set null,
  "action_id" uuid REFERENCES "actions"("id") ON DELETE set null,
  "tool_execution_id" uuid REFERENCES "tool_executions"("id") ON DELETE set null,
  "evidence_pack_id" uuid REFERENCES "evidence_packs"("id") ON DELETE set null,
  "browser_observation_id" uuid REFERENCES "browser_observations"("id") ON DELETE set null,
  "computer_action_id" uuid REFERENCES "computer_actions"("id") ON DELETE set null,
  "artifact_id" uuid REFERENCES "artifacts"("id") ON DELETE set null,
  "audit_event_id" uuid REFERENCES "audit_log"("id") ON DELETE set null,
  "evidence_type" text NOT NULL,
  "source_type" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "redaction_state" text NOT NULL DEFAULT 'unknown',
  "sensitivity" text NOT NULL DEFAULT 'internal',
  "content_hash" text,
  "storage_ref" text,
  "replay_ref" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "evidence_items_workspace_observed_idx"
  ON "evidence_items" ("workspace_id", "observed_at");

CREATE INDEX IF NOT EXISTS "evidence_items_workspace_type_idx"
  ON "evidence_items" ("workspace_id", "evidence_type");

CREATE INDEX IF NOT EXISTS "evidence_items_venture_idx"
  ON "evidence_items" ("venture_id");

CREATE INDEX IF NOT EXISTS "evidence_items_mission_idx"
  ON "evidence_items" ("mission_id");

CREATE INDEX IF NOT EXISTS "evidence_items_task_idx"
  ON "evidence_items" ("task_id");

CREATE INDEX IF NOT EXISTS "evidence_items_task_run_idx"
  ON "evidence_items" ("task_run_id");

CREATE INDEX IF NOT EXISTS "evidence_items_action_idx"
  ON "evidence_items" ("action_id");

CREATE INDEX IF NOT EXISTS "evidence_items_tool_execution_idx"
  ON "evidence_items" ("tool_execution_id");

CREATE INDEX IF NOT EXISTS "evidence_items_evidence_pack_idx"
  ON "evidence_items" ("evidence_pack_id");

CREATE INDEX IF NOT EXISTS "evidence_items_browser_observation_idx"
  ON "evidence_items" ("browser_observation_id");

CREATE INDEX IF NOT EXISTS "evidence_items_computer_action_idx"
  ON "evidence_items" ("computer_action_id");

CREATE INDEX IF NOT EXISTS "evidence_items_artifact_idx"
  ON "evidence_items" ("artifact_id");

CREATE INDEX IF NOT EXISTS "evidence_items_audit_event_idx"
  ON "evidence_items" ("audit_event_id");

CREATE INDEX IF NOT EXISTS "evidence_items_content_hash_idx"
  ON "evidence_items" ("content_hash");

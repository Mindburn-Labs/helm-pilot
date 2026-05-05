-- 0018 - Gate 1 foundation lineage + durable A2A
--
-- Adds deterministic replay ordering and richer parent/root/spawn lineage to
-- task_runs, then replaces process-local A2A task state with workspace-scoped
-- durable threads and messages.

-- task_runs - deterministic replay + proof DAG anchors

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "root_task_run_id" uuid;

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "spawned_by_action_id" uuid;

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "lineage_kind" text NOT NULL DEFAULT 'parent_action';

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "run_sequence" integer NOT NULL DEFAULT 0;

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "checkpoint_id" text;

UPDATE "task_runs"
SET "run_sequence" = COALESCE("iterations_used", 0)
WHERE "run_sequence" = 0 AND COALESCE("iterations_used", 0) <> 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'task_runs_root_fk'
          AND table_name = 'task_runs'
    ) THEN
        ALTER TABLE "task_runs"
            ADD CONSTRAINT "task_runs_root_fk"
            FOREIGN KEY ("root_task_run_id")
            REFERENCES "public"."task_runs"("id") ON DELETE set null;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'task_runs_spawned_by_action_fk'
          AND table_name = 'task_runs'
    ) THEN
        ALTER TABLE "task_runs"
            ADD CONSTRAINT "task_runs_spawned_by_action_fk"
            FOREIGN KEY ("spawned_by_action_id")
            REFERENCES "public"."task_runs"("id") ON DELETE set null;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS "task_runs_task_replay_idx"
  ON "task_runs" ("task_id", "lineage_kind", "run_sequence", "started_at", "id");

CREATE INDEX IF NOT EXISTS "task_runs_root_idx"
  ON "task_runs" ("root_task_run_id");

CREATE INDEX IF NOT EXISTS "task_runs_spawned_by_action_idx"
  ON "task_runs" ("spawned_by_action_id");

-- A2A - durable task threads/messages

CREATE TABLE IF NOT EXISTS "a2a_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "external_task_id" text NOT NULL,
  "pilot_task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "status" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "a2a_threads_workspace_external_idx"
  ON "a2a_threads" ("workspace_id", "external_task_id");

CREATE INDEX IF NOT EXISTS "a2a_threads_workspace_status_idx"
  ON "a2a_threads" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "a2a_threads_pilot_task_idx"
  ON "a2a_threads" ("pilot_task_id");

CREATE TABLE IF NOT EXISTS "a2a_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "a2a_threads"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "parts" jsonb NOT NULL,
  "sequence" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "a2a_messages_thread_sequence_idx"
  ON "a2a_messages" ("thread_id", "sequence");

CREATE INDEX IF NOT EXISTS "a2a_messages_workspace_idx"
  ON "a2a_messages" ("workspace_id");

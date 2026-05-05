-- 0019 - Gate 3 runtime skills + durable agent handoffs
--
-- Records skill activation metadata on task_runs and materializes parent
-- agent -> subagent handoffs as a durable protocol table.

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "skill_invocations" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "agent_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE cascade,
  "parent_task_run_id" uuid REFERENCES "task_runs"("id") ON DELETE set null,
  "child_task_run_id" uuid REFERENCES "task_runs"("id") ON DELETE set null,
  "from_agent" text NOT NULL,
  "to_agent" text NOT NULL,
  "handoff_kind" text NOT NULL DEFAULT 'subagent_spawn',
  "status" text NOT NULL DEFAULT 'running',
  "skill_invocations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "agent_handoffs_workspace_task_idx"
  ON "agent_handoffs" ("workspace_id", "task_id");

CREATE INDEX IF NOT EXISTS "agent_handoffs_parent_idx"
  ON "agent_handoffs" ("parent_task_run_id");

CREATE INDEX IF NOT EXISTS "agent_handoffs_child_idx"
  ON "agent_handoffs" ("child_task_run_id");

CREATE INDEX IF NOT EXISTS "agent_handoffs_status_idx"
  ON "agent_handoffs" ("status");

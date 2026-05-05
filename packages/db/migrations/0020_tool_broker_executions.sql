-- 0020 - Gate 5 governed tool broker execution ledger
--
-- Adds durable action/tool execution records so autonomous tools are
-- inspectable by workspace, task, idempotency key, HELM policy decision, and
-- evidence references. Venture/mission ids are nullable UUID anchors until the
-- startup lifecycle compiler owns those parent records.

CREATE TABLE IF NOT EXISTS "actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "venture_id" uuid,
  "mission_id" uuid,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "task_run_id" uuid REFERENCES "task_runs"("id") ON DELETE set null,
  "actor_type" text NOT NULL DEFAULT 'agent',
  "actor_id" uuid,
  "action_key" text NOT NULL,
  "action_type" text NOT NULL DEFAULT 'tool',
  "risk_class" text NOT NULL DEFAULT 'low',
  "status" text NOT NULL DEFAULT 'running',
  "input_hash" text,
  "output_hash" text,
  "policy_decision_id" text,
  "policy_version" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "tool_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "venture_id" uuid,
  "mission_id" uuid,
  "action_id" uuid REFERENCES "actions"("id") ON DELETE set null,
  "task_run_id" uuid REFERENCES "task_runs"("id") ON DELETE set null,
  "tool_key" text NOT NULL,
  "input_hash" text NOT NULL,
  "sanitized_input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output_hash" text,
  "sanitized_output" jsonb,
  "status" text NOT NULL DEFAULT 'running',
  "idempotency_key" text NOT NULL,
  "evidence_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "policy_decision_id" text,
  "policy_version" text,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "actions_workspace_status_idx"
  ON "actions" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "actions_task_idx"
  ON "actions" ("task_id");

CREATE INDEX IF NOT EXISTS "actions_task_run_idx"
  ON "actions" ("task_run_id");

CREATE INDEX IF NOT EXISTS "actions_policy_decision_idx"
  ON "actions" ("policy_decision_id");

CREATE UNIQUE INDEX IF NOT EXISTS "tool_executions_idempotency_idx"
  ON "tool_executions" ("workspace_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "tool_executions_workspace_status_idx"
  ON "tool_executions" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "tool_executions_action_idx"
  ON "tool_executions" ("action_id");

CREATE INDEX IF NOT EXISTS "tool_executions_task_run_idx"
  ON "tool_executions" ("task_run_id");

CREATE INDEX IF NOT EXISTS "tool_executions_policy_decision_idx"
  ON "tool_executions" ("policy_decision_id");

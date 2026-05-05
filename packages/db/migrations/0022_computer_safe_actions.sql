-- 0022 - Gate 7 safe computer/sandbox operation
--
-- Adds replayable evidence rows for narrow HELM-governed computer actions:
-- safe terminal commands, project-scoped file reads/writes, and local
-- dev-server status checks. This is not unrestricted desktop automation.

CREATE TABLE IF NOT EXISTS "computer_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "tool_action_id" uuid REFERENCES "actions"("id") ON DELETE set null,
  "operator_id" uuid,
  "action_type" text NOT NULL,
  "environment" text NOT NULL DEFAULT 'local',
  "objective" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "cwd" text,
  "command" text,
  "args" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "file_path" text,
  "dev_server_url" text,
  "stdout" text,
  "stderr" text,
  "exit_code" integer,
  "duration_ms" integer,
  "file_diff" text,
  "output_hash" text,
  "policy_decision_id" text,
  "policy_version" text,
  "evidence_pack_id" uuid REFERENCES "evidence_packs"("id") ON DELETE set null,
  "replay_index" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "computer_actions_workspace_idx"
  ON "computer_actions" ("workspace_id", "created_at");

CREATE INDEX IF NOT EXISTS "computer_actions_task_idx"
  ON "computer_actions" ("task_id");

CREATE INDEX IF NOT EXISTS "computer_actions_tool_action_idx"
  ON "computer_actions" ("tool_action_id");

CREATE INDEX IF NOT EXISTS "computer_actions_policy_decision_idx"
  ON "computer_actions" ("policy_decision_id");

CREATE INDEX IF NOT EXISTS "computer_actions_evidence_pack_idx"
  ON "computer_actions" ("evidence_pack_id");

CREATE INDEX IF NOT EXISTS "computer_actions_replay_idx"
  ON "computer_actions" ("workspace_id", "task_id", "replay_index");

-- 0016 — action integrity anchors for approval resume checks.

ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "action_input" jsonb;
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "action_hash" text;
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "policy_version" text;
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "approval_context" jsonb DEFAULT '{}'::jsonb;

ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "action_hash" text;

CREATE INDEX IF NOT EXISTS "approvals_action_hash_idx"
  ON "approvals" ("workspace_id", "task_id", "action_hash");

CREATE INDEX IF NOT EXISTS "task_runs_action_hash_idx"
  ON "task_runs" ("task_id", "action_hash");

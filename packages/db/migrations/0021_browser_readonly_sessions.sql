-- 0021 - Gate 6 read-only browser operation
--
-- Adds governed browser session, active-tab grant, action, and observation
-- records. These tables store session boundaries and redacted observations;
-- they do not store cookies, passwords, tokens, or exported browser profiles.

CREATE TABLE IF NOT EXISTS "browser_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" uuid,
  "name" text NOT NULL,
  "browser" text NOT NULL DEFAULT 'unknown',
  "profile_label" text,
  "allowed_origins" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "browser_sessions_workspace_status_idx"
  ON "browser_sessions" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "browser_sessions_user_idx"
  ON "browser_sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "browser_session_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "session_id" uuid NOT NULL REFERENCES "browser_sessions"("id") ON DELETE cascade,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "venture_id" uuid,
  "mission_id" uuid,
  "granted_to_type" text NOT NULL DEFAULT 'agent',
  "granted_to_id" uuid,
  "scope" text NOT NULL DEFAULT 'read_extract',
  "allowed_origins" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "browser_grants_workspace_status_idx"
  ON "browser_session_grants" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "browser_grants_session_idx"
  ON "browser_session_grants" ("session_id");

CREATE INDEX IF NOT EXISTS "browser_grants_task_idx"
  ON "browser_session_grants" ("task_id");

CREATE TABLE IF NOT EXISTS "browser_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "session_id" uuid NOT NULL REFERENCES "browser_sessions"("id") ON DELETE cascade,
  "grant_id" uuid NOT NULL REFERENCES "browser_session_grants"("id") ON DELETE cascade,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "tool_action_id" uuid REFERENCES "actions"("id") ON DELETE set null,
  "action_type" text NOT NULL DEFAULT 'read_extract',
  "objective" text,
  "url" text NOT NULL,
  "origin" text NOT NULL,
  "status" text NOT NULL DEFAULT 'completed',
  "policy_decision_id" text,
  "policy_version" text,
  "evidence_pack_id" uuid REFERENCES "evidence_packs"("id") ON DELETE set null,
  "replay_index" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "browser_actions_workspace_idx"
  ON "browser_actions" ("workspace_id", "created_at");

CREATE INDEX IF NOT EXISTS "browser_actions_session_idx"
  ON "browser_actions" ("session_id", "replay_index");

CREATE INDEX IF NOT EXISTS "browser_actions_grant_idx"
  ON "browser_actions" ("grant_id");

CREATE INDEX IF NOT EXISTS "browser_actions_task_idx"
  ON "browser_actions" ("task_id");

CREATE INDEX IF NOT EXISTS "browser_actions_tool_action_idx"
  ON "browser_actions" ("tool_action_id");

CREATE INDEX IF NOT EXISTS "browser_actions_policy_decision_idx"
  ON "browser_actions" ("policy_decision_id");

CREATE INDEX IF NOT EXISTS "browser_actions_evidence_pack_idx"
  ON "browser_actions" ("evidence_pack_id");

CREATE TABLE IF NOT EXISTS "browser_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "session_id" uuid NOT NULL REFERENCES "browser_sessions"("id") ON DELETE cascade,
  "grant_id" uuid NOT NULL REFERENCES "browser_session_grants"("id") ON DELETE cascade,
  "browser_action_id" uuid REFERENCES "browser_actions"("id") ON DELETE set null,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "action_id" uuid REFERENCES "actions"("id") ON DELETE set null,
  "evidence_pack_id" uuid REFERENCES "evidence_packs"("id") ON DELETE set null,
  "url" text NOT NULL,
  "origin" text NOT NULL,
  "title" text,
  "objective" text,
  "dom_hash" text,
  "screenshot_hash" text,
  "screenshot_ref" text,
  "redacted_dom_snapshot" text,
  "extracted_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "redactions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "replay_index" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "browser_observations_workspace_idx"
  ON "browser_observations" ("workspace_id", "observed_at");

CREATE INDEX IF NOT EXISTS "browser_observations_session_idx"
  ON "browser_observations" ("session_id", "replay_index");

CREATE INDEX IF NOT EXISTS "browser_observations_grant_idx"
  ON "browser_observations" ("grant_id");

CREATE INDEX IF NOT EXISTS "browser_observations_browser_action_idx"
  ON "browser_observations" ("browser_action_id");

CREATE INDEX IF NOT EXISTS "browser_observations_task_idx"
  ON "browser_observations" ("task_id");

CREATE INDEX IF NOT EXISTS "browser_observations_action_idx"
  ON "browser_observations" ("action_id");

CREATE INDEX IF NOT EXISTS "browser_observations_evidence_pack_idx"
  ON "browser_observations" ("evidence_pack_id");

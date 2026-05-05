-- 0023 - Gate 10 eval suite and production promotion guard
--
-- Stores production eval scenarios, run records, pass/fail results, evidence
-- links, blocker metadata, and promotion eligibility. These rows prove that a
-- capability may be promoted, but they do not directly mutate capability
-- registry source state.

CREATE TABLE IF NOT EXISTS "evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "eval_id" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "capability_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "scenario" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "evaluations_eval_id_idx"
  ON "evaluations" ("eval_id");

CREATE INDEX IF NOT EXISTS "evaluations_created_at_idx"
  ON "evaluations" ("created_at");

CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "eval_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "capability_key" text,
  "run_ref" text,
  "failure_reason" text,
  "evidence_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "audit_receipt_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "eval_runs_workspace_created_idx"
  ON "eval_runs" ("workspace_id", "created_at");

CREATE INDEX IF NOT EXISTS "eval_runs_workspace_eval_idx"
  ON "eval_runs" ("workspace_id", "eval_id");

CREATE INDEX IF NOT EXISTS "eval_runs_workspace_status_idx"
  ON "eval_runs" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "eval_runs_workspace_capability_idx"
  ON "eval_runs" ("workspace_id", "capability_key");

CREATE TABLE IF NOT EXISTS "eval_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "eval_run_id" uuid NOT NULL REFERENCES "eval_runs"("id") ON DELETE cascade,
  "step_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "evidence_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "audit_receipt_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "eval_steps_run_idx"
  ON "eval_steps" ("eval_run_id");

CREATE INDEX IF NOT EXISTS "eval_steps_run_step_idx"
  ON "eval_steps" ("eval_run_id", "step_key");

CREATE TABLE IF NOT EXISTS "eval_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "eval_run_id" uuid NOT NULL REFERENCES "eval_runs"("id") ON DELETE cascade,
  "eval_id" text NOT NULL,
  "capability_key" text,
  "status" text NOT NULL,
  "passed" boolean NOT NULL DEFAULT false,
  "summary" text,
  "blockers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "eval_results_workspace_created_idx"
  ON "eval_results" ("workspace_id", "created_at");

CREATE INDEX IF NOT EXISTS "eval_results_run_idx"
  ON "eval_results" ("eval_run_id");

CREATE INDEX IF NOT EXISTS "eval_results_workspace_eval_idx"
  ON "eval_results" ("workspace_id", "eval_id");

CREATE INDEX IF NOT EXISTS "eval_results_workspace_capability_idx"
  ON "eval_results" ("workspace_id", "capability_key");

CREATE TABLE IF NOT EXISTS "eval_evidence_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "eval_run_id" uuid NOT NULL REFERENCES "eval_runs"("id") ON DELETE cascade,
  "evidence_ref" text NOT NULL,
  "audit_receipt_ref" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "eval_evidence_links_workspace_idx"
  ON "eval_evidence_links" ("workspace_id");

CREATE INDEX IF NOT EXISTS "eval_evidence_links_run_idx"
  ON "eval_evidence_links" ("eval_run_id");

CREATE INDEX IF NOT EXISTS "eval_evidence_links_evidence_ref_idx"
  ON "eval_evidence_links" ("evidence_ref");

CREATE TABLE IF NOT EXISTS "capability_promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "capability_key" text NOT NULL,
  "eval_run_id" uuid NOT NULL REFERENCES "eval_runs"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'eligible',
  "promoted_state" text NOT NULL DEFAULT 'production_ready',
  "evidence_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "audit_receipt_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "capability_promotions_workspace_created_idx"
  ON "capability_promotions" ("workspace_id", "created_at");

CREATE INDEX IF NOT EXISTS "capability_promotions_workspace_capability_idx"
  ON "capability_promotions" ("workspace_id", "capability_key");

CREATE INDEX IF NOT EXISTS "capability_promotions_eval_run_idx"
  ON "capability_promotions" ("eval_run_id");

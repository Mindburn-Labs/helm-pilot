-- 0030 - Gate 2 opportunity score governance metadata
--
-- Persist HELM/model governance metadata directly on opportunity score rows
-- so background startup scoring cannot silently downgrade a governed LLM
-- failure into an untraceable heuristic production claim.

ALTER TABLE "opportunity_scores"
ADD COLUMN "policy_decision_id" text,
ADD COLUMN "policy_version" text,
ADD COLUMN "helm_document_version_pins" jsonb DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN "model_usage" jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS "opportunity_scores_policy_decision_idx"
  ON "opportunity_scores" ("policy_decision_id");

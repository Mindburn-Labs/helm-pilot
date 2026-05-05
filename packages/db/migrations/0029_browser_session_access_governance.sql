-- 0029 - Gate 2 browser session access governance
--
-- Browser session creation and grant records are access-boundary mutations.
-- Persist the HELM decision/policy pins that authorized them so broad
-- delegated browser access has the same replayable governance trail as
-- browser read/extract actions.

ALTER TABLE "browser_sessions"
ADD COLUMN "policy_decision_id" text,
ADD COLUMN "policy_version" text,
ADD COLUMN "helm_document_version_pins" jsonb DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN "evidence_pack_id" uuid REFERENCES "evidence_packs"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "browser_sessions_policy_decision_idx"
  ON "browser_sessions" ("policy_decision_id");

CREATE INDEX IF NOT EXISTS "browser_sessions_evidence_pack_idx"
  ON "browser_sessions" ("evidence_pack_id");

ALTER TABLE "browser_session_grants"
ADD COLUMN "policy_decision_id" text,
ADD COLUMN "policy_version" text,
ADD COLUMN "helm_document_version_pins" jsonb DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN "evidence_pack_id" uuid REFERENCES "evidence_packs"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "browser_grants_policy_decision_idx"
  ON "browser_session_grants" ("policy_decision_id");

CREATE INDEX IF NOT EXISTS "browser_grants_evidence_pack_idx"
  ON "browser_session_grants" ("evidence_pack_id");

-- 0026 - Tool Broker HELM document version pins
--
-- Adds queryable HELM document version pin metadata to durable action and
-- tool execution rows. The policy_version column records the evaluated HELM
-- policy bundle; helm_document_version_pins records the canonical document
-- versions used by the action context, starting with a conservative policy
-- pin until the full HELM document store is promoted.

ALTER TABLE "actions"
  ADD COLUMN IF NOT EXISTS "helm_document_version_pins" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "tool_executions"
  ADD COLUMN IF NOT EXISTS "helm_document_version_pins" jsonb NOT NULL DEFAULT '{}'::jsonb;

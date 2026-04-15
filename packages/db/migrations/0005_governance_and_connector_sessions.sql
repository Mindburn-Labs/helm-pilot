-- 0005 — HELM governance anchors + connector sessions + crawl tracking
--
-- Two independent but concurrently-developed tranches landing in the same
-- migration to keep the timeline linear:
--
-- 1. HELM governance (Phase 1a/1b)
--    - evidence_packs: workspace-scoped local mirror of every HELM receipt
--    - helm_health_snapshots: periodic gateway probes for the dashboard
--    - task_runs: three anchor columns so each agent iteration points at its
--      upstream decision id + policy version + reason code
--
-- 2. Connector sessions + crawl (pre-Phase-1 WIP, stabilized here)
--    - connector_sessions: encrypted session payloads per grant (session-auth
--      connectors — e.g. yc)
--    - crawl_sources / crawl_runs / raw_captures / crawl_checkpoints:
--      schedulable, restartable crawl tracking used by the YC-private
--      pipeline and future scraper additions

-- ═══════════════════════════════════════════════════════════════════════════
-- HELM governance anchors (Phase 1a/1b)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "evidence_packs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL,
    "decision_id" text NOT NULL,
    "task_run_id" uuid,
    "verdict" text NOT NULL,
    "reason_code" text,
    "policy_version" text NOT NULL,
    "decision_hash" text,
    "action" text NOT NULL,
    "resource" text NOT NULL,
    "principal" text NOT NULL,
    "signed_blob" jsonb,
    "received_at" timestamp with time zone DEFAULT now() NOT NULL,
    "verified_at" timestamp with time zone
);

ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_task_run_id_task_runs_id_fk"
    FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "evidence_packs_workspace_idx" ON "evidence_packs" ("workspace_id");
CREATE INDEX IF NOT EXISTS "evidence_packs_decision_idx" ON "evidence_packs" ("decision_id");
CREATE INDEX IF NOT EXISTS "evidence_packs_task_run_idx" ON "evidence_packs" ("task_run_id");
CREATE INDEX IF NOT EXISTS "evidence_packs_received_idx" ON "evidence_packs" ("received_at");

CREATE TABLE IF NOT EXISTS "helm_health_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
    "gateway_ok" boolean NOT NULL,
    "version" text,
    "latency_ms" integer NOT NULL,
    "error" text
);

CREATE INDEX IF NOT EXISTS "helm_health_checked_idx" ON "helm_health_snapshots" ("checked_at");

ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "helm_decision_id" text;
ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "helm_policy_version" text;
ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "helm_reason_code" text;

-- ═══════════════════════════════════════════════════════════════════════════
-- Connector sessions (pre-Phase-1 WIP, stabilized in Phase 1d)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "connector_sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "grant_id" uuid NOT NULL,
    "session_type" text DEFAULT 'browser_storage_state' NOT NULL,
    "session_data_enc" text NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "last_validated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "connector_sessions_grant_id_unique" UNIQUE("grant_id")
);

ALTER TABLE "connector_sessions" ADD CONSTRAINT "connector_sessions_grant_id_connector_grants_id_fk"
    FOREIGN KEY ("grant_id") REFERENCES "public"."connector_grants"("id") ON DELETE cascade ON UPDATE no action;

-- ═══════════════════════════════════════════════════════════════════════════
-- Crawl tracking (pre-Phase-1 WIP, stabilized in Phase 1d)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "crawl_sources" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid,
    "name" text NOT NULL,
    "domain" text NOT NULL,
    "source_type" text NOT NULL,
    "fetch_strategy" text DEFAULT 'fetcher' NOT NULL,
    "auth_requirement" text DEFAULT 'public' NOT NULL,
    "parser_version" text,
    "schedule" text,
    "escalation_policy" text DEFAULT 'retry_stealthy' NOT NULL,
    "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_run_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "crawl_sources" ADD CONSTRAINT "crawl_sources_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "crawl_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid NOT NULL,
    "ingestion_record_id" uuid,
    "workspace_id" uuid,
    "mode" text DEFAULT 'public' NOT NULL,
    "status" text DEFAULT 'queued' NOT NULL,
    "item_count" integer DEFAULT 0 NOT NULL,
    "checkpoint_dir" text,
    "live_stream_key" text,
    "error" text,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "completed_at" timestamp with time zone
);

ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_source_id_crawl_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "public"."crawl_sources"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_ingestion_record_id_ingestion_records_id_fk"
    FOREIGN KEY ("ingestion_record_id") REFERENCES "public"."ingestion_records"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "raw_captures" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "crawl_run_id" uuid NOT NULL,
    "source_url" text NOT NULL,
    "content_type" text DEFAULT 'text/html' NOT NULL,
    "storage_path" text NOT NULL,
    "checksum" text,
    "size_bytes" integer,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "raw_captures" ADD CONSTRAINT "raw_captures_crawl_run_id_crawl_runs_id_fk"
    FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "crawl_checkpoints" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "crawl_run_id" uuid NOT NULL,
    "checkpoint_key" text NOT NULL,
    "storage_path" text,
    "cursor" text,
    "last_seen_url" text,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "crawl_checkpoints" ADD CONSTRAINT "crawl_checkpoints_crawl_run_id_crawl_runs_id_fk"
    FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;

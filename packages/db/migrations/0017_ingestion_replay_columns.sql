-- 0017 — ingestion replay tracking columns used by the YC ingestion API.

ALTER TABLE "ingestion_records"
  ADD COLUMN IF NOT EXISTS "replay_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "ingestion_records"
  ADD COLUMN IF NOT EXISTS "last_replayed_at" timestamp with time zone;

-- Phase 16 Track N — long-running / 8-hour autonomous execution.
--
-- Adds checkpoint state to task_runs so the orchestrator can rehydrate
-- after crash, and a partial index on running rows so the progress-rate
-- watchdog can scan stalled runs cheaply.

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "checkpoint_state" jsonb;

ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "last_checkpoint_at" timestamptz;

-- Partial index: only "running" rows are interesting to the watchdog.
-- Uses last_checkpoint_at (COALESCEd with started_at by the query) since
-- task_runs has no updated_at column.
CREATE INDEX IF NOT EXISTS "task_runs_running_checkpoint_idx"
  ON "task_runs" ("last_checkpoint_at")
  WHERE "status" = 'running';

-- Marker column: watchdog stamps a timestamp after alerting so we
-- don't alert twice on the same stalled run.
ALTER TABLE "task_runs"
  ADD COLUMN IF NOT EXISTS "watchdog_alerted_at" timestamptz;

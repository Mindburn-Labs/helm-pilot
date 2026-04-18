-- 0011 — connector refresh state (Phase 13, Track B)
--
-- Adds the state columns the background refresh worker needs:
--   needs_reauth        — set to true after N consecutive permanent failures
--                         (invalid_grant / revoked). Surfaces re-auth banner.
--   last_refresh_error  — last error string for operator visibility.
--   refresh_attempts    — running count reset on successful refresh. Used for
--                         exponential back-off + permanent-failure detection.
--
-- Index: refresh worker periodically queries "needs_reauth = false AND
-- expires_at < now() + 30m" — the partial index keeps that query cheap as the
-- grants table grows.

ALTER TABLE "connector_grants"
  ADD COLUMN IF NOT EXISTS "needs_reauth" boolean NOT NULL DEFAULT false;

ALTER TABLE "connector_grants"
  ADD COLUMN IF NOT EXISTS "last_refresh_error" text;

ALTER TABLE "connector_grants"
  ADD COLUMN IF NOT EXISTS "refresh_attempts" integer NOT NULL DEFAULT 0;

-- Partial index: eligible-for-refresh rows only. Small + hot-pathed by the
-- refresh tick job; reauth-required rows are skipped at query time.
CREATE INDEX IF NOT EXISTS "connector_grants_refresh_eligible_idx"
  ON "connector_grants" ("is_active", "needs_reauth")
  WHERE "is_active" = true AND "needs_reauth" = false;

-- Surface-facing index: fetch the list of grants that need re-auth for the
-- workspace so the banner can render without a table scan.
CREATE INDEX IF NOT EXISTS "connector_grants_needs_reauth_idx"
  ON "connector_grants" ("workspace_id")
  WHERE "needs_reauth" = true;

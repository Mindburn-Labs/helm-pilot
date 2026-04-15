-- 0007 — tenant-partitioned rate-limit token buckets (Phase 2c)
--
-- One row per (subject, route_class) pair. The application-layer consume
-- operation is a single atomic UPDATE ... WHERE effective_tokens >= 1 so
-- concurrent requests can't both drain the last token under Postgres MVCC.

CREATE TABLE IF NOT EXISTS "ratelimit_buckets" (
    "subject" text NOT NULL,
    "route_class" text NOT NULL,
    "tokens" double precision NOT NULL,
    "capacity" double precision NOT NULL,
    "refill_per_sec" double precision NOT NULL,
    "last_refill_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("subject", "route_class")
);

-- Housekeeping index so a nightly prune (`DELETE WHERE updated_at < now() -
-- interval '7 days'`) can hit a b-tree rather than a full scan.
CREATE INDEX IF NOT EXISTS "ratelimit_buckets_updated_idx"
    ON "ratelimit_buckets" ("updated_at");

-- pgvector 0.8.2 is the minimum safe runtime for HELM Pilot.
-- It fixes CVE-2026-3172 in parallel HNSW index builds.
--
-- The app can still run keyword-only when pgvector is unavailable, but if the
-- extension is installed it must not be an affected version.

DO $$
DECLARE
  vector_available boolean;
  vector_version text;
  version_parts text[];
  major int;
  minor int;
  patch int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
  ) INTO vector_available;

  IF NOT vector_available THEN
    RAISE WARNING 'pgvector extension not available; semantic search remains keyword-only';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER EXTENSION vector UPDATE;

  SELECT extversion INTO vector_version
  FROM pg_extension
  WHERE extname = 'vector';

  version_parts := regexp_match(vector_version, '^([0-9]+)\.([0-9]+)\.([0-9]+)');

  IF version_parts IS NULL THEN
    RAISE WARNING 'Unable to parse pgvector extension version "%"; expected >= 0.8.2', vector_version;
    RETURN;
  END IF;

  major := version_parts[1]::int;
  minor := version_parts[2]::int;
  patch := version_parts[3]::int;

  IF (major, minor, patch) < (0, 8, 2) THEN
    RAISE EXCEPTION 'pgvector extension version % is below required 0.8.2 (CVE-2026-3172)', vector_version;
  END IF;

  RAISE NOTICE 'pgvector extension version % satisfies HELM Pilot minimum 0.8.2', vector_version;
END
$$;

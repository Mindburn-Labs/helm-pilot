-- Enable pgvector extension for semantic search.
-- Wrapped in a DO block so missing pgvector doesn't break the migration —
-- vector search degrades to keyword-only in that case (MemoryService handles this).

DO $$
DECLARE
  vector_available boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
  ) INTO vector_available;

  IF vector_available THEN
    CREATE EXTENSION IF NOT EXISTS vector;

    -- Add vector embedding column to content_chunks.
    -- 1536 dimensions = OpenAI text-embedding-3-small.
    EXECUTE 'ALTER TABLE content_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(1536)';

    -- HNSW index for fast approximate nearest neighbor search.
    EXECUTE 'CREATE INDEX IF NOT EXISTS chunks_embedding_idx
               ON content_chunks
               USING hnsw (embedding_vec vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)';

    -- Index for chunks that still need embeddings (for background backfill).
    EXECUTE 'CREATE INDEX IF NOT EXISTS chunks_needs_embedding_idx
               ON content_chunks (page_id)
               WHERE embedding_vec IS NULL';

    RAISE NOTICE 'pgvector enabled: vector search is active';
  ELSE
    RAISE WARNING 'pgvector extension not available on this Postgres. Vector search will degrade to keyword-only. Install pgvector to enable semantic search.';
  END IF;
END
$$;

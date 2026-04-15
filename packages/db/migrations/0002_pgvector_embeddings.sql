-- Enable pgvector extension for semantic search.
-- pgvector v0.5+ is included in pgvector/pgvector:pg17 Docker image used in docker-compose.

CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector embedding column to content_chunks.
-- 1536 dimensions = OpenAI text-embedding-3-small / Cohere embed-english-v3.
-- Nullable so existing chunks without embeddings are unaffected.
ALTER TABLE "content_chunks" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(1536);

-- HNSW index for fast approximate nearest neighbor search.
-- ef_construction=64 and m=16 are good defaults for accuracy/build-time tradeoff.
CREATE INDEX IF NOT EXISTS "chunks_embedding_idx"
  ON "content_chunks"
  USING hnsw ("embedding_vec" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Additional index for querying chunks that still need embeddings (for background backfill).
CREATE INDEX IF NOT EXISTS "chunks_needs_embedding_idx"
  ON "content_chunks" ("page_id")
  WHERE "embedding_vec" IS NULL;

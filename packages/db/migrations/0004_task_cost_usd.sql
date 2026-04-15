-- Per-run cost tracking in USD.
-- Populated by the agent loop from LLM usage × MODEL_PRICING (packages/shared/src/llm/pricing.ts).

ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(10, 4) DEFAULT 0;

CREATE INDEX IF NOT EXISTS "task_runs_cost_idx" ON "task_runs" ("task_id", "cost_usd");

-- 0010 — governed subagents (Phase 12)
--
-- Adds parent-child anchoring to task_runs and evidence_packs so the
-- Conductor + SubagentLoop architecture can record a cryptographically
-- attested DAG of governed delegations. Every subagent spawn emits a
-- SUBAGENT_SPAWN evidence pack whose child LLM calls anchor back via
-- parent_evidence_pack_id. Traversal is a recursive CTE.

-- ═══════════════════════════════════════════════════════════════════════
-- task_runs — parent-child lineage + operator role + budget slice
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "parent_task_run_id" uuid;
ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "operator_role" text;
ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "budget_slice_used" numeric(10,4) DEFAULT '0';
ALTER TABLE "task_runs" ADD COLUMN IF NOT EXISTS "budget_slice_allocated" numeric(10,4);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'task_runs_parent_fk'
          AND table_name = 'task_runs'
    ) THEN
        ALTER TABLE "task_runs"
            ADD CONSTRAINT "task_runs_parent_fk"
            FOREIGN KEY ("parent_task_run_id")
            REFERENCES "public"."task_runs"("id") ON DELETE set null;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS "task_runs_parent_idx" ON "task_runs" ("parent_task_run_id");

-- ═══════════════════════════════════════════════════════════════════════
-- evidence_packs — parent-child receipt chain for subagent DAGs
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "evidence_packs" ADD COLUMN IF NOT EXISTS "parent_evidence_pack_id" uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'evidence_packs_parent_fk'
          AND table_name = 'evidence_packs'
    ) THEN
        ALTER TABLE "evidence_packs"
            ADD CONSTRAINT "evidence_packs_parent_fk"
            FOREIGN KEY ("parent_evidence_pack_id")
            REFERENCES "public"."evidence_packs"("id") ON DELETE set null;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS "evidence_packs_parent_idx" ON "evidence_packs" ("parent_evidence_pack_id");

-- 0024 - Durable venture / goal / mission runtime backbone
--
-- Persists startup lifecycle DAGs as first-class venture, goal, mission, node,
-- edge, and mission-task rows. This does not execute autonomous work and does
-- not promote startup_lifecycle to production_ready.

CREATE TABLE IF NOT EXISTS "ventures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "dna_document_id" uuid,
  "phenotype_document_id" uuid,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "ventures_workspace_status_idx"
  ON "ventures" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "ventures_workspace_created_idx"
  ON "ventures" ("workspace_id", "created_at");

CREATE TABLE IF NOT EXISTS "goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "venture_id" uuid REFERENCES "ventures"("id") ON DELETE set null,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "autonomy_mode" text NOT NULL DEFAULT 'review',
  "constraints" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "goals_workspace_status_idx"
  ON "goals" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "goals_venture_idx"
  ON "goals" ("venture_id");

CREATE TABLE IF NOT EXISTS "missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "venture_id" uuid REFERENCES "ventures"("id") ON DELETE set null,
  "goal_id" uuid REFERENCES "goals"("id") ON DELETE set null,
  "mission_key" text NOT NULL,
  "title" text NOT NULL,
  "status" text NOT NULL DEFAULT 'compiled',
  "compiler_version" text,
  "autonomy_mode" text NOT NULL DEFAULT 'review',
  "capability_state" text NOT NULL DEFAULT 'prototype',
  "production_ready" boolean NOT NULL DEFAULT false,
  "assumptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "blockers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "completed_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "missions_workspace_key_idx"
  ON "missions" ("workspace_id", "mission_key");

CREATE INDEX IF NOT EXISTS "missions_workspace_status_idx"
  ON "missions" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "missions_venture_idx"
  ON "missions" ("venture_id");

CREATE INDEX IF NOT EXISTS "missions_goal_idx"
  ON "missions" ("goal_id");

CREATE TABLE IF NOT EXISTS "mission_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE cascade,
  "node_key" text NOT NULL,
  "stage" text NOT NULL,
  "title" text NOT NULL,
  "objective" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "sort_order" integer NOT NULL DEFAULT 0,
  "required_agents" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "required_skills" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "required_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "required_evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "helm_policy_classes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "escalation_conditions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "acceptance_criteria" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "completed_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "mission_nodes_mission_key_idx"
  ON "mission_nodes" ("mission_id", "node_key");

CREATE INDEX IF NOT EXISTS "mission_nodes_workspace_status_idx"
  ON "mission_nodes" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "mission_nodes_mission_order_idx"
  ON "mission_nodes" ("mission_id", "sort_order");

CREATE INDEX IF NOT EXISTS "mission_nodes_stage_idx"
  ON "mission_nodes" ("stage");

CREATE TABLE IF NOT EXISTS "mission_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE cascade,
  "edge_key" text NOT NULL,
  "from_node_key" text NOT NULL,
  "to_node_key" text NOT NULL,
  "reason" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mission_edges_mission_key_idx"
  ON "mission_edges" ("mission_id", "edge_key");

CREATE INDEX IF NOT EXISTS "mission_edges_workspace_idx"
  ON "mission_edges" ("workspace_id");

CREATE INDEX IF NOT EXISTS "mission_edges_mission_from_idx"
  ON "mission_edges" ("mission_id", "from_node_key");

CREATE INDEX IF NOT EXISTS "mission_edges_mission_to_idx"
  ON "mission_edges" ("mission_id", "to_node_key");

CREATE TABLE IF NOT EXISTS "mission_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "mission_id" uuid NOT NULL REFERENCES "missions"("id") ON DELETE cascade,
  "node_id" uuid REFERENCES "mission_nodes"("id") ON DELETE set null,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE cascade,
  "role" text NOT NULL DEFAULT 'execution_task',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mission_tasks_mission_task_idx"
  ON "mission_tasks" ("mission_id", "task_id");

CREATE INDEX IF NOT EXISTS "mission_tasks_workspace_idx"
  ON "mission_tasks" ("workspace_id");

CREATE INDEX IF NOT EXISTS "mission_tasks_node_idx"
  ON "mission_tasks" ("node_id");

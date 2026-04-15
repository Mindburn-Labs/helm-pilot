-- 0009 — opportunity clusters for Discover-mode "market themes" view (Phase 3a)

CREATE TABLE IF NOT EXISTS "opportunity_clusters" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL,
    "label" text NOT NULL,
    "summary" text NOT NULL,
    "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "member_count" integer NOT NULL DEFAULT 0,
    "avg_score" real,
    "method" text NOT NULL DEFAULT 'hdbscan',
    "centroid_blob" text,
    "generated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "expires_at" timestamp with time zone
);

ALTER TABLE "opportunity_clusters"
    ADD CONSTRAINT "opportunity_clusters_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "opportunity_clusters_workspace_idx"
    ON "opportunity_clusters" ("workspace_id");
CREATE INDEX IF NOT EXISTS "opportunity_clusters_workspace_score_idx"
    ON "opportunity_clusters" ("workspace_id", "avg_score");

CREATE TABLE IF NOT EXISTS "opportunity_cluster_members" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "cluster_id" uuid NOT NULL,
    "opportunity_id" uuid NOT NULL,
    "distance" real,
    "is_representative" boolean NOT NULL DEFAULT false
);

ALTER TABLE "opportunity_cluster_members"
    ADD CONSTRAINT "opportunity_cluster_members_cluster_id_fk"
    FOREIGN KEY ("cluster_id") REFERENCES "public"."opportunity_clusters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "opportunity_cluster_members"
    ADD CONSTRAINT "opportunity_cluster_members_opportunity_id_fk"
    FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "opportunity_cluster_members_cluster_idx"
    ON "opportunity_cluster_members" ("cluster_id");
CREATE INDEX IF NOT EXISTS "opportunity_cluster_members_opportunity_idx"
    ON "opportunity_cluster_members" ("opportunity_id");

CREATE TABLE "cofounder_candidate_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"user_id" uuid,
	"note_type" text DEFAULT 'note' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cofounder_candidate_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"profile_url" text,
	"raw_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cofounder_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"name" text NOT NULL,
	"headline" text,
	"location" text,
	"bio" text,
	"profile_url" text,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"fit_summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cofounder_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cofounder_match_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"founder_id" uuid,
	"candidate_id" uuid NOT NULL,
	"overall_score" real,
	"complement_score" real,
	"execution_score" real,
	"yc_fit_score" real,
	"risk_score" real,
	"reasoning" text,
	"scoring_method" text DEFAULT 'heuristic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cofounder_outreach_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"content" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "name" text DEFAULT 'Application' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "status" text DEFAULT 'discovered' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "action_tool" text;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "action_input" jsonb;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "action_output" jsonb;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "verdict" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "raw_data" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "cofounder_candidate_notes" ADD CONSTRAINT "cofounder_candidate_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_candidate_notes" ADD CONSTRAINT "cofounder_candidate_notes_candidate_id_cofounder_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."cofounder_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_candidate_notes" ADD CONSTRAINT "cofounder_candidate_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_candidate_sources" ADD CONSTRAINT "cofounder_candidate_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_candidates" ADD CONSTRAINT "cofounder_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_candidates" ADD CONSTRAINT "cofounder_candidates_source_id_cofounder_candidate_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."cofounder_candidate_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_follow_ups" ADD CONSTRAINT "cofounder_follow_ups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_follow_ups" ADD CONSTRAINT "cofounder_follow_ups_candidate_id_cofounder_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."cofounder_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_match_evaluations" ADD CONSTRAINT "cofounder_match_evaluations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_match_evaluations" ADD CONSTRAINT "cofounder_match_evaluations_founder_id_founder_profiles_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founder_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_match_evaluations" ADD CONSTRAINT "cofounder_match_evaluations_candidate_id_cofounder_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."cofounder_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_outreach_drafts" ADD CONSTRAINT "cofounder_outreach_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_outreach_drafts" ADD CONSTRAINT "cofounder_outreach_drafts_candidate_id_cofounder_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."cofounder_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_data" ADD CONSTRAINT "raw_data_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
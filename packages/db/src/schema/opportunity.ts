import { pgTable, uuid, text, timestamp, real, integer, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Opportunity Domain ───

export const opportunities = pgTable('opportunities', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  source: text('source').notNull(), // 'reddit', 'hn', 'producthunt', 'indiehackers', etc.
  sourceUrl: text('source_url'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('discovered'), // 'discovered', 'scoring', 'scored', 'selected', 'rejected'
  rawData: jsonb('raw_data'), // original scraped payload
  aiFriendlyOk: boolean('ai_friendly_ok').default(false),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const opportunityScores = pgTable(
  'opportunity_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    overallScore: real('overall_score'), // 0-100
    founderFitScore: real('founder_fit_score'), // 0-100
    marketSignal: real('market_signal'), // from LLM scoring
    feasibility: real('feasibility'),
    timing: real('timing'),
    scoringMethod: text('scoring_method').notNull(), // 'heuristic', 'llm', 'hybrid'
    policyDecisionId: text('policy_decision_id'),
    policyVersion: text('policy_version'),
    helmDocumentVersionPins: jsonb('helm_document_version_pins')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    modelUsage: jsonb('model_usage').$type<Record<string, unknown>>().notNull().default({}),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('opportunity_scores_policy_decision_idx').on(table.policyDecisionId)],
);

export const opportunityTags = pgTable('opportunity_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => opportunities.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
  source: text('source').notNull().default('system'), // 'system', 'llm', 'user'
});

// ─── Opportunity clustering (Phase 3a) ────────────────────────────────────
//
// Opportunities with similar market signals are grouped so the Discover
// surface can show market-themes-first rather than a flat list of 500
// near-duplicate leads. Populated by `pipelines/intelligence/cluster.py`
// on a nightly pg-boss cron; rebuildable from scratch without destroying
// the underlying `opportunities` rows.
//
// Clusters are workspace-scoped — different founders have different
// interests, so clustering honours the workspace's active interests.

export const opportunityClusters = pgTable(
  'opportunity_clusters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** One-sentence summary of the cluster — what binds these opportunities. */
    summary: text('summary').notNull(),
    /** Top representative tags, ordered by frequency. */
    tags: jsonb('tags').notNull().default([]),
    memberCount: integer('member_count').notNull().default(0),
    /** Averaged overall score of cluster members — used to rank clusters. */
    avgScore: real('avg_score'),
    method: text('method').notNull().default('hdbscan'),
    /** Embedding centroid, base64-encoded. Phase 3b materializes pgvector use. */
    centroidBlob: text('centroid_blob'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('opportunity_clusters_workspace_idx').on(table.workspaceId),
    index('opportunity_clusters_workspace_score_idx').on(table.workspaceId, table.avgScore),
  ],
);

/**
 * Many-to-many link from clusters to opportunities. Stored separately from
 * `opportunities.clusterId` because clusters are regenerated nightly and
 * memberships shift; a foreign key on the opportunity itself would make
 * rebuild a two-step dance.
 */
export const opportunityClusterMembers = pgTable(
  'opportunity_cluster_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => opportunityClusters.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    /** Distance from the cluster centroid (smaller → more representative). */
    distance: real('distance'),
    /** Whether this opportunity is one of the top-3 representatives shown in UI. */
    isRepresentative: boolean('is_representative').notNull().default(false),
  },
  (table) => [
    index('opportunity_cluster_members_cluster_idx').on(table.clusterId),
    index('opportunity_cluster_members_opportunity_idx').on(table.opportunityId),
  ],
);

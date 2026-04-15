import { pgTable, uuid, text, timestamp, real, jsonb, boolean } from 'drizzle-orm/pg-core';
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

export const opportunityScores = pgTable('opportunity_scores', {
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
  scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
});

export const opportunityTags = pgTable('opportunity_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => opportunities.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
  source: text('source').notNull().default('system'), // 'system', 'llm', 'user'
});

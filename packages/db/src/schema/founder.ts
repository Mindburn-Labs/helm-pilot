import { pgTable, uuid, text, timestamp, jsonb, integer, real } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { users } from './identity.js';

// ─── Founder Domain ───

export const founderProfiles = pgTable('founder_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .unique(),
  name: text('name').notNull(),
  background: text('background'),
  experience: text('experience'),
  interests: jsonb('interests').notNull().default([]),
  startupVector: text('startup_vector'), // inferred direction from assessment
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const founderAssessments = pgTable('founder_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  founderId: uuid('founder_id')
    .notNull()
    .references(() => founderProfiles.id, { onDelete: 'cascade' }),
  assessmentType: text('assessment_type').notNull(), // 'intake', 'skills', 'market_fit'
  responses: jsonb('responses').notNull(),
  analysis: text('analysis'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const founderStrengths = pgTable('founder_strengths', {
  id: uuid('id').primaryKey().defaultRandom(),
  founderId: uuid('founder_id')
    .notNull()
    .references(() => founderProfiles.id, { onDelete: 'cascade' }),
  dimension: text('dimension').notNull(), // 'technical', 'sales', 'design', 'ops', 'domain'
  score: integer('score').notNull(), // 0-100
  evidence: text('evidence'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Real Co-Founder Matching ───

export const cofounderCandidateSources = pgTable('cofounder_candidate_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('manual'), // 'yc_matching', 'linkedin', 'manual', 'import'
  externalId: text('external_id'),
  profileUrl: text('profile_url'),
  rawProfile: jsonb('raw_profile').notNull().default({}),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cofounderCandidates = pgTable('cofounder_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').references(() => cofounderCandidateSources.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  headline: text('headline'),
  location: text('location'),
  bio: text('bio'),
  profileUrl: text('profile_url'),
  strengths: jsonb('strengths').notNull().default([]),
  interests: jsonb('interests').notNull().default([]),
  preferredRoles: jsonb('preferred_roles').notNull().default([]),
  status: text('status').notNull().default('new'), // 'new', 'reviewing', 'contacted', 'interviewing', 'shortlisted', 'passed'
  fitSummary: text('fit_summary'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cofounderMatchEvaluations = pgTable('cofounder_match_evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  founderId: uuid('founder_id').references(() => founderProfiles.id, { onDelete: 'set null' }),
  candidateId: uuid('candidate_id')
    .notNull()
    .references(() => cofounderCandidates.id, { onDelete: 'cascade' }),
  overallScore: real('overall_score'),
  complementScore: real('complement_score'),
  executionScore: real('execution_score'),
  ycFitScore: real('yc_fit_score'),
  riskScore: real('risk_score'),
  reasoning: text('reasoning'),
  scoringMethod: text('scoring_method').notNull().default('heuristic'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cofounderCandidateNotes = pgTable('cofounder_candidate_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  candidateId: uuid('candidate_id')
    .notNull()
    .references(() => cofounderCandidates.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  noteType: text('note_type').notNull().default('note'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cofounderOutreachDrafts = pgTable('cofounder_outreach_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  candidateId: uuid('candidate_id')
    .notNull()
    .references(() => cofounderCandidates.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull().default('email'),
  subject: text('subject'),
  content: text('content').notNull(),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cofounderFollowUps = pgTable('cofounder_follow_ups', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  candidateId: uuid('candidate_id')
    .notNull()
    .references(() => cofounderCandidates.id, { onDelete: 'cascade' }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Application Domain (Mode E: Apply) ───

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Application'),
  targetProgram: text('target_program').notNull(), // 'yc', 'techstars', 'custom'
  status: text('status').notNull().default('draft'), // 'draft', 'in_review', 'submitted', 'accepted', 'rejected'
  deadline: timestamp('deadline', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
});

export const applicationDrafts = pgTable('application_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  section: text('section').notNull(), // 'company_description', 'problem', 'solution', 'traction', 'team', 'market', 'pitch'
  content: text('content').notNull(),
  version: text('version').notNull().default('1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applicationArtifacts = pgTable('application_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  artifactId: uuid('artifact_id').notNull(),
  role: text('role').notNull(), // 'pitch_deck', 'demo_video', 'financial_model', 'appendix'
});

import { pgTable, uuid, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Deploy Domain (Section 15) ───

export const deployTargets = pgTable('deploy_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // 'digitalocean-production', 'local-dev', etc.
  provider: text('provider').notNull(), // 'digitalocean', 'docker', 'local'
  config: jsonb('config').notNull().default({}), // provider-specific config
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id')
    .notNull()
    .references(() => deployTargets.id),
  artifactId: uuid('artifact_id'), // what was deployed
  status: text('status').notNull().default('pending'), // 'pending', 'building', 'deploying', 'live', 'failed', 'rolled_back'
  version: text('version'),
  url: text('url'), // live URL after deploy
  metadata: jsonb('metadata').default({}),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const deployHealth = pgTable('deploy_health', {
  id: uuid('id').primaryKey().defaultRandom(),
  deploymentId: uuid('deployment_id')
    .notNull()
    .references(() => deployments.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // 'healthy', 'degraded', 'down'
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  responseTimeMs: text('response_time_ms'),
  details: jsonb('details').default({}),
});

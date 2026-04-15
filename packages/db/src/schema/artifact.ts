import { pgTable, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Artifact Domain ───
// Metadata in Postgres; blobs in S3/local storage.

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'landing_page', 'pdf', 'code', 'design', 'copy', 'pitch_deck', 'application'
  name: text('name').notNull(),
  description: text('description'),
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  metadata: jsonb('metadata').default({}),
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const artifactVersions = pgTable('artifact_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  artifactId: uuid('artifact_id')
    .notNull()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  storagePath: text('storage_path').notNull(),
  sizeBytes: integer('size_bytes'),
  changelog: text('changelog'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

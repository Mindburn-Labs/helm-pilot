import { pgTable, uuid, text, timestamp, jsonb, integer, index, customType } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

/** pgvector column type — stored as PostgreSQL `vector(1536)`. */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config: unknown) {
    const dims = (config as { dimensions?: number } | undefined)?.dimensions ?? 1536;
    return `vector(${dims})`;
  },
  toDriver(value: number[]) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns strings like '[1,2,3]'
    return JSON.parse(value) as number[];
  },
});

// ─── Knowledge Domain (GBrain-style) ───
// Compiled truth + timeline per entity. MECE entity registry.
// Hybrid search: keyword (tsvector) + vector (pgvector) with RRF.

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'person', 'company', 'opportunity', 'concept', 'source', 'project'
    title: text('title').notNull(),
    compiledTruth: text('compiled_truth').notNull().default(''), // canonical summary
    tags: jsonb('tags').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pages_type_idx').on(table.type)],
);

export const contentChunks = pgTable(
  'content_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    embedding: jsonb('embedding'), // Legacy JSON array (deprecated, kept for backward compat)
    embeddingVec: vector('embedding_vec', { dimensions: 1536 }), // pgvector column for fast ANN search
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chunks_page_idx').on(table.pageId)],
);

export const links = pgTable('links', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromPageId: uuid('from_page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  toPageId: uuid('to_page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  relation: text('relation').notNull(), // 'related_to', 'founded_by', 'part_of', 'derived_from'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  category: text('category'), // 'industry', 'technology', 'stage', 'topic'
});

export const timelineEntries = pgTable(
  'timeline_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // 'created', 'updated', 'milestone', 'note', 'reflection'
    content: text('content').notNull(),
    source: text('source'), // which service wrote this
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('timeline_page_idx').on(table.pageId)],
);

export const rawData = pgTable('raw_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
  sourceType: text('source_type').notNull(), // 'scrape', 'import', 'manual', 'api'
  sourceUrl: text('source_url'),
  content: text('content').notNull(),
  metadata: jsonb('metadata').default({}),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, vector } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Intel Domain (YC + public startup data) ───
// Section 39.4: Every ingestion result must track source origin, source type,
// fetch time, parser version, and whether source was public or user-authorized.

export const ycCompanies = pgTable('yc_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  description: text('description'),
  longDescription: text('long_description'),
  batchId: uuid('batch_id').references(() => ycBatches.id),
  industry: text('industry'),
  subIndustry: text('sub_industry'),
  status: text('status'), // 'active', 'acquired', 'dead', 'public'
  teamSize: integer('team_size'),
  url: text('url'),
  tags: jsonb('tags').notNull().default([]),
  scrapedAt: timestamp('scraped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ycFounders = pgTable('yc_founders', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => ycCompanies.id),
  name: text('name').notNull(),
  role: text('role'),
  bio: text('bio'),
  linkedinUrl: text('linkedin_url'),
  twitterUrl: text('twitter_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ycBatches = pgTable('yc_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(), // 'W24', 'S23', etc.
  season: text('season').notNull(), // 'winter', 'summer'
  year: integer('year').notNull(),
  companyCount: integer('company_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ycCourses = pgTable('yc_courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  program: text('program').notNull(), // 'startup_school', 'core_curriculum'
  module: text('module').notNull(), // 'Idea', 'Product', 'Growth'
  title: text('title').notNull(),
  description: text('description'),
  url: text('url'),
  order: integer('order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ycAdvice = pgTable('yc_advice', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(), // 'startup_school', 'blog', 'video', 'essay'
  title: text('title').notNull(),
  content: text('content').notNull(),
  author: text('author'),
  url: text('url'),
  tags: jsonb('tags').notNull().default([]),
  embeddings: vector('embeddings', { dimensions: 1536 }), // OpenAI ada-002 / text-embedding-3
  courseId: uuid('course_id').references(() => ycCourses.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scrapedSources = pgTable('scraped_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: text('source_type').notNull(), // 'yc_directory', 'yc_blog', 'startup_school'
  url: text('url').notNull(),
  lastScrapedAt: timestamp('last_scraped_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'), // 'pending', 'completed', 'failed'
  itemCount: integer('item_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Ingestion Provenance (Section 39.4) ───
// Every ingestion result tracks: source origin, source type, fetch time,
// parser version, and whether source was public or user-authorized.

export const ingestionRecords = pgTable('ingestion_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceOrigin: text('source_origin').notNull(), // URL or path
  sourceType: text('source_type').notNull(), // 'scrape', 'import', 'upload', 'api', 'authorized_session'
  isPublic: boolean('is_public').notNull().default(true), // false = user-authorized private data
  parserVersion: text('parser_version'), // semver of parser used
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  parsedAt: timestamp('parsed_at', { withTimezone: true }),
  itemCount: integer('item_count').default(0),
  rawStoragePath: text('raw_storage_path'), // path to raw capture in object storage
  status: text('status').notNull().default('pending'), // 'pending', 'parsed', 'failed'
  error: text('error'),
  metadata: jsonb('metadata').default({}),
  replayCount: integer('replay_count').notNull().default(0),
  lastReplayedAt: timestamp('last_replayed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crawlSources = pgTable('crawl_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  sourceType: text('source_type').notNull(), // 'yc_directory', 'yc_library', 'startup_school', 'watchlist'
  fetchStrategy: text('fetch_strategy').notNull().default('fetcher'), // 'fetcher', 'dynamic', 'stealthy'
  authRequirement: text('auth_requirement').notNull().default('public'), // 'public', 'session', 'oauth'
  parserVersion: text('parser_version'),
  schedule: text('schedule'),
  escalationPolicy: text('escalation_policy').notNull().default('retry_stealthy'),
  config: jsonb('config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crawlRuns = pgTable('crawl_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => crawlSources.id, { onDelete: 'cascade' }),
  ingestionRecordId: uuid('ingestion_record_id').references(() => ingestionRecords.id, { onDelete: 'set null' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('public'), // 'public', 'private', 'replay'
  status: text('status').notNull().default('queued'), // 'queued', 'running', 'completed', 'failed'
  itemCount: integer('item_count').notNull().default(0),
  checkpointDir: text('checkpoint_dir'),
  liveStreamKey: text('live_stream_key'),
  error: text('error'),
  metadata: jsonb('metadata').notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const rawCaptures = pgTable('raw_captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  crawlRunId: uuid('crawl_run_id')
    .notNull()
    .references(() => crawlRuns.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull(),
  contentType: text('content_type').notNull().default('text/html'),
  storagePath: text('storage_path').notNull(),
  checksum: text('checksum'),
  sizeBytes: integer('size_bytes'),
  metadata: jsonb('metadata').notNull().default({}),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crawlCheckpoints = pgTable('crawl_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  crawlRunId: uuid('crawl_run_id')
    .notNull()
    .references(() => crawlRuns.id, { onDelete: 'cascade' }),
  checkpointKey: text('checkpoint_key').notNull(),
  storagePath: text('storage_path'),
  cursor: text('cursor'),
  lastSeenUrl: text('last_seen_url'),
  metadata: jsonb('metadata').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

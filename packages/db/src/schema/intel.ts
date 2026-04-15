import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, vector } from 'drizzle-orm/pg-core';

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

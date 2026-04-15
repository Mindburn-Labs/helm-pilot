import { pgTable, uuid, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Connector Domain ───

export const connectors = pgTable('connectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(), // 'gmail', 'github', 'stripe', 'linear', 'slack'
  displayName: text('display_name').notNull(),
  authType: text('auth_type').notNull(), // 'oauth2', 'api_key', 'token', 'session', 'none'
  configSchema: jsonb('config_schema'), // Zod-compatible JSON schema for connector config
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connectorGrants = pgTable('connector_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id')
    .notNull()
    .references(() => connectors.id),
  scopes: jsonb('scopes').notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const connectorTokens = pgTable('connector_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  grantId: uuid('grant_id')
    .notNull()
    .references(() => connectorGrants.id, { onDelete: 'cascade' }),
  accessTokenEnc: text('access_token_enc').notNull(), // encrypted
  refreshTokenEnc: text('refresh_token_enc'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connectorSessions = pgTable('connector_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  grantId: uuid('grant_id')
    .notNull()
    .references(() => connectorGrants.id, { onDelete: 'cascade' })
    .unique(),
  sessionType: text('session_type').notNull().default('browser_storage_state'),
  sessionDataEnc: text('session_data_enc').notNull(), // encrypted JSON payload
  metadata: jsonb('metadata').notNull().default({}),
  lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

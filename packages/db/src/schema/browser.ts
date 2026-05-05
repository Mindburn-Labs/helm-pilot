import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { tasks } from './tasking.js';
import { actions } from './tooling.js';
import { evidencePacks } from './governance.js';

// ─── Browser Operation Domain ───
//
// Read-only, session-backed browser operation. These records deliberately
// model founder-granted session boundaries and redacted observations. They do
// not store cookies, passwords, tokens, or browser profile exports.

export const browserSessions = pgTable(
  'browser_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    browser: text('browser').notNull().default('unknown'),
    profileLabel: text('profile_label'),
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('browser_sessions_workspace_status_idx').on(table.workspaceId, table.status),
    index('browser_sessions_user_idx').on(table.userId),
  ],
);

export const browserSessionGrants = pgTable(
  'browser_session_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => browserSessions.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    ventureId: uuid('venture_id'),
    missionId: uuid('mission_id'),
    grantedToType: text('granted_to_type').notNull().default('agent'),
    grantedToId: uuid('granted_to_id'),
    scope: text('scope').notNull().default('read_extract'),
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('browser_grants_workspace_status_idx').on(table.workspaceId, table.status),
    index('browser_grants_session_idx').on(table.sessionId),
    index('browser_grants_task_idx').on(table.taskId),
  ],
);

export const browserActions = pgTable(
  'browser_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => browserSessions.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => browserSessionGrants.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    toolActionId: uuid('tool_action_id').references(() => actions.id, { onDelete: 'set null' }),
    actionType: text('action_type').notNull().default('read_extract'),
    objective: text('objective'),
    url: text('url').notNull(),
    origin: text('origin').notNull(),
    status: text('status').notNull().default('completed'),
    policyDecisionId: text('policy_decision_id'),
    policyVersion: text('policy_version'),
    evidencePackId: uuid('evidence_pack_id').references(() => evidencePacks.id, {
      onDelete: 'set null',
    }),
    replayIndex: integer('replay_index').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('browser_actions_workspace_idx').on(table.workspaceId, table.createdAt),
    index('browser_actions_session_idx').on(table.sessionId, table.replayIndex),
    index('browser_actions_grant_idx').on(table.grantId),
    index('browser_actions_task_idx').on(table.taskId),
    index('browser_actions_tool_action_idx').on(table.toolActionId),
    index('browser_actions_policy_decision_idx').on(table.policyDecisionId),
    index('browser_actions_evidence_pack_idx').on(table.evidencePackId),
  ],
);

export const browserObservations = pgTable(
  'browser_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => browserSessions.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => browserSessionGrants.id, { onDelete: 'cascade' }),
    browserActionId: uuid('browser_action_id').references(() => browserActions.id, {
      onDelete: 'set null',
    }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    actionId: uuid('action_id').references(() => actions.id, { onDelete: 'set null' }),
    evidencePackId: uuid('evidence_pack_id').references(() => evidencePacks.id, {
      onDelete: 'set null',
    }),
    url: text('url').notNull(),
    origin: text('origin').notNull(),
    title: text('title'),
    objective: text('objective'),
    domHash: text('dom_hash'),
    screenshotHash: text('screenshot_hash'),
    screenshotRef: text('screenshot_ref'),
    redactedDomSnapshot: text('redacted_dom_snapshot'),
    extractedData: jsonb('extracted_data').notNull().default({}),
    redactions: jsonb('redactions').$type<string[]>().notNull().default([]),
    replayIndex: integer('replay_index').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('browser_observations_workspace_idx').on(table.workspaceId, table.observedAt),
    index('browser_observations_session_idx').on(table.sessionId, table.replayIndex),
    index('browser_observations_grant_idx').on(table.grantId),
    index('browser_observations_browser_action_idx').on(table.browserActionId),
    index('browser_observations_task_idx').on(table.taskId),
    index('browser_observations_action_idx').on(table.actionId),
    index('browser_observations_evidence_pack_idx').on(table.evidencePackId),
  ],
);

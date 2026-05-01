import { pgTable, uuid, text, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Audit Domain ───
// Trust boundary enforcement, approval flows, policy violations.
// Ported from money-engine/hooks/pretooluse.py patterns.

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    target: text('target'),
    verdict: text('verdict').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_workspace_idx').on(table.workspaceId),
    index('audit_created_idx').on(table.createdAt),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id'),
    action: text('action').notNull(),
    actionInput: jsonb('action_input'),
    actionHash: text('action_hash'),
    policyVersion: text('policy_version'),
    approvalContext: jsonb('approval_context').default({}),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    requestedBy: text('requested_by').notNull(),
    resolvedBy: text('resolved_by'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('approvals_workspace_idx').on(table.workspaceId),
    index('approvals_status_idx').on(table.status),
    index('approvals_action_hash_idx').on(table.workspaceId, table.taskId, table.actionHash),
  ],
);

export const policyViolations = pgTable('policy_violations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  policyRule: text('policy_rule').notNull(),
  violation: text('violation').notNull(),
  severity: text('severity').notNull().default('warning'), // 'info', 'warning', 'critical'
  action: text('action').notNull(), // what was attempted
  blocked: boolean('blocked').notNull().default(true),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

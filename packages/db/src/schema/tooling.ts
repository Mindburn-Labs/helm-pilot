import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { tasks, taskRuns } from './tasking.js';

// ─── Tool Broker Domain ───
//
// Durable action/tool execution ledger. This is intentionally additive: the
// existing task_runs replay table remains the agent-loop backbone, while these
// rows make the tool-call layer queryable by action, idempotency key, HELM
// policy decision, and workspace.

export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ventureId: uuid('venture_id'),
    missionId: uuid('mission_id'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    taskRunId: uuid('task_run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull().default('agent'),
    actorId: uuid('actor_id'),
    actionKey: text('action_key').notNull(),
    actionType: text('action_type').notNull().default('tool'),
    riskClass: text('risk_class').notNull().default('low'),
    status: text('status').notNull().default('running'),
    inputHash: text('input_hash'),
    outputHash: text('output_hash'),
    policyDecisionId: text('policy_decision_id'),
    policyVersion: text('policy_version'),
    helmDocumentVersionPins: jsonb('helm_document_version_pins')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('actions_workspace_status_idx').on(table.workspaceId, table.status),
    index('actions_task_idx').on(table.taskId),
    index('actions_task_run_idx').on(table.taskRunId),
    index('actions_policy_decision_idx').on(table.policyDecisionId),
  ],
);

export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ventureId: uuid('venture_id'),
    missionId: uuid('mission_id'),
    actionId: uuid('action_id').references(() => actions.id, { onDelete: 'set null' }),
    taskRunId: uuid('task_run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    toolKey: text('tool_key').notNull(),
    inputHash: text('input_hash').notNull(),
    sanitizedInput: jsonb('sanitized_input').notNull().default({}),
    outputHash: text('output_hash'),
    sanitizedOutput: jsonb('sanitized_output'),
    status: text('status').notNull().default('running'),
    idempotencyKey: text('idempotency_key').notNull(),
    evidenceIds: jsonb('evidence_ids').notNull().default([]),
    policyDecisionId: text('policy_decision_id'),
    policyVersion: text('policy_version'),
    helmDocumentVersionPins: jsonb('helm_document_version_pins')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tool_executions_idempotency_idx').on(table.workspaceId, table.idempotencyKey),
    index('tool_executions_workspace_status_idx').on(table.workspaceId, table.status),
    index('tool_executions_action_idx').on(table.actionId),
    index('tool_executions_task_run_idx').on(table.taskRunId),
    index('tool_executions_policy_decision_idx').on(table.policyDecisionId),
  ],
);

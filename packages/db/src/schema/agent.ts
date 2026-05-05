import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { tasks, taskRuns } from './tasking.js';

// Agent runtime domain
//
// Durable handoff records for parent-agent -> subagent delegation. The
// task_runs table remains the replay/proof backbone; agent_handoffs captures
// the delegation protocol state and skill metadata at the handoff boundary.

export const agentHandoffs = pgTable(
  'agent_handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    parentTaskRunId: uuid('parent_task_run_id').references(() => taskRuns.id, {
      onDelete: 'set null',
    }),
    childTaskRunId: uuid('child_task_run_id').references(() => taskRuns.id, {
      onDelete: 'set null',
    }),
    fromAgent: text('from_agent').notNull(),
    toAgent: text('to_agent').notNull(),
    handoffKind: text('handoff_kind').notNull().default('subagent_spawn'),
    status: text('status').notNull().default('running'),
    skillInvocations: jsonb('skill_invocations').notNull().default([]),
    input: jsonb('input').notNull().default({}),
    output: jsonb('output'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('agent_handoffs_workspace_task_idx').on(table.workspaceId, table.taskId),
    index('agent_handoffs_parent_idx').on(table.parentTaskRunId),
    index('agent_handoffs_child_idx').on(table.childTaskRunId),
    index('agent_handoffs_status_idx').on(table.status),
  ],
);

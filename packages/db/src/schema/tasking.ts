import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { operators } from './operator.js';

// ─── Tasking Domain ───

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    operatorId: uuid('operator_id').references(() => operators.id),
    parentTaskId: uuid('parent_task_id'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('pending'),
    priority: integer('priority').notNull().default(0),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('tasks_workspace_idx').on(table.workspaceId),
    index('tasks_status_idx').on(table.status),
    index('tasks_operator_idx').on(table.operatorId),
  ],
);

export const taskRuns = pgTable(
  'task_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('running'),
    actionTool: text('action_tool'),
    actionInput: jsonb('action_input'),
    actionHash: text('action_hash'),
    actionOutput: jsonb('action_output'),
    verdict: text('verdict'),
    iterationsUsed: integer('iterations_used').default(0),
    iterationBudget: integer('iteration_budget').default(50),
    modelUsed: text('model_used'),
    tokensIn: integer('tokens_in').default(0),
    tokensOut: integer('tokens_out').default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).default('0'),
    error: text('error'),
    // ─── HELM governance anchors (Phase 1) ───
    // Every row produced by the orchestrator after Phase 1 carries the upstream
    // HELM decision ID and policy version. Inspectable alongside the action it
    // governed; cross-referenced with evidence_packs for full audit chain.
    helmDecisionId: text('helm_decision_id'),
    helmPolicyVersion: text('helm_policy_version'),
    helmReasonCode: text('helm_reason_code'),
    // ─── Governed-subagent lineage (Phase 12) ───
    // When this row represents a subagent run, parentTaskRunId points at the
    // parent conductor's run. operatorRole carries the subagent's role for
    // audit queries ("every Content Operator action last week"). Budget slice
    // columns track USD allocated vs consumed inside this child. All null for
    // non-subagent rows — additive, zero-regression.
    parentTaskRunId: uuid('parent_task_run_id'),
    rootTaskRunId: uuid('root_task_run_id'),
    spawnedByActionId: uuid('spawned_by_action_id'),
    lineageKind: text('lineage_kind').notNull().default('parent_action'),
    runSequence: integer('run_sequence').notNull().default(0),
    checkpointId: text('checkpoint_id'),
    operatorRole: text('operator_role'),
    budgetSliceUsed: numeric('budget_slice_used', { precision: 10, scale: 4 }).default('0'),
    budgetSliceAllocated: numeric('budget_slice_allocated', { precision: 10, scale: 4 }),
    skillInvocations: jsonb('skill_invocations').notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Phase 16 Track N — long-running / 8-hour autonomous execution.
    // Backed by migration 0014.
    checkpointState: jsonb('checkpoint_state'),
    lastCheckpointAt: timestamp('last_checkpoint_at', { withTimezone: true }),
    watchdogAlertedAt: timestamp('watchdog_alerted_at', { withTimezone: true }),
  },
  (table) => [
    index('task_runs_task_replay_idx').on(
      table.taskId,
      table.lineageKind,
      table.runSequence,
      table.startedAt,
      table.id,
    ),
    index('task_runs_parent_idx').on(table.parentTaskRunId),
    index('task_runs_root_idx').on(table.rootTaskRunId),
    index('task_runs_spawned_by_action_idx').on(table.spawnedByActionId),
  ],
);

export const taskArtifacts = pgTable('task_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  artifactId: uuid('artifact_id').notNull(),
  role: text('role').notNull().default('output'), // 'input', 'output', 'reference'
});

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'), // 'draft', 'active', 'completed', 'abandoned'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const milestones = pgTable('milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull().default(0),
});

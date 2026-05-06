import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { tasks } from './tasking.js';

// ─── Venture / Mission Runtime Domain ───
//
// This is the durable startup-OS backbone that lifecycle compilation can
// persist into before any autonomous execution begins. It is intentionally
// execution-neutral: the task/action/tool/evidence ledgers remain the runtime
// proof layers, while these tables hold venture, goal, mission, and DAG state.

export const ventures = pgTable(
  'ventures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    dnaDocumentId: uuid('dna_document_id'),
    phenotypeDocumentId: uuid('phenotype_document_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('ventures_workspace_status_idx').on(table.workspaceId, table.status),
    index('ventures_workspace_created_idx').on(table.workspaceId, table.createdAt),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ventureId: uuid('venture_id').references(() => ventures.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull().default('draft'),
    autonomyMode: text('autonomy_mode').notNull().default('review'),
    constraints: jsonb('constraints').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('goals_workspace_status_idx').on(table.workspaceId, table.status),
    index('goals_venture_idx').on(table.ventureId),
  ],
);

export const missions = pgTable(
  'missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ventureId: uuid('venture_id').references(() => ventures.id, { onDelete: 'set null' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    missionKey: text('mission_key').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('compiled'),
    compilerVersion: text('compiler_version'),
    autonomyMode: text('autonomy_mode').notNull().default('review'),
    capabilityState: text('capability_state').notNull().default('prototype'),
    productionReady: boolean('production_ready').notNull().default(false),
    assumptions: jsonb('assumptions').$type<string[]>().notNull().default([]),
    blockers: jsonb('blockers').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('missions_workspace_key_idx').on(table.workspaceId, table.missionKey),
    index('missions_workspace_status_idx').on(table.workspaceId, table.status),
    index('missions_venture_idx').on(table.ventureId),
    index('missions_goal_idx').on(table.goalId),
  ],
);

export const missionNodes = pgTable(
  'mission_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    nodeKey: text('node_key').notNull(),
    stage: text('stage').notNull(),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    status: text('status').notNull().default('pending'),
    sortOrder: integer('sort_order').notNull().default(0),
    requiredAgents: jsonb('required_agents').$type<string[]>().notNull().default([]),
    requiredSkills: jsonb('required_skills').$type<string[]>().notNull().default([]),
    requiredTools: jsonb('required_tools').$type<string[]>().notNull().default([]),
    requiredEvidence: jsonb('required_evidence').$type<string[]>().notNull().default([]),
    helmPolicyClasses: jsonb('helm_policy_classes').$type<string[]>().notNull().default([]),
    escalationConditions: jsonb('escalation_conditions').$type<string[]>().notNull().default([]),
    acceptanceCriteria: jsonb('acceptance_criteria').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('mission_nodes_mission_key_idx').on(table.missionId, table.nodeKey),
    index('mission_nodes_workspace_status_idx').on(table.workspaceId, table.status),
    index('mission_nodes_mission_order_idx').on(table.missionId, table.sortOrder),
    index('mission_nodes_stage_idx').on(table.stage),
  ],
);

export const missionEdges = pgTable(
  'mission_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    edgeKey: text('edge_key').notNull(),
    fromNodeKey: text('from_node_key').notNull(),
    toNodeKey: text('to_node_key').notNull(),
    reason: text('reason').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('mission_edges_mission_key_idx').on(table.missionId, table.edgeKey),
    index('mission_edges_workspace_idx').on(table.workspaceId),
    index('mission_edges_mission_from_idx').on(table.missionId, table.fromNodeKey),
    index('mission_edges_mission_to_idx').on(table.missionId, table.toNodeKey),
  ],
);

export const missionTasks = pgTable(
  'mission_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => missionNodes.id, { onDelete: 'set null' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('execution_task'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('mission_tasks_mission_task_idx').on(table.missionId, table.taskId),
    index('mission_tasks_workspace_idx').on(table.workspaceId),
    index('mission_tasks_node_idx').on(table.nodeId),
  ],
);

export const missionRuntimeCheckpoints = pgTable(
  'mission_runtime_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    checkpointKind: text('checkpoint_kind').notNull(),
    checkpointStatus: text('checkpoint_status').notNull().default('recorded'),
    missionStatus: text('mission_status').notNull(),
    cursorNodeId: uuid('cursor_node_id').references(() => missionNodes.id, {
      onDelete: 'set null',
    }),
    cursorNodeKey: text('cursor_node_key'),
    nodeStatusCounts: jsonb('node_status_counts')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    readyNodeIds: jsonb('ready_node_ids').$type<string[]>().notNull().default([]),
    blockedNodeIds: jsonb('blocked_node_ids').$type<string[]>().notNull().default([]),
    failedNodeIds: jsonb('failed_node_ids').$type<string[]>().notNull().default([]),
    awaitingApprovalNodeIds: jsonb('awaiting_approval_node_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    taskRunCheckpointRefs: jsonb('task_run_checkpoint_refs')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    recoveryPlan: jsonb('recovery_plan').notNull().default({}),
    rollbackPlan: jsonb('rollback_plan').notNull().default({}),
    evidenceItemId: uuid('evidence_item_id'),
    contentHash: text('content_hash').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mission_runtime_checkpoints_workspace_mission_idx').on(
      table.workspaceId,
      table.missionId,
      table.createdAt,
    ),
    index('mission_runtime_checkpoints_kind_idx').on(table.missionId, table.checkpointKind),
    index('mission_runtime_checkpoints_status_idx').on(table.workspaceId, table.missionStatus),
  ],
);

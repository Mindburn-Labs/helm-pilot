import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { artifacts } from './artifact.js';
import { auditLog } from './audit.js';
import { browserObservations } from './browser.js';
import { computerActions } from './computer.js';
import { evidencePacks } from './governance.js';
import { missions, ventures } from './mission.js';
import { tasks, taskRuns } from './tasking.js';
import { actions, toolExecutions } from './tooling.js';
import { workspaces } from './workspace.js';

// ─── Evidence Ledger Domain ───
//
// Canonical cross-surface evidence index. Source records still own their
// specialized payloads; evidence_items is the queryable, redacted, replayable
// ledger that links action/tool/browser/computer/artifact/audit surfaces.

export const evidenceItems = pgTable(
  'evidence_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ventureId: uuid('venture_id').references(() => ventures.id, { onDelete: 'set null' }),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    taskRunId: uuid('task_run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    actionId: uuid('action_id').references(() => actions.id, { onDelete: 'set null' }),
    toolExecutionId: uuid('tool_execution_id').references(() => toolExecutions.id, {
      onDelete: 'set null',
    }),
    evidencePackId: uuid('evidence_pack_id').references(() => evidencePacks.id, {
      onDelete: 'set null',
    }),
    browserObservationId: uuid('browser_observation_id').references(() => browserObservations.id, {
      onDelete: 'set null',
    }),
    computerActionId: uuid('computer_action_id').references(() => computerActions.id, {
      onDelete: 'set null',
    }),
    artifactId: uuid('artifact_id').references(() => artifacts.id, { onDelete: 'set null' }),
    auditEventId: uuid('audit_event_id').references(() => auditLog.id, { onDelete: 'set null' }),
    evidenceType: text('evidence_type').notNull(),
    sourceType: text('source_type').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    redactionState: text('redaction_state').notNull().default('unknown'),
    sensitivity: text('sensitivity').notNull().default('internal'),
    contentHash: text('content_hash'),
    storageRef: text('storage_ref'),
    replayRef: text('replay_ref'),
    metadata: jsonb('metadata').notNull().default({}),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('evidence_items_workspace_observed_idx').on(table.workspaceId, table.observedAt),
    index('evidence_items_workspace_type_idx').on(table.workspaceId, table.evidenceType),
    index('evidence_items_venture_idx').on(table.ventureId),
    index('evidence_items_mission_idx').on(table.missionId),
    index('evidence_items_task_idx').on(table.taskId),
    index('evidence_items_task_run_idx').on(table.taskRunId),
    index('evidence_items_action_idx').on(table.actionId),
    index('evidence_items_tool_execution_idx').on(table.toolExecutionId),
    index('evidence_items_evidence_pack_idx').on(table.evidencePackId),
    index('evidence_items_browser_observation_idx').on(table.browserObservationId),
    index('evidence_items_computer_action_idx').on(table.computerActionId),
    index('evidence_items_artifact_idx').on(table.artifactId),
    index('evidence_items_audit_event_idx').on(table.auditEventId),
    index('evidence_items_content_hash_idx').on(table.contentHash),
  ],
);

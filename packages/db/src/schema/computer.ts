import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { tasks } from './tasking.js';
import { actions } from './tooling.js';
import { evidencePacks } from './governance.js';

// ─── Computer / Sandbox Operation Domain ───
//
// Governed local/sandbox action records. These rows capture the narrow safe
// Gate 7 substrate: terminal status/read commands, project-scoped file
// reads/writes, and local dev-server checks. They deliberately do not model
// unrestricted desktop automation.

export const computerActions = pgTable(
  'computer_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    toolActionId: uuid('tool_action_id').references(() => actions.id, { onDelete: 'set null' }),
    operatorId: uuid('operator_id'),
    actionType: text('action_type').notNull(),
    environment: text('environment').notNull().default('local'),
    objective: text('objective').notNull(),
    status: text('status').notNull().default('running'),
    cwd: text('cwd'),
    command: text('command'),
    args: jsonb('args').$type<string[]>().notNull().default([]),
    filePath: text('file_path'),
    devServerUrl: text('dev_server_url'),
    stdout: text('stdout'),
    stderr: text('stderr'),
    exitCode: integer('exit_code'),
    durationMs: integer('duration_ms'),
    fileDiff: text('file_diff'),
    outputHash: text('output_hash'),
    policyDecisionId: text('policy_decision_id'),
    policyVersion: text('policy_version'),
    helmDocumentVersionPins: jsonb('helm_document_version_pins')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    evidencePackId: uuid('evidence_pack_id').references(() => evidencePacks.id, {
      onDelete: 'set null',
    }),
    replayIndex: integer('replay_index').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('computer_actions_workspace_idx').on(table.workspaceId, table.createdAt),
    index('computer_actions_task_idx').on(table.taskId),
    index('computer_actions_tool_action_idx').on(table.toolActionId),
    index('computer_actions_policy_decision_idx').on(table.policyDecisionId),
    index('computer_actions_evidence_pack_idx').on(table.evidencePackId),
    index('computer_actions_replay_idx').on(table.workspaceId, table.taskId, table.replayIndex),
  ],
);

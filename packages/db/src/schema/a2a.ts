import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { tasks } from './tasking.js';

// A2A Domain
//
// Durable A2A state for Pilot-as-server protocol requests. The gateway no
// longer treats A2A task status as process-local; every thread/message is
// workspace-scoped and can be reconstructed after restart.

export const a2aThreads = pgTable(
  'a2a_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    externalTaskId: text('external_task_id').notNull(),
    pilotTaskId: uuid('pilot_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    status: text('status').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('a2a_threads_workspace_external_idx').on(table.workspaceId, table.externalTaskId),
    index('a2a_threads_workspace_status_idx').on(table.workspaceId, table.status),
    index('a2a_threads_pilot_task_idx').on(table.pilotTaskId),
  ],
);

export const a2aMessages = pgTable(
  'a2a_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => a2aThreads.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    parts: jsonb('parts').notNull(),
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('a2a_messages_thread_sequence_idx').on(table.threadId, table.sequence),
    index('a2a_messages_workspace_idx').on(table.workspaceId),
  ],
);

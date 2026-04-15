import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Operator Domain ───

export const operators = pgTable(
  'operators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull(),
    goal: text('goal').notNull(),
    constraints: jsonb('constraints').notNull().default([]),
    tools: jsonb('tools').notNull().default([]),
    isActive: text('is_active').notNull().default('true'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('operators_workspace_idx').on(table.workspaceId)],
);

export const operatorRoles = pgTable('operator_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  defaultGoal: text('default_goal').notNull(),
  defaultConstraints: jsonb('default_constraints').notNull().default([]),
  defaultTools: jsonb('default_tools').notNull().default([]),
  systemPrompt: text('system_prompt'),
});

export const operatorMemory = pgTable('operator_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => operators.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const operatorConfigs = pgTable('operator_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => operators.id, { onDelete: 'cascade' })
    .unique(),
  modelPreference: text('model_preference'), // preferred LLM model
  iterationBudget: jsonb('iteration_budget').notNull().default({ maxIterations: 50 }),
  skillFiles: jsonb('skill_files').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

// ─── Production Eval Domain ───
//
// Gate 10 stores eval scenarios, run records, evidence links, pass/fail
// results, and promotion eligibility. Capability registry state is still
// updated by source-controlled metadata only; these rows prove eligibility,
// they do not silently mark capabilities production_ready.

export const evaluations = pgTable(
  'evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evalId: text('eval_id').notNull().unique(),
    name: text('name').notNull(),
    capabilityKeys: jsonb('capability_keys').$type<string[]>().notNull().default([]),
    scenario: jsonb('scenario').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('evaluations_eval_id_idx').on(table.evalId),
    index('evaluations_created_at_idx').on(table.createdAt),
  ],
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    evalId: text('eval_id').notNull(),
    status: text('status').notNull().default('running'),
    capabilityKey: text('capability_key'),
    runRef: text('run_ref'),
    failureReason: text('failure_reason'),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    auditReceiptRefs: jsonb('audit_receipt_refs').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('eval_runs_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('eval_runs_workspace_eval_idx').on(table.workspaceId, table.evalId),
    index('eval_runs_workspace_status_idx').on(table.workspaceId, table.status),
    index('eval_runs_workspace_capability_idx').on(table.workspaceId, table.capabilityKey),
  ],
);

export const evalSteps = pgTable(
  'eval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evalRunId: uuid('eval_run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    stepKey: text('step_key').notNull(),
    status: text('status').notNull().default('running'),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    auditReceiptRefs: jsonb('audit_receipt_refs').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('eval_steps_run_idx').on(table.evalRunId),
    index('eval_steps_run_step_idx').on(table.evalRunId, table.stepKey),
  ],
);

export const evalResults = pgTable(
  'eval_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    evalRunId: uuid('eval_run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    evalId: text('eval_id').notNull(),
    capabilityKey: text('capability_key'),
    status: text('status').notNull(),
    passed: boolean('passed').notNull().default(false),
    summary: text('summary'),
    blockers: jsonb('blockers').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('eval_results_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('eval_results_run_idx').on(table.evalRunId),
    index('eval_results_workspace_eval_idx').on(table.workspaceId, table.evalId),
    index('eval_results_workspace_capability_idx').on(table.workspaceId, table.capabilityKey),
  ],
);

export const evalEvidenceLinks = pgTable(
  'eval_evidence_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    evalRunId: uuid('eval_run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    evidenceRef: text('evidence_ref').notNull(),
    auditReceiptRef: text('audit_receipt_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('eval_evidence_links_workspace_idx').on(table.workspaceId),
    index('eval_evidence_links_run_idx').on(table.evalRunId),
    index('eval_evidence_links_evidence_ref_idx').on(table.evidenceRef),
  ],
);

export const capabilityPromotions = pgTable(
  'capability_promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    capabilityKey: text('capability_key').notNull(),
    evalRunId: uuid('eval_run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('eligible'),
    promotedState: text('promoted_state').notNull().default('production_ready'),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    auditReceiptRefs: jsonb('audit_receipt_refs').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('capability_promotions_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('capability_promotions_workspace_capability_idx').on(
      table.workspaceId,
      table.capabilityKey,
    ),
    index('capability_promotions_eval_run_idx').on(table.evalRunId),
  ],
);

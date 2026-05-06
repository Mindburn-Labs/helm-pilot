import { z } from 'zod';
import {
  CapabilityKeySchema,
  CapabilityRecordSchema,
  CapabilitySummarySchema,
  CapabilityStateSchema,
} from '../capabilities/index.js';

const DurableRowSchema = z.record(z.string(), z.unknown());

export const CommandCenterRuntimeTruthSchema = z.object({
  productionReady: z.boolean(),
  commandCenterState: CapabilityStateSchema,
  missionRuntimeState: CapabilityStateSchema,
  statement: z.string().min(1),
  blockers: z.array(z.string().min(1)),
});

export const CommandCenterResponseSchema = z.object({
  workspaceId: z.string().min(1),
  generatedAt: z.string().datetime(),
  runtimeTruth: CommandCenterRuntimeTruthSchema,
  authorization: z.object({
    workspaceRole: z.string().nullable(),
    requiredRole: z.literal('partner'),
    workspaceId: z.string().min(1),
  }),
  capabilities: z.object({
    summary: CapabilitySummarySchema,
    records: z.array(CapabilityRecordSchema),
    focusKeys: z.array(CapabilityKeySchema),
  }),
  status: z.object({
    activeTasks: z.number().int().nonnegative(),
    pendingApprovals: z.number().int().nonnegative(),
    recentActions: z.number().int().nonnegative(),
    recentEvidence: z.number().int().nonnegative(),
    evidenceItems: z.number().int().nonnegative(),
    recentArtifacts: z.number().int().nonnegative(),
    browserObservations: z.number().int().nonnegative(),
    computerActions: z.number().int().nonnegative(),
  }),
  recent: z.object({
    tasks: z.array(DurableRowSchema),
    taskRuns: z.array(DurableRowSchema),
    actions: z.array(DurableRowSchema),
    toolExecutions: z.array(DurableRowSchema),
    evidencePacks: z.array(DurableRowSchema),
    evidenceItems: z.array(DurableRowSchema),
    approvals: z.array(DurableRowSchema),
    auditEvents: z.array(DurableRowSchema),
    browserObservations: z.array(DurableRowSchema),
    computerActions: z.array(DurableRowSchema),
    agentHandoffs: z.array(DurableRowSchema),
    artifacts: z.array(DurableRowSchema),
  }),
});

export const CommandCenterProofDagResponseSchema = z.object({
  workspaceId: z.string().min(1),
  rootTaskRunId: z.string().min(1),
  generatedAt: z.string().datetime(),
  productionReady: z.literal(false),
  capability: CapabilityRecordSchema,
  dag: z.object({
    taskRuns: z.array(DurableRowSchema),
    agentHandoffs: z.array(DurableRowSchema),
    evidencePacks: z.array(DurableRowSchema),
  }),
  blockers: z.array(z.string().min(1)),
});

export const CommandCenterPermissionGraphResponseSchema = z.object({
  workspaceId: z.string().min(1),
  generatedAt: z.string().datetime(),
  productionReady: z.literal(false),
  capability: CapabilityRecordSchema,
  redactionContract: z.string().min(1),
  graph: z.object({
    nodes: z.array(
      z.object({
        id: z.string().min(1),
        kind: z.enum([
          'workspace',
          'workspace_role',
          'required_role',
          'capability',
          'operator',
          'tool_scope',
          'policy_config',
        ]),
        label: z.string().min(1),
        state: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).default({}),
      }),
    ),
    edges: z.array(
      z.object({
        id: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        relation: z.string().min(1),
        status: z.enum(['allowed', 'configured', 'blocked', 'prototype', 'requires_eval']),
        reason: z.string().optional(),
      }),
    ),
  }),
  blockers: z.array(z.string().min(1)),
});

export const CommandCenterMissionGraphResponseSchema = z.object({
  workspaceId: z.string().min(1),
  generatedAt: z.string().datetime(),
  productionReady: z.literal(false),
  capability: CapabilityRecordSchema,
  missionId: z.string().nullable(),
  graph: z.object({
    missions: z.array(DurableRowSchema),
    nodes: z.array(DurableRowSchema),
    edges: z.array(DurableRowSchema),
    taskLinks: z.array(DurableRowSchema),
    recovery: z.object({
      checkpoints: z.array(DurableRowSchema),
      recoveryPlans: z.array(DurableRowSchema),
    }),
    orderedBy: z.array(z.string().min(1)),
  }),
  blockers: z.array(z.string().min(1)),
});

export const CommandCenterEvalStatusResponseSchema = z.object({
  workspaceId: z.string().min(1),
  generatedAt: z.string().datetime(),
  productionReady: z.literal(false),
  capability: CapabilityRecordSchema,
  promotionRule: z.string().min(1),
  evals: z.object({
    scenarios: z.array(DurableRowSchema),
    recentRuns: z.array(DurableRowSchema),
    promotions: z.array(DurableRowSchema),
    orderedBy: z.array(z.string().min(1)),
  }),
  blockers: z.array(z.string().min(1)),
});

export const CommandCenterReplayResponseSchema = z.object({
  workspaceId: z.string().min(1),
  replayRef: z.string().min(1),
  generatedAt: z.string().datetime(),
  productionReady: z.literal(false),
  capability: CapabilityRecordSchema,
  replay: z.object({
    evidenceItems: z.array(DurableRowSchema),
    browserObservations: z.array(DurableRowSchema),
    computerActions: z.array(DurableRowSchema),
  }),
  blockers: z.array(z.string().min(1)),
});

export type CommandCenterRuntimeTruth = z.infer<typeof CommandCenterRuntimeTruthSchema>;
export type CommandCenterResponse = z.infer<typeof CommandCenterResponseSchema>;
export type CommandCenterProofDagResponse = z.infer<typeof CommandCenterProofDagResponseSchema>;
export type CommandCenterPermissionGraphResponse = z.infer<
  typeof CommandCenterPermissionGraphResponseSchema
>;
export type CommandCenterMissionGraphResponse = z.infer<
  typeof CommandCenterMissionGraphResponseSchema
>;
export type CommandCenterEvalStatusResponse = z.infer<
  typeof CommandCenterEvalStatusResponseSchema
>;
export type CommandCenterReplayResponse = z.infer<typeof CommandCenterReplayResponseSchema>;

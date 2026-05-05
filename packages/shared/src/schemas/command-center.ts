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

export type CommandCenterRuntimeTruth = z.infer<typeof CommandCenterRuntimeTruthSchema>;
export type CommandCenterResponse = z.infer<typeof CommandCenterResponseSchema>;
export type CommandCenterProofDagResponse = z.infer<typeof CommandCenterProofDagResponseSchema>;

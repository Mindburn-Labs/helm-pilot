import { z } from 'zod';

// ─── Event Types ───
// Services communicate via pg-boss jobs + Postgres LISTEN/NOTIFY.
// These schemas define the event payload contracts.

export const BaseEventSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  timestamp: z.date(),
  source: z.string(), // service that emitted the event
});

// ─── Opportunity Events ───
export const OpportunityDiscoveredSchema = BaseEventSchema.extend({
  type: z.literal('opportunity.discovered'),
  opportunityId: z.string().uuid(),
  source: z.string(),
  score: z.number().optional(),
});
export type OpportunityDiscovered = z.infer<typeof OpportunityDiscoveredSchema>;

// ─── Task Events ───
export const TaskCreatedSchema = BaseEventSchema.extend({
  type: z.literal('task.created'),
  taskId: z.string().uuid(),
  operatorId: z.string().uuid().optional(),
  mode: z.string(),
});
export type TaskCreated = z.infer<typeof TaskCreatedSchema>;

export const TaskCompletedSchema = BaseEventSchema.extend({
  type: z.literal('task.completed'),
  taskId: z.string().uuid(),
  artifactIds: z.array(z.string().uuid()).optional(),
});
export type TaskCompleted = z.infer<typeof TaskCompletedSchema>;

// ─── Operator Events ───
export const OperatorCreatedSchema = BaseEventSchema.extend({
  type: z.literal('operator.created'),
  operatorId: z.string().uuid(),
  role: z.string(),
});
export type OperatorCreated = z.infer<typeof OperatorCreatedSchema>;

// ─── Mode Events ───
export const ModeTransitionSchema = BaseEventSchema.extend({
  type: z.literal('mode.transition'),
  from: z.string(),
  to: z.string(),
});
export type ModeTransition = z.infer<typeof ModeTransitionSchema>;

// ─── Approval Events ───
export const ApprovalRequestedSchema = BaseEventSchema.extend({
  type: z.literal('approval.requested'),
  taskId: z.string().uuid(),
  action: z.string(),
  reason: z.string(),
});
export type ApprovalRequested = z.infer<typeof ApprovalRequestedSchema>;

export const ApprovalResolvedSchema = BaseEventSchema.extend({
  type: z.literal('approval.resolved'),
  taskId: z.string().uuid(),
  approved: z.boolean(),
  resolvedBy: z.string(),
});
export type ApprovalResolved = z.infer<typeof ApprovalResolvedSchema>;

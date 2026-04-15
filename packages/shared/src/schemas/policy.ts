import { z } from 'zod';
import { VerdictSchema } from './enums.js';

// ─── Budget Limits ───
// Ported from money-engine/state/policy.yaml, generalized for workspaces
export const BudgetLimitsSchema = z.object({
  dailyTotalMax: z.number().positive().default(500),
  perTaskMax: z.number().positive().default(100),
  perOperatorMax: z.number().positive().default(200),
  emergencyKill: z.number().positive().default(1500),
  currency: z.string().default('EUR'),
});
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

// ─── Policy Config ───
// Adapted from money-engine pretooluse.py check chain
export const PolicyConfigSchema = z.object({
  killSwitch: z.boolean().default(false), // emergency stop — blocks ALL actions
  budget: BudgetLimitsSchema,
  toolBlocklist: z.array(z.string()).default([]),
  contentBans: z.array(z.string()).default([]),
  connectorAllowlist: z.array(z.string()).default([]),
  requireApprovalFor: z.array(z.string()).default([]),
  failClosed: z.boolean().default(true), // if true, invalid policy = block all
});
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

// ─── Trust Boundary Result ───
// Standardized verdict for tool/action checks
export const TrustBoundaryResultSchema = z.object({
  verdict: VerdictSchema,
  reason: z.string().optional(),
  policyRule: z.string().optional(),
  checkedAt: z.date(),
});
export type TrustBoundaryResult = z.infer<typeof TrustBoundaryResultSchema>;

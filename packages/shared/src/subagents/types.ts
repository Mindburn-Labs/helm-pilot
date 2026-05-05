import { z } from 'zod';
import { OperatorRoleSchema } from '../schemas/enums.js';

// ─── Governed Subagents (Phase 12) ───
//
// A Subagent is a bounded delegation target the main orchestrator can spawn
// to handle a sub-task in an isolated context with a narrowed tool scope and
// a sliced budget. Every spawn crosses the HELM trust boundary: the parent's
// evidence pack anchors the child's chain, producing a cryptographically
// attested DAG of delegations.
//
// Frontmatter is deliberately Gemini-CLI-compatible (see
// https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md).
// HELM-specific fields (`operator_role`, `max_risk_class`, `budget_weight`,
// `execution`) are additive with defaults so a pure Gemini definition parses.

export const SubagentExecutionModeSchema = z.enum([
  'AUTONOMOUS', // runs without approval inside budget + tool scope
  'SUPERVISED', // every side-effectful tool call escalates to approval
  'READ_ONLY', // read/analyze only; denied any side-effecting tool
]);
export type SubagentExecutionMode = z.infer<typeof SubagentExecutionModeSchema>;

export const SubagentRiskClassSchema = z.enum(['R0', 'R1', 'R2', 'R3']);
export type SubagentRiskClass = z.infer<typeof SubagentRiskClassSchema>;

export const SubagentToolScopeSchema = z.object({
  allowedTools: z.array(z.string()).min(0),
});
export type SubagentToolScope = z.infer<typeof SubagentToolScopeSchema>;

/**
 * Parsed shape of a `packs/subagents/*.md` file.
 *
 * The file format is YAML frontmatter + Markdown body:
 *
 * ```
 * ---
 * name: opportunity_scout
 * description: Scouts YC/HN/PH for aligned opportunities.
 * version: 1.0.0
 * operator_role: growth
 * max_risk_class: R1
 * budget_weight: 1.0
 * execution: AUTONOMOUS
 * tool_scope:
 *   allowed_tools:
 *     - opportunity.list
 *     - opportunity.score
 * iteration_budget: 20
 * model: sonnet
 * ---
 * You are a Growth operator specializing in …
 * ```
 *
 * The body is the system prompt.
 */
export const SubagentDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/u, 'name must be snake_case lowercase'),
  description: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  operatorRole: OperatorRoleSchema,
  maxRiskClass: SubagentRiskClassSchema.default('R1'),
  budgetWeight: z.number().positive().default(1),
  execution: SubagentExecutionModeSchema.default('AUTONOMOUS'),
  toolScope: SubagentToolScopeSchema,
  skills: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
  model: z.string().optional(),
  iterationBudget: z.number().int().positive().default(20),
  systemPrompt: z.string().min(1),
  sourcePath: z.string().min(1),
});
export type SubagentDefinition = z.infer<typeof SubagentDefinitionSchema>;

/**
 * Input shape the Conductor receives from the parent LLM's `subagent.spawn`
 * or `subagent.parallel` tool call. `name` is the registry key; `task` is
 * the natural-language instruction the subagent will execute.
 */
export const SubagentSpawnRequestSchema = z.object({
  name: z.string().min(1),
  task: z.string().min(1),
  budgetWeight: z.number().positive().optional(),
});
export type SubagentSpawnRequest = z.infer<typeof SubagentSpawnRequestSchema>;

export const SubagentParallelRequestSchema = z.object({
  spawns: z.array(SubagentSpawnRequestSchema).min(1).max(6),
});
export type SubagentParallelRequest = z.infer<typeof SubagentParallelRequestSchema>;

/**
 * Result surfaced back to the parent after a subagent run completes.
 * `summary` is the child's consolidated final response (Gemini-CLI-style).
 * The parent never sees intermediate chatter — that lives in the proof graph.
 */
export interface SubagentRunResult {
  name: string;
  summary: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  iterationsUsed: number;
  taskRunId: string;
  spawnEvidencePackId: string;
  verdict: 'completed' | 'failed' | 'escalated';
  error?: string;
}

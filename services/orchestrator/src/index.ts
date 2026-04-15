import PgBoss from 'pg-boss';
import { type Db } from '@helm-pilot/db/client';
import { type LlmProvider } from '@helm-pilot/shared/llm';
import { type PolicyConfig } from '@helm-pilot/shared/schemas';
import { type MemoryService } from '@helm-pilot/memory';
import { TrustBoundary } from './trust.js';
import { AgentLoop } from './agent-loop.js';
import { ToolRegistry } from './tools.js';
import { registerJobHandlers } from './jobs.js';

export interface OrchestratorConfig {
  db: Db;
  policy: PolicyConfig;
  llm?: LlmProvider;
  memory?: MemoryService;
  boss?: PgBoss;
}

/**
 * Orchestrator service — the brain of HELM Pilot.
 *
 * Responsibilities:
 * - Agent loop with iteration budget (Hermes pattern)
 * - Task delegation to operators
 * - Trust boundary enforcement (fail-closed, ported from pretooluse.py)
 * - Approval flows for dangerous actions
 * - Session lifecycle (start, run, teardown with reflection)
 * - Background job dispatch via pg-boss
 */
export class Orchestrator {
  readonly trust: TrustBoundary;
  readonly agentLoop: AgentLoop;
  readonly tools: ToolRegistry;
  readonly db: Db;
  readonly boss?: PgBoss;
  private readonly basePolicy: PolicyConfig;

  constructor(config: OrchestratorConfig) {
    this.db = config.db;
    this.boss = config.boss;
    this.basePolicy = config.policy;
    this.trust = new TrustBoundary(config.policy);
    this.tools = new ToolRegistry(config.db, config.memory);
    this.agentLoop = new AgentLoop(config.db, this.trust);

    // Wire LLM + tools into agent loop if available
    if (config.llm) {
      this.agentLoop.setLlm(config.llm);
    }
    this.agentLoop.setTools(this.tools);

    // Register background job handlers (async — fire and forget with error log)
    if (config.boss) {
      registerJobHandlers(config.boss, {
        db: config.db,
        memory: config.memory,
        llm: config.llm,
        orchestrator: this,
      }).catch((err) => {
        // Non-fatal: schedule errors are logged inside registerJobHandlers;
        // anything reaching here is unexpected.
        console.error('registerJobHandlers failed:', err);
      });
    }
  }

  /**
   * Run a task through the agent loop.
   *
   * Enriches params with:
   * - Workspace's current mode (for tool filtering)
   * - Operator's system prompt + goal (for personality)
   */
  async runTask(params: {
    taskId: string;
    workspaceId: string;
    operatorId?: string;
    context: string;
    iterationBudget?: number;
  }) {
    const runtime = await this.resolveRuntime(params.workspaceId, params.operatorId, params.iterationBudget);
    this.trust.setPolicy(runtime.policy);

    return this.agentLoop.execute({
      ...params,
      iterationBudget: runtime.iterationBudget,
      mode: runtime.mode,
      systemPrompt: runtime.systemPrompt,
      operatorGoal: runtime.operatorGoal,
    });
  }

  async resumeTask(params: {
    taskId: string;
    workspaceId: string;
    operatorId?: string;
    context: string;
    iterationBudget?: number;
    priorActions: import('./agent-loop.js').ActionRecord[];
  }) {
    const runtime = await this.resolveRuntime(params.workspaceId, params.operatorId, params.iterationBudget);
    this.trust.setPolicy(runtime.policy);

    return this.agentLoop.resume({
      ...params,
      iterationBudget: runtime.iterationBudget,
      mode: runtime.mode,
      systemPrompt: runtime.systemPrompt,
      operatorGoal: runtime.operatorGoal,
    });
  }

  private async resolveRuntime(workspaceId: string, operatorId?: string, requestedIterationBudget?: number) {
    const { workspaces, workspaceSettings, operators, operatorRoles, operatorConfigs } = await import('@helm-pilot/db/schema');
    const { eq } = await import('drizzle-orm');

    // Look up workspace mode
    let mode: string | undefined;
    let runtimePolicy: PolicyConfig = structuredClone(this.basePolicy);
    let workspaceIterationBudget: number | undefined;
    const [ws] = await this.db
      .select({ currentMode: workspaces.currentMode })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (ws) mode = ws.currentMode;

    const [settings] = await this.db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .limit(1);

    if (settings) {
      const policyConfig = (settings.policyConfig ?? {}) as Record<string, unknown>;
      const budgetConfig = (settings.budgetConfig ?? {}) as Record<string, unknown>;

      runtimePolicy = {
        ...runtimePolicy,
        killSwitch: typeof policyConfig['killSwitch'] === 'boolean' ? policyConfig['killSwitch'] : runtimePolicy.killSwitch,
        toolBlocklist: Array.isArray(policyConfig['toolBlocklist'])
          ? policyConfig['toolBlocklist'].map(String)
          : Array.isArray(policyConfig['blockedTools'])
            ? policyConfig['blockedTools'].map(String)
            : runtimePolicy.toolBlocklist,
        contentBans: Array.isArray(policyConfig['contentBans'])
          ? policyConfig['contentBans'].map(String)
          : runtimePolicy.contentBans,
        connectorAllowlist: Array.isArray(policyConfig['connectorAllowlist'])
          ? policyConfig['connectorAllowlist'].map(String)
          : runtimePolicy.connectorAllowlist,
        requireApprovalFor: Array.isArray(policyConfig['requireApprovalFor'])
          ? policyConfig['requireApprovalFor'].map(String)
          : runtimePolicy.requireApprovalFor,
        failClosed: typeof policyConfig['failClosed'] === 'boolean' ? policyConfig['failClosed'] : runtimePolicy.failClosed,
        budget: {
          ...runtimePolicy.budget,
          dailyTotalMax: toFiniteNumber(budgetConfig['dailyTotalMax']) ?? runtimePolicy.budget.dailyTotalMax,
          perTaskMax: toFiniteNumber(budgetConfig['perTaskMax']) ?? runtimePolicy.budget.perTaskMax,
          perOperatorMax: toFiniteNumber(budgetConfig['perOperatorMax']) ?? runtimePolicy.budget.perOperatorMax,
          emergencyKill: toFiniteNumber(budgetConfig['emergencyKill']) ?? runtimePolicy.budget.emergencyKill,
          currency: typeof budgetConfig['currency'] === 'string' ? budgetConfig['currency'] : runtimePolicy.budget.currency,
        },
      };

      workspaceIterationBudget = toFiniteNumber(policyConfig['maxIterationBudget']) ?? undefined;
    }

    // Look up operator system prompt + goal
    let systemPrompt: string | undefined;
    let operatorGoal: string | undefined;
    let operatorIterationBudget: number | undefined;
    if (operatorId) {
      const [op] = await this.db
        .select()
        .from(operators)
        .where(eq(operators.id, operatorId))
        .limit(1);
      if (op) {
        operatorGoal = op.goal;
        // Look up the role definition for the system prompt
        const [role] = await this.db
          .select()
          .from(operatorRoles)
          .where(eq(operatorRoles.name, op.role))
          .limit(1);
        if (role?.systemPrompt) systemPrompt = role.systemPrompt;

        const [config] = await this.db
          .select()
          .from(operatorConfigs)
          .where(eq(operatorConfigs.operatorId, op.id))
          .limit(1);
        const rawMaxIterations = (config?.iterationBudget as Record<string, unknown> | null | undefined)?.['maxIterations'];
        operatorIterationBudget = toFiniteNumber(rawMaxIterations) ?? undefined;
      }
    }

    const iterationBudget = clampIterationBudget(
      requestedIterationBudget,
      operatorIterationBudget,
      workspaceIterationBudget,
    );

    return {
      policy: runtimePolicy,
      iterationBudget,
      mode,
      systemPrompt,
      operatorGoal,
    };
  }
}

export { TrustBoundary } from './trust.js';
export { AgentLoop } from './agent-loop.js';
export { ToolRegistry } from './tools.js';

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function clampIterationBudget(...values: Array<number | undefined>) {
  const defined = values.filter((value): value is number => typeof value === 'number' && value > 0);
  if (defined.length === 0) return 50;
  return Math.min(...defined);
}

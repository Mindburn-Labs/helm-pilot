import { type Db } from '@helm-pilot/db/client';
import { type LlmProvider, type LlmUsage } from '@helm-pilot/shared/llm';
import { MAX_ITERATION_BUDGET } from '@helm-pilot/shared/schemas';
import { type TrustBoundary } from './trust.js';
import { type ToolRegistry } from './tools.js';

/**
 * Agent Loop — iteration-budgeted execution engine.
 *
 * Patterns adopted from Hermes Agent:
 * - Iteration budget (prevents runaway agents)
 * - Ephemeral context injection (system prompts never persisted)
 * - Tool execution with trust boundary checks
 * - Session teardown with reflection (ported from stop.py Auto-Dream)
 *
 * Each run gets a fixed iteration budget. The loop terminates when:
 * 1. Agent signals completion
 * 2. Iteration budget exhausted
 * 3. Trust boundary blocks a critical action
 * 4. Approval required (pauses, resumes after user approves)
 */
/** Callback invoked when an approval is created — for sending push notifications. */
export type ApprovalNotifyFn = (workspaceId: string, approvalId: string, action: string, reason: string) => Promise<void>;

export class AgentLoop {
  private llm: LlmProvider | null = null;
  private tools: ToolRegistry | null = null;
  private onApproval: ApprovalNotifyFn | null = null;

  constructor(
    readonly db: Db,
    private readonly trust: TrustBoundary,
  ) {}

  /** Set a callback for approval notifications (e.g., Telegram push). */
  setApprovalNotifier(fn: ApprovalNotifyFn) {
    this.onApproval = fn;
  }

  /** Inject LLM provider (optional — loop returns immediately without it) */
  setLlm(llm: LlmProvider) {
    this.llm = llm;
  }

  /** Inject tool registry */
  setTools(tools: ToolRegistry) {
    this.tools = tools;
  }

  /**
   * Execute an agent run with the given task context.
   */
  async execute(params: AgentRunParams): Promise<AgentRunResult> {
    const runResult = await this.executeLoop(params);
    // Save operator memory at end of run (B6 — context for future runs)
    await this.saveOperatorMemory(params, runResult.actions, runResult.status);
    return runResult;
  }

  private async executeLoop(params: AgentRunParams): Promise<AgentRunResult> {
    if (!this.llm) {
      return this.result('completed', 0, params.iterationBudget ?? 50, [], 'No LLM configured');
    }

    const maxIterations = Math.min(params.iterationBudget ?? 50, MAX_ITERATION_BUDGET);
    const actions: ActionRecord[] = [];

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // 1. Plan next action via LLM (ephemeral context — never persisted)
      const action = await this.planNextAction(params, actions);
      if (!action) {
        return this.result('completed', iteration - 1, maxIterations, actions);
      }

      // 2. Trust boundary check (fail-closed — pretooluse.py pattern)
      const verdict = this.trust.evaluate({
        tool: action.tool,
        content: typeof action.input === 'string' ? action.input : undefined,
        workspaceId: params.workspaceId,
        operatorId: params.operatorId,
      });

      if (verdict.verdict === 'deny') {
        actions.push({ ...action, output: null, verdict: 'deny', iteration });
        // Persist denied action for audit trail
        await this.persistAction(params.taskId, { ...action, output: null, verdict: 'deny', iteration });
        return this.result('blocked', iteration, maxIterations, actions, verdict.reason);
      }

      if (verdict.verdict === 'require_approval') {
        actions.push({ ...action, output: null, verdict: 'require_approval', iteration });
        // Persist the pending action so resume can pick it up
        await this.persistAction(params.taskId, { ...action, output: null, verdict: 'require_approval', iteration });
        // Create approval record
        await this.createApprovalRecord(params, action, verdict.reason ?? 'Approval required');
        return this.result('awaiting_approval', iteration, maxIterations, actions, verdict.reason);
      }

      // 3. Execute action
      const output = await this.executeAction(action);
      actions.push({ ...action, output, verdict: 'allow', iteration });

      // Persist action (A5 — task progress tracking)
      await this.persistAction(params.taskId, { ...action, output, verdict: 'allow', iteration });

      // 4. Check if LLM signalled done via a special tool
      if (action.tool === 'finish') {
        return this.result('completed', iteration, maxIterations, actions);
      }
    }

    return this.result('budget_exhausted', maxIterations, maxIterations, actions);
  }

  /**
   * Resume an agent run after approval. Reloads action history from DB
   * and continues from where it paused.
   */
  async resume(params: AgentRunParams & { priorActions: ActionRecord[] }): Promise<AgentRunResult> {
    if (!this.llm) {
      return this.result('completed', 0, params.iterationBudget ?? 50, [], 'No LLM configured');
    }

    const maxIterations = Math.min(params.iterationBudget ?? 50, MAX_ITERATION_BUDGET);
    const actions: ActionRecord[] = [...params.priorActions];
    const startIteration = actions.length + 1;

    // Execute the previously-blocked action (it was approved)
    const lastAction = actions[actions.length - 1];
    if (lastAction && lastAction.verdict === 'require_approval') {
      const output = await this.executeAction({ tool: lastAction.tool, input: lastAction.input });
      lastAction.output = output;
      lastAction.verdict = 'allow';
      await this.persistAction(params.taskId, lastAction);

      if (lastAction.tool === 'finish') {
        return this.result('completed', startIteration - 1, maxIterations, actions);
      }
    }

    // Continue the loop from where we left off
    for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
      const action = await this.planNextAction(params, actions);
      if (!action) {
        return this.result('completed', iteration - 1, maxIterations, actions);
      }

      const verdict = this.trust.evaluate({
        tool: action.tool,
        content: typeof action.input === 'string' ? action.input : undefined,
        workspaceId: params.workspaceId,
        operatorId: params.operatorId,
      });

      if (verdict.verdict === 'deny') {
        actions.push({ ...action, output: null, verdict: 'deny', iteration });
        await this.persistAction(params.taskId, { ...action, output: null, verdict: 'deny', iteration });
        return this.result('blocked', iteration, maxIterations, actions, verdict.reason);
      }

      if (verdict.verdict === 'require_approval') {
        actions.push({ ...action, output: null, verdict: 'require_approval', iteration });
        await this.persistAction(params.taskId, { ...action, output: null, verdict: 'require_approval', iteration });
        await this.createApprovalRecord(params, action, verdict.reason ?? 'Approval required');
        return this.result('awaiting_approval', iteration, maxIterations, actions, verdict.reason);
      }

      const output = await this.executeAction(action);
      actions.push({ ...action, output, verdict: 'allow', iteration });
      await this.persistAction(params.taskId, { ...action, output, verdict: 'allow', iteration });

      if (action.tool === 'finish') {
        return this.result('completed', iteration, maxIterations, actions);
      }
    }

    return this.result('budget_exhausted', maxIterations, maxIterations, actions);
  }

  /** Cumulative token usage across all LLM calls in the current run. */
  private runUsage: LlmUsage = { tokensIn: 0, tokensOut: 0, model: '' };

  private async planNextAction(
    params: AgentRunParams,
    history: ActionRecord[],
  ): Promise<Pick<ActionRecord, 'tool' | 'input'> | null> {
    if (!this.llm) return null;

    // Use mode-aware tool filtering if mode is set
    const availableTools = params.mode && this.tools
      ? this.tools.listToolsForMode(params.mode)
      : this.tools?.listTools() ?? [];

    const prompt = buildPlanPrompt(params, history, availableTools);

    // Use completeWithUsage to track token consumption
    if (this.llm.completeWithUsage) {
      const result = await this.llm.completeWithUsage(prompt);
      this.runUsage.tokensIn += result.usage.tokensIn;
      this.runUsage.tokensOut += result.usage.tokensOut;
      this.runUsage.model = result.usage.model;
      return parsePlanResponse(result.content);
    }

    // Fallback for providers that don't support usage tracking
    const response = await this.llm.complete(prompt);
    return parsePlanResponse(response);
  }

  private async executeAction(
    action: Pick<ActionRecord, 'tool' | 'input'>,
  ): Promise<unknown> {
    if (!this.tools) return { error: 'No tool registry configured' };
    return this.tools.execute(action.tool, action.input);
  }

  /** Persist an action record to the task_runs table for audit + resume */
  private async persistAction(taskId: string, action: ActionRecord): Promise<void> {
    try {
      const { taskRuns } = await import('@helm-pilot/db/schema');
      await this.db.insert(taskRuns).values({
        taskId,
        status: mapActionStatus(action),
        actionTool: action.tool,
        actionInput: toJsonValue(action.input),
        actionOutput: toJsonValue(action.output),
        verdict: action.verdict,
        iterationsUsed: action.iteration,
        modelUsed: this.runUsage.model || 'agent-loop',
        tokensIn: this.runUsage.tokensIn,
        tokensOut: this.runUsage.tokensOut,
        error: action.verdict === 'deny' ? stringifyError(action.output) : undefined,
        completedAt: action.verdict === 'require_approval' ? undefined : new Date(),
      });
    } catch {
      // Non-critical — don't crash the loop if persistence fails
    }
  }

  /** Create an approval record for the paused action and send notification */
  private async createApprovalRecord(
    params: AgentRunParams,
    action: Pick<ActionRecord, 'tool' | 'input'>,
    reason: string,
  ): Promise<void> {
    let approvalId: string | undefined;
    try {
      const { approvals } = await import('@helm-pilot/db/schema');
      const [record] = await this.db.insert(approvals).values({
        workspaceId: params.workspaceId,
        taskId: params.taskId,
        action: action.tool,
        reason,
        status: 'pending',
        requestedBy: params.operatorId ?? 'system',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
      }).returning();
      approvalId = record?.id;
    } catch {
      // Non-critical — don't crash the loop if persistence fails
    }

    // Fire push notification (non-blocking)
    if (approvalId && this.onApproval) {
      this.onApproval(params.workspaceId, approvalId, action.tool, reason).catch(() => {});
    }
  }

  /** Save operator memory at end of a run (for context in future runs) */
  private async saveOperatorMemory(params: AgentRunParams, actions: ActionRecord[], status: string): Promise<void> {
    if (!params.operatorId) return;
    try {
      const { operatorMemory } = await import('@helm-pilot/db/schema');
      const summary = actions
        .slice(-3)
        .map((a) => `${a.tool}: ${a.verdict}`)
        .join(', ');
      await this.db.insert(operatorMemory).values({
        operatorId: params.operatorId,
        key: `run:${params.taskId}`,
        value: JSON.stringify({ status, summary, iterationsUsed: actions.length }),
      });
    } catch {
      // Non-critical
    }
  }

  private result(
    status: AgentRunResult['status'],
    iterationsUsed: number,
    iterationBudget: number,
    actions: ActionRecord[],
    error?: string,
  ): AgentRunResult {
    return { status, iterationsUsed, iterationBudget, actions, error };
  }
}

// ─── Prompt Building ───

function buildPlanPrompt(
  params: AgentRunParams,
  history: ActionRecord[],
  availableTools: ToolDef[],
): string {
  const toolList = availableTools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const historyText = history.length > 0
    ? history
        .map((a) => `[${a.iteration}] ${a.tool}(${JSON.stringify(a.input)}) → ${JSON.stringify(a.output)}`)
        .join('\n')
    : '(no actions yet)';

  // Sanitize user-controlled context: truncate + escape angle brackets
  const sanitizedContext = sanitizePromptInput(params.context, 5000);

  // Build role/goal section from operator config
  const roleSection = params.systemPrompt
    ? `\nROLE: ${sanitizePromptInput(params.systemPrompt, 2000)}`
    : '';
  const goalSection = params.operatorGoal
    ? `\nGOAL: ${sanitizePromptInput(params.operatorGoal, 1000)}`
    : '';
  const modeSection = params.mode
    ? `\nMODE: ${params.mode}`
    : '';

  return `You are an autonomous operator in HELM Pilot, an AI-powered founder operating system.
${roleSection}${goalSection}${modeSection}

TASK: ${sanitizedContext}

WORKSPACE: ${params.workspaceId}
${params.operatorId ? `OPERATOR: ${params.operatorId}` : ''}

AVAILABLE TOOLS:
${toolList || '(none registered)'}
- finish: Signal that the task is complete. Input: {"summary": "what was accomplished"}

ACTION HISTORY:
${historyText}

ITERATION: ${history.length + 1} of ${params.iterationBudget ?? 50}

Decide the next action. Respond with JSON only (no markdown, no fences):
{"tool": "tool_name", "input": {... tool-specific input ...}}

If the task is complete, use: {"tool": "finish", "input": {"summary": "..."}}
If you cannot proceed, use: {"tool": "finish", "input": {"summary": "Blocked: reason"}}`;
}

function parsePlanResponse(response: string): Pick<ActionRecord, 'tool' | 'input'> | null {
  const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.tool) return null;
    return { tool: String(parsed.tool), input: parsed.input ?? {} };
  } catch {
    // LLM returned unparseable response — treat as completion
    return null;
  }
}

/**
 * Sanitize user-controlled text before injecting into an LLM prompt.
 * Truncates to maxLen, escapes angle brackets to prevent XML-like injection.
 */
function sanitizePromptInput(input: string, maxLen: number): string {
  return input
    .slice(0, maxLen)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Types ───

export interface AgentRunParams {
  taskId: string;
  workspaceId: string;
  operatorId?: string;
  iterationBudget?: number;
  context: string;
  /** Product mode (discover/decide/build/launch/apply) — gates available tools */
  mode?: string;
  /** Operator system prompt (from operatorRoles table) — shapes agent personality */
  systemPrompt?: string;
  /** Operator goal — injected into the planning prompt */
  operatorGoal?: string;
}

export interface AgentRunResult {
  status: 'completed' | 'budget_exhausted' | 'blocked' | 'awaiting_approval';
  iterationsUsed: number;
  iterationBudget: number;
  actions: ActionRecord[];
  error?: string;
}

export interface ActionRecord {
  tool: string;
  input: unknown;
  output: unknown;
  verdict: string;
  iteration: number;
}

export interface ToolDef {
  name: string;
  description: string;
}

function mapActionStatus(action: ActionRecord) {
  if (action.verdict === 'require_approval') return 'awaiting_approval';
  if (action.verdict === 'deny') return 'failed';
  if (action.tool === 'finish') return 'completed';
  return 'running';
}

function toJsonValue(value: unknown) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function stringifyError(value: unknown) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

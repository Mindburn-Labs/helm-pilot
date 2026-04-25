import { type Db } from '@helm-pilot/db/client';
import { type LlmProvider } from '@helm-pilot/shared/llm';
import { type SubagentDefinition, type SubagentRunResult } from '@helm-pilot/shared/subagents';
import { type PolicyConfig } from '@helm-pilot/shared/schemas';
import { type SkillRegistry } from '@helm-pilot/shared/skills';
import { type McpServerRegistry } from '@helm-pilot/shared/mcp';
import { type HelmClient } from '@helm-pilot/helm-client';
import { AgentLoop, type AgentRunResult, type SubagentFrame } from './agent-loop.js';
import { TrustBoundary } from './trust.js';
import { type ToolRegistry } from './tools.js';

/**
 * SubagentLoop — governed wrapper around a fresh AgentLoop instance.
 *
 * Design decision #1 (plan): we **wrap, not extend** AgentLoop. Every
 * subagent gets a brand-new AgentLoop with its own `runUsage`, `runCost`,
 * `lastGovernance`, and `currentWorkspaceId` — isolation is structural,
 * so concurrent spawns from `subagent.parallel` cannot corrupt each
 * other's state.
 *
 * Each run:
 *   1. Clones the parent's policy and narrows it per `SubagentDefinition`
 *      (toolBlocklist, perTaskMax budget slice, kill switch inherited).
 *   2. Scopes the parent's ToolRegistry to `def.toolScope.allowedTools`.
 *   3. Boots a fresh AgentLoop with the cloned TrustBoundary + scoped
 *      tool registry + parent's LLM provider.
 *   4. Sets a SubagentFrame so every persisted row carries
 *      parent_task_run_id / parent_evidence_pack_id / operator_role.
 *   5. Executes against a synthesized `context` that includes the parent's
 *      natural-language task description + the subagent's system prompt.
 *   6. Returns a consolidated SubagentRunResult — final summary + cost
 *      + verdict — for the parent to fold back into its own context.
 */
export class SubagentLoop {
  constructor(
    private readonly db: Db,
    private readonly parentTools: ToolRegistry,
    private readonly parentPolicy: PolicyConfig,
    private readonly llm: LlmProvider,
    private readonly helmClient?: HelmClient,
    /**
     * Phase 14 Track E — optional skill registry. When supplied, every
     * subagent run matches the task description against available skills
     * and prepends matched skill bodies to the child's system prompt.
     */
    private readonly skillRegistry?: SkillRegistry,
    /**
     * Phase 14 Track A — optional MCP server registry. When supplied,
     * every entry in `def.mcpServers` resolves to a live client and
     * every upstream tool gets injected into the scoped tool registry
     * as `mcp.<serverName>.<toolName>` before the child executes.
     */
    private readonly mcpRegistry?: McpServerRegistry,
  ) {}

  /**
   * Execute a single subagent run.
   *
   * @param def           The registry-loaded subagent definition
   * @param input         Natural-language task from the parent LLM
   * @param frame         Parent-side anchors (task run id, evidence pack id,
   *                      operator role, budget slice) — threaded into every
   *                      child-persisted row
   * @param workspaceId   Workspace the child executes inside (inherited)
   * @param taskId        Pilot task id to record iterations under (typically
   *                      the parent conductor's taskId — child rows are
   *                      distinguished by parent_task_run_id)
   */
  async run(params: {
    def: SubagentDefinition;
    input: string;
    frame: SubagentFrame;
    workspaceId: string;
    taskId: string;
  }): Promise<SubagentRunResult> {
    const { def, input, frame, workspaceId, taskId } = params;

    // 1. Narrowed policy — keep kill switch + content bans from parent, but
    // clamp budget to this child's slice and extend the blocklist to cover
    // everything outside the subagent's allowed tool scope. READ_ONLY mode
    // additionally blocklists write-ish builtins.
    const childPolicy = this.narrowPolicy(def, frame);

    // 2. Scoped trust boundary + tool registry.
    const childTrust = new TrustBoundary(childPolicy);
    const scopedTools = this.parentTools.subset(def.toolScope.allowedTools);

    // 2a. Phase 14 Track A — inject upstream MCP tools declared in
    // `def.mcpServers`. Silent-skip unknown servers so operators can
    // flip tracks on/off without breaking existing subagent packs.
    if (this.mcpRegistry && def.mcpServers.length > 0) {
      for (const serverName of def.mcpServers) {
        if (!this.mcpRegistry.has(serverName)) continue;
        try {
          const client = await this.mcpRegistry.get(serverName);
          await scopedTools.registerMcpTools(serverName, client);
        } catch {
          // Transport/tool-list failures are non-fatal — child boots
          // without that server; HELM governance still wraps everything.
        }
      }
    }

    // 3. Fresh AgentLoop — isolated state.
    const child = new AgentLoop(this.db, childTrust, this.helmClient);
    child.setLlm(this.llm);
    child.setTools(scopedTools);
    child.setSubagentFrame(frame);

    // 4. Synthesize child context — system prompt + parent task.
    const context = this.buildChildContext(def, input);
    const iterationBudget = def.iterationBudget;

    // Phase 14 Track E — prepend matched skill bodies to the child's
    // system prompt. Registry may be undefined (backward-compat); match
    // against the natural-language input + optional def.skills list
    // (future extension — Phase 14 subagent frontmatter gains `skills:`).
    const effectiveSystemPrompt = this.composeSystemPrompt(def, input);

    // 5. Execute.
    let result: AgentRunResult;
    try {
      result = await child.execute({
        taskId,
        workspaceId,
        iterationBudget,
        context,
        systemPrompt: effectiveSystemPrompt,
        operatorGoal: def.description,
      });
    } catch (err) {
      return {
        name: def.name,
        summary: `Subagent "${def.name}" crashed`,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        iterationsUsed: 0,
        taskRunId: frame.parentTaskRunId,
        spawnEvidencePackId: frame.parentEvidencePackId ?? '',
        verdict: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 6. Consolidate into the parent-visible result.
    const finishAction = [...result.actions].reverse().find((a) => a.tool === 'finish');
    const summary =
      finishAction && typeof finishAction.input === 'object' && finishAction.input !== null
        ? String(
            (finishAction.input as { summary?: unknown }).summary ??
              `Subagent "${def.name}" completed.`,
          )
        : result.status === 'completed'
          ? `Subagent "${def.name}" completed without an explicit finish payload.`
          : `Subagent "${def.name}" ended with status=${result.status}.`;

    const verdict: SubagentRunResult['verdict'] =
      result.status === 'completed'
        ? 'completed'
        : result.status === 'awaiting_approval'
          ? 'escalated'
          : 'failed';

    return {
      name: def.name,
      summary,
      costUsd: result.costUsd ?? 0,
      tokensIn: result.tokensIn ?? 0,
      tokensOut: result.tokensOut ?? 0,
      iterationsUsed: result.iterationsUsed,
      taskRunId: frame.parentTaskRunId,
      spawnEvidencePackId: frame.parentEvidencePackId ?? '',
      verdict,
      error: result.error,
    };
  }

  private narrowPolicy(def: SubagentDefinition, frame: SubagentFrame): PolicyConfig {
    const base = structuredClone(this.parentPolicy);
    const allowed = new Set(def.toolScope.allowedTools);

    // READ_ONLY subagents: extend the blocklist to cover anything that
    // normally requires approval so the child can't even try to escalate.
    const additionalBlocks =
      def.execution === 'READ_ONLY'
        ? base.requireApprovalFor.filter((tool) => !allowed.has(tool))
        : [];

    return {
      ...base,
      toolBlocklist: Array.from(new Set([...base.toolBlocklist, ...additionalBlocks])),
      budget: {
        ...base.budget,
        perTaskMax: frame.budgetSliceAllocated ?? base.budget.perTaskMax,
      },
    };
  }

  /**
   * Phase 14 Track E — compose the final system prompt from the
   * subagent's base prompt + matched skill bodies. When `skillRegistry`
   * is absent or no skills match the input, returns `def.systemPrompt`
   * verbatim.
   */
  private composeSystemPrompt(def: SubagentDefinition, input: string): string {
    if (!this.skillRegistry) return def.systemPrompt;
    const matches = this.skillRegistry.match(input, []);
    if (matches.length === 0) return def.systemPrompt;
    const blocks = matches
      .slice(0, 3) // cap at 3 skills so the prompt doesn't explode
      .map((m) => `## Skill: ${m.skill.name} (${m.reason}, score=${m.score})\n\n${m.skill.body}`);
    return `${def.systemPrompt}\n\n---\n\n${blocks.join('\n\n---\n\n')}`;
  }

  private buildChildContext(def: SubagentDefinition, input: string): string {
    return [
      `You are the "${def.name}" subagent (role=${def.operatorRole}, risk=${def.maxRiskClass}, execution=${def.execution}).`,
      `The main orchestrator delegated this task to you:`,
      '',
      input,
      '',
      `Return a consolidated final result via the "finish" tool.`,
    ].join('\n');
  }
}

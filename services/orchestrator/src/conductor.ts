import { randomUUID } from 'node:crypto';
import { type Db } from '@helm-pilot/db/client';
import { type LlmProvider } from '@helm-pilot/shared/llm';
import { type PolicyConfig } from '@helm-pilot/shared/schemas';
import {
  SubagentRegistry,
  type SubagentDefinition,
  type SubagentRunResult,
} from '@helm-pilot/shared/subagents';
import { type McpServerRegistry } from '@helm-pilot/shared/mcp';
import { type SubagentFrame } from './agent-loop.js';
import { type ToolRegistry } from './tools.js';
import { SubagentLoop } from './subagent-loop.js';
import { emitConductEvent } from './conduct-stream.js';

/**
 * Conductor — orchestrates governed subagent delegations.
 *
 * Exposed as two tools the parent LLM can call:
 *   - `subagent.spawn`    → delegate one sub-task to one subagent
 *   - `subagent.parallel` → dispatch up to 6 subagents concurrently
 *
 * Every spawn:
 *   1. Resolves the subagent definition from the registry (exact by name,
 *      fallback to description match).
 *   2. Writes a local `evidence_packs` row with `action='SUBAGENT_SPAWN'`
 *      anchored to the most recent parent LLM_INFERENCE pack — this row
 *      is the DAG root for every child receipt under the same subagent.
 *   3. Writes a `task_runs` marker row representing the subagent's run
 *      itself (not an iteration within it). Returns its id as the parent
 *      task run id threaded into the SubagentFrame.
 *   4. Allocates a budget slice (weighted with a 5% floor per plan decision
 *      #5) and composes a per-invocation principal suffix so concurrent
 *      spawns of the same subagent resolve to distinct HELM principals.
 *   5. Delegates execution to SubagentLoop.
 *
 * Path A note: until helm-oss v0.3.1 ships `POST /api/v1/guardian/evaluate`
 * we cannot obtain a HELM-signed SUBAGENT_SPAWN receipt. The local mirror
 * row is stored with `signed_blob=null` and `verified_at=null`; Phase 12.5
 * will swap to signed receipts once the upstream endpoint lands.
 */
export class Conductor {
  constructor(
    private readonly db: Db,
    private readonly registry: SubagentRegistry,
    private readonly parentTools: ToolRegistry,
    private readonly parentPolicy: PolicyConfig,
    private readonly llm: LlmProvider,
    /**
     * Phase 14 Track A — optional MCP server registry. When supplied,
     * each subagent spawn propagates it into SubagentLoop so upstream
     * MCP tools declared in `def.mcpServers` are resolved + injected
     * into the child's scoped tool registry.
     */
    private readonly mcpRegistry?: McpServerRegistry,
  ) {}

  /**
   * Spawn a single subagent.
   *
   * @param parentCtx  Parent's workspace, taskId, parent task run id,
   *                   operator role, and remaining-budget-USD for this slot.
   */
  async spawn(parentCtx: ParentContext, req: SpawnRequest): Promise<SubagentRunResult> {
    const def = this.resolveDefinition(req.name);
    if (!def) {
      return this.failNotFound(req.name, parentCtx);
    }

    const allocation = this.allocateBudget(parentCtx.remainingBudgetUsd, [
      { weight: req.budgetWeight ?? def.budgetWeight, def },
    ]);
    const allocated = allocation[0]?.allocatedUsd ?? 0;

    const frame = await this.beginSpawn({
      parentCtx,
      def,
      allocatedUsd: allocated,
      task: req.task,
    });

    const loop = new SubagentLoop(
      this.db,
      this.parentTools,
      this.parentPolicy,
      this.llm,
      undefined,
      this.mcpRegistry,
    );
    emitConductEvent({
      type: 'subagent.spawned',
      taskId: parentCtx.taskId,
      payload: { name: def.name, task: req.task, budgetUsd: allocated },
    });
    const result = await loop.run({
      def,
      input: req.task,
      frame,
      workspaceId: parentCtx.workspaceId,
      taskId: parentCtx.taskId,
    });
    emitConductEvent({
      type: 'subagent.completed',
      taskId: parentCtx.taskId,
      payload: {
        name: result.name,
        verdict: result.verdict,
        costUsd: result.costUsd,
        iterationsUsed: result.iterationsUsed,
      },
    });
    return result;
  }

  /**
   * Dispatch multiple subagents concurrently.
   * Budget is allocated weighted across all spawns (5% floor per child).
   */
  async parallel(
    parentCtx: ParentContext,
    reqs: SpawnRequest[],
  ): Promise<SubagentRunResult[]> {
    const resolved = reqs.map((req) => ({
      req,
      def: this.resolveDefinition(req.name),
    }));

    const missing = resolved.filter((r) => !r.def);
    if (missing.length > 0) {
      // Fail the whole batch rather than mix resolved + unresolved — the
      // parent LLM should get a crisp error it can react to.
      return missing.map((m) => this.failNotFound(m.req.name, parentCtx));
    }

    const allocs = this.allocateBudget(
      parentCtx.remainingBudgetUsd,
      resolved.map((r) => ({
        weight: r.req.budgetWeight ?? r.def!.budgetWeight,
        def: r.def!,
      })),
    );

    const runs = resolved.map(async (r, i) => {
      const allocated = allocs[i]?.allocatedUsd ?? 0;
      const frame = await this.beginSpawn({
        parentCtx,
        def: r.def!,
        allocatedUsd: allocated,
        task: r.req.task,
      });
      const loop = new SubagentLoop(
        this.db,
        this.parentTools,
        this.parentPolicy,
        this.llm,
        undefined,
        this.mcpRegistry,
      );
      emitConductEvent({
        type: 'subagent.spawned',
        taskId: parentCtx.taskId,
        payload: { name: r.def!.name, task: r.req.task, budgetUsd: allocated },
      });
      const childResult = await loop.run({
        def: r.def!,
        input: r.req.task,
        frame,
        workspaceId: parentCtx.workspaceId,
        taskId: parentCtx.taskId,
      });
      emitConductEvent({
        type: 'subagent.completed',
        taskId: parentCtx.taskId,
        payload: {
          name: childResult.name,
          verdict: childResult.verdict,
          costUsd: childResult.costUsd,
          iterationsUsed: childResult.iterationsUsed,
        },
      });
      return childResult;
    });

    return Promise.all(runs);
  }

  list(): SubagentDefinition[] {
    return this.registry.list();
  }

  // ─── internals ───

  private resolveDefinition(ref: string): SubagentDefinition | undefined {
    return this.registry.findByName(ref) ?? this.registry.findByDescription(ref);
  }

  /**
   * Weighted split with a 5% floor per child. Normalises if the naive
   * weighted sum exceeds remaining budget — prevents the parent LLM from
   * claiming more than it has by proposing huge weights.
   */
  private allocateBudget(
    remainingUsd: number,
    items: Array<{ weight: number; def: SubagentDefinition }>,
  ): Array<{ allocatedUsd: number }> {
    const floor = Math.max(0.01, remainingUsd * 0.05);
    const totalWeight = items.reduce((s, it) => s + it.weight, 0) || 1;

    const raw = items.map((it) => Math.max(floor, (remainingUsd * it.weight) / totalWeight));
    const sum = raw.reduce((s, v) => s + v, 0);
    if (sum <= remainingUsd) {
      return raw.map((v) => ({ allocatedUsd: v }));
    }
    const scale = remainingUsd / sum;
    return raw.map((v) => ({ allocatedUsd: v * scale }));
  }

  private async beginSpawn(params: {
    parentCtx: ParentContext;
    def: SubagentDefinition;
    allocatedUsd: number;
    task: string;
  }): Promise<SubagentFrame> {
    const { parentCtx, def, allocatedUsd, task } = params;

    const principalSuffix = randomUUID().slice(0, 6);
    const principal =
      `workspace:${parentCtx.workspaceId}/operator:${def.operatorRole}` +
      `/subagent:${def.name}:${principalSuffix}`;

    // 1. Locate parent's most-recent LLM_INFERENCE pack to anchor the spawn.
    const parentEvidencePackId = await this.findParentReceipt(
      parentCtx.workspaceId,
      parentCtx.parentTaskRunId,
    );

    // 2. Write the SUBAGENT_SPAWN evidence pack (Path A: unsigned local marker).
    const spawnPackId = await this.writeSpawnEvidencePack({
      workspaceId: parentCtx.workspaceId,
      parentEvidencePackId,
      principal,
      def,
      policyVersion: parentCtx.policyVersion,
    });

    // 3. Write the subagent's parent task_runs row.
    const subagentTaskRunId = await this.writeSubagentTaskRun({
      taskId: parentCtx.taskId,
      parentTaskRunId: parentCtx.parentTaskRunId,
      def,
      task,
      allocatedUsd,
    });

    return {
      parentTaskRunId: subagentTaskRunId,
      parentEvidencePackId: spawnPackId,
      operatorRole: def.operatorRole,
      budgetSliceAllocated: allocatedUsd,
    };
  }

  private async findParentReceipt(
    workspaceId: string,
    parentTaskRunId: string | null,
  ): Promise<string | null> {
    if (!parentTaskRunId) return null;
    try {
      const { evidencePacks } = await import('@helm-pilot/db/schema');
      const { eq, and, desc } = await import('drizzle-orm');
      const [row] = await this.db
        .select({ id: evidencePacks.id })
        .from(evidencePacks)
        .where(
          and(
            eq(evidencePacks.workspaceId, workspaceId),
            eq(evidencePacks.taskRunId, parentTaskRunId),
          ),
        )
        .orderBy(desc(evidencePacks.receivedAt))
        .limit(1);
      return row?.id ?? null;
    } catch {
      return null;
    }
  }

  private async writeSpawnEvidencePack(params: {
    workspaceId: string;
    parentEvidencePackId: string | null;
    principal: string;
    def: SubagentDefinition;
    policyVersion: string;
  }): Promise<string> {
    try {
      const { evidencePacks } = await import('@helm-pilot/db/schema');
      const [row] = await this.db
        .insert(evidencePacks)
        .values({
          workspaceId: params.workspaceId,
          decisionId: `local_spawn_${randomUUID()}`,
          verdict: 'ALLOW',
          policyVersion: params.policyVersion,
          action: 'SUBAGENT_SPAWN',
          resource: params.def.name,
          principal: params.principal,
          signedBlob: null,
          parentEvidencePackId: params.parentEvidencePackId,
        })
        .returning({ id: evidencePacks.id });
      return row?.id ?? '';
    } catch {
      return '';
    }
  }

  private async writeSubagentTaskRun(params: {
    taskId: string;
    parentTaskRunId: string | null;
    def: SubagentDefinition;
    task: string;
    allocatedUsd: number;
  }): Promise<string> {
    try {
      const { taskRuns } = await import('@helm-pilot/db/schema');
      const [row] = await this.db
        .insert(taskRuns)
        .values({
          taskId: params.taskId,
          status: 'running',
          actionTool: 'subagent.spawn',
          actionInput: { name: params.def.name, task: params.task },
          verdict: 'allow',
          iterationsUsed: 0,
          iterationBudget: params.def.iterationBudget,
          modelUsed: 'conductor',
          parentTaskRunId: params.parentTaskRunId,
          operatorRole: params.def.operatorRole,
          budgetSliceAllocated: params.allocatedUsd.toFixed(4),
          budgetSliceUsed: '0.0000',
        })
        .returning({ id: taskRuns.id });
      return row?.id ?? '';
    } catch {
      return '';
    }
  }

  private failNotFound(name: string, parentCtx: ParentContext): SubagentRunResult {
    return {
      name,
      summary: `Subagent "${name}" not found in registry. Available: ${this.registry
        .list()
        .map((d) => d.name)
        .join(', ')}`,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      iterationsUsed: 0,
      taskRunId: parentCtx.parentTaskRunId ?? '',
      spawnEvidencePackId: '',
      verdict: 'failed',
      error: 'subagent_not_found',
    };
  }
}

export interface ParentContext {
  workspaceId: string;
  taskId: string;
  /** task_runs.id of the conductor iteration that produced this spawn. */
  parentTaskRunId: string | null;
  operatorRole: string;
  policyVersion: string;
  /** USD available to the conductor for delegations this iteration. */
  remainingBudgetUsd: number;
}

export interface SpawnRequest {
  name: string;
  task: string;
  budgetWeight?: number;
}

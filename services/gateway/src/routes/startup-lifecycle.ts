import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { appendEvidenceItem } from '@pilot/db';
import {
  goals,
  missionEdges,
  missionNodes,
  missions,
  missionTasks,
  tasks,
  ventures,
} from '@pilot/db/schema';
import {
  CompileStartupLifecycleInputSchema,
  ExecutedStartupMissionSchema,
  ExecutedStartupMissionNodeSchema,
  ExecuteStartupMissionInputSchema,
  ExecuteStartupMissionNodeInputSchema,
  type ExecutedStartupMissionNode,
  PersistStartupLifecycleInputSchema,
  PersistedStartupLifecycleMissionSchema,
  ScheduledStartupMissionSchema,
  ScheduleStartupMissionInputSchema,
  compileStartupLifecycleMission,
  getStartupLifecycleTemplates,
} from '@pilot/shared/schemas';
import { getCapabilityRecord } from '@pilot/shared/capabilities';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole, workspaceIdMismatch } from '../lib/workspace.js';

type MissionContextRunTask = (params: {
  taskId: string;
  workspaceId: string;
  ventureId?: string;
  missionId?: string;
  operatorId?: string;
  context: string;
  iterationBudget?: number;
}) => ReturnType<GatewayDeps['orchestrator']['runTask']>;

export function startupLifecycleRoutes(_deps: GatewayDeps) {
  const app = new Hono();

  app.get('/templates', (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view startup lifecycle templates');
    if (roleDenied) return roleDenied;

    return c.json({
      workspaceId,
      capability: getCapabilityRecord('startup_lifecycle'),
      templates: getStartupLifecycleTemplates(),
    });
  });

  app.post('/compile', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'compile startup lifecycle mission');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = CompileStartupLifecycleInputSchema.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const compiled = compileStartupLifecycleMission(parsed.data);
    return c.json(compiled, 200);
  });

  app.post('/persist', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'persist startup lifecycle mission');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = PersistStartupLifecycleInputSchema.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const compiled = compileStartupLifecycleMission(parsed.data);
    const ventureName = parsed.data.ventureName ?? deriveVentureName(parsed.data.founderGoal);

    const [createdVenture] = await _deps.db
      .insert(ventures)
      .values({
        workspaceId,
        name: ventureName,
        status: 'draft',
        metadata: {
          source: 'startup_lifecycle_persist',
          ventureContext: parsed.data.ventureContext ?? null,
          productionReady: false,
        },
      })
      .returning();
    if (!createdVenture) return c.json({ error: 'venture was not persisted' }, 500);

    const [createdGoal] = await _deps.db
      .insert(goals)
      .values({
        workspaceId,
        ventureId: createdVenture.id,
        title: 'Founder startup goal',
        description: parsed.data.founderGoal,
        status: 'compiled',
        autonomyMode: parsed.data.autonomyMode,
        constraints: parsed.data.constraints,
        metadata: {
          source: 'startup_lifecycle_persist',
          ventureContext: parsed.data.ventureContext ?? null,
        },
      })
      .returning();
    if (!createdGoal) return c.json({ error: 'goal was not persisted' }, 500);

    const [createdMission] = await _deps.db
      .insert(missions)
      .values({
        workspaceId,
        ventureId: createdVenture.id,
        goalId: createdGoal.id,
        missionKey: compiled.mission.id,
        title: compiled.mission.title,
        status: 'persisted_not_executing',
        compilerVersion: compiled.compilerVersion,
        autonomyMode: compiled.mission.autonomyMode,
        capabilityState: compiled.capabilityState,
        productionReady: false,
        assumptions: compiled.mission.assumptions,
        blockers: persistedMissionBlockers(compiled.mission.blockers),
        metadata: {
          source: 'startup_lifecycle_persist',
          founderGoal: compiled.mission.founderGoal,
          ventureContext: compiled.mission.ventureContext ?? null,
          constraints: compiled.mission.constraints,
        },
      })
      .returning();
    if (!createdMission) return c.json({ error: 'mission was not persisted' }, 500);

    const createdNodes = [];
    for (const [index, node] of compiled.mission.nodes.entries()) {
      const [createdNode] = await _deps.db
        .insert(missionNodes)
        .values({
          workspaceId,
          missionId: createdMission.id,
          nodeKey: node.id,
          stage: node.stage,
          title: node.title,
          objective: node.objective,
          status: 'pending',
          sortOrder: index,
          requiredAgents: node.requiredAgents,
          requiredSkills: node.requiredSkills,
          requiredTools: node.requiredTools,
          requiredEvidence: node.requiredEvidence,
          helmPolicyClasses: node.helmPolicyClasses,
          escalationConditions: node.escalationConditions,
          acceptanceCriteria: node.acceptanceCriteria,
          metadata: {
            dependsOn: node.dependsOn,
            source: 'startup_lifecycle_template',
          },
        })
        .returning();
      if (!createdNode) return c.json({ error: `mission node ${node.id} was not persisted` }, 500);
      createdNodes.push({ node, row: createdNode });
    }

    if (compiled.mission.edges.length > 0) {
      await _deps.db.insert(missionEdges).values(
        compiled.mission.edges.map((edge) => ({
          workspaceId,
          missionId: createdMission.id,
          edgeKey: edge.id,
          fromNodeKey: edge.from,
          toNodeKey: edge.to,
          reason: edge.reason,
          metadata: { source: 'startup_lifecycle_template' },
        })),
      );
    }

    let taskCount = 0;
    if (parsed.data.createNodeTasks) {
      for (const { node, row } of createdNodes) {
        const [createdTask] = await _deps.db
          .insert(tasks)
          .values({
            workspaceId,
            title: `[Lifecycle] ${node.title}`,
            description: node.objective,
            mode: 'mission',
            status: 'pending',
            priority: taskPriorityForStage(node.stage),
            metadata: {
              kind: 'startup_lifecycle_node',
              ventureId: createdVenture.id,
              goalId: createdGoal.id,
              missionId: createdMission.id,
              missionNodeId: row.id,
              stage: node.stage,
              requiredAgents: node.requiredAgents,
              requiredSkills: node.requiredSkills,
              requiredTools: node.requiredTools,
              requiredEvidence: node.requiredEvidence,
              helmPolicyClasses: node.helmPolicyClasses,
              escalationConditions: node.escalationConditions,
              acceptanceCriteria: node.acceptanceCriteria,
              productionReady: false,
            },
          })
          .returning();
        if (!createdTask)
          return c.json({ error: `task for node ${node.id} was not persisted` }, 500);
        await _deps.db.insert(missionTasks).values({
          workspaceId,
          missionId: createdMission.id,
          nodeId: row.id,
          taskId: createdTask.id,
          role: 'startup_lifecycle_node',
        });
        taskCount += 1;
      }
    }

    const evidenceItemId = await appendEvidenceItem(_deps.db, {
      workspaceId,
      ventureId: createdVenture.id,
      missionId: createdMission.id,
      evidenceType: 'startup_lifecycle_mission_persisted',
      sourceType: 'gateway_startup_lifecycle',
      title: `Startup lifecycle mission persisted: ${compiled.mission.title}`,
      summary: compiled.mission.founderGoal,
      redactionState: 'redacted',
      sensitivity: 'internal',
      contentHash: hashJson({
        missionKey: compiled.mission.id,
        founderGoal: compiled.mission.founderGoal,
        nodeKeys: compiled.mission.nodes.map((node) => node.id),
        edges: compiled.mission.edges,
      }),
      replayRef: `mission:${createdMission.id}:persisted`,
      metadata: {
        compilerVersion: compiled.compilerVersion,
        autonomyMode: compiled.mission.autonomyMode,
        capabilityState: compiled.capabilityState,
        productionReady: false,
        nodeCount: createdNodes.length,
        edgeCount: compiled.mission.edges.length,
        taskCount,
        source: 'startup_lifecycle_persist',
      },
    });

    const response = PersistedStartupLifecycleMissionSchema.parse({
      ...compiled,
      evidenceItemIds: [evidenceItemId],
      mission: {
        ...compiled.mission,
        status: 'persisted_not_executing',
        blockers: persistedMissionBlockers(compiled.mission.blockers),
      },
      persisted: {
        ventureId: createdVenture.id,
        goalId: createdGoal.id,
        missionId: createdMission.id,
        nodeCount: createdNodes.length,
        edgeCount: compiled.mission.edges.length,
        taskCount,
      },
    });

    return c.json(response, 201);
  });

  app.post('/missions/:missionId/schedule', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'schedule startup lifecycle mission');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = ScheduleStartupMissionInputSchema.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
      missionId: c.req.param('missionId'),
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const [mission] = await _deps.db
      .select()
      .from(missions)
      .where(and(eq(missions.id, parsed.data.missionId), eq(missions.workspaceId, workspaceId)))
      .limit(1);
    if (!mission) return c.json({ error: 'Mission not found' }, 404);

    const nodeRows = await _deps.db
      .select()
      .from(missionNodes)
      .where(eq(missionNodes.missionId, mission.id));
    const edgeRows = await _deps.db
      .select()
      .from(missionEdges)
      .where(eq(missionEdges.missionId, mission.id));
    const taskLinks = await _deps.db
      .select()
      .from(missionTasks)
      .where(eq(missionTasks.missionId, mission.id));

    const taskIdByNodeId = new Map(
      taskLinks
        .filter((link) => Boolean(link.nodeId))
        .map((link) => [String(link.nodeId), link.taskId]),
    );
    const completedNodeKeys = new Set(
      nodeRows
        .filter((node) => node.status === 'completed' || node.status === 'skipped')
        .map((node) => node.nodeKey),
    );

    const ready = [];
    const blocked = [];
    for (const node of nodeRows.filter((item) => item.status === 'pending')) {
      const waitingOn = edgeRows
        .filter((edge) => edge.toNodeKey === node.nodeKey)
        .map((edge) => edge.fromNodeKey)
        .filter((dependency) => !completedNodeKeys.has(dependency));
      const scheduledNode = {
        nodeId: node.id,
        nodeKey: node.nodeKey,
        stage: node.stage,
        title: node.title,
        taskId: taskIdByNodeId.get(node.id),
        waitingOn,
      };
      if (waitingOn.length === 0 && ready.length < parsed.data.maxNodes) {
        ready.push(scheduledNode);
      } else {
        blocked.push({
          ...scheduledNode,
          waitingOn: waitingOn.length > 0 ? waitingOn : ['scheduler_batch_limit'],
        });
      }
    }

    for (const node of ready) {
      await _deps.db
        .update(missionNodes)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(and(eq(missionNodes.id, node.nodeId), eq(missionNodes.workspaceId, workspaceId)));
    }

    await _deps.db
      .update(missions)
      .set({ status: 'scheduled_not_executing', updatedAt: new Date() })
      .where(and(eq(missions.id, mission.id), eq(missions.workspaceId, workspaceId)));

    const evidenceItemId = await appendEvidenceItem(_deps.db, {
      workspaceId,
      ventureId: mission.ventureId ?? null,
      missionId: mission.id,
      evidenceType: 'startup_lifecycle_nodes_scheduled',
      sourceType: 'gateway_startup_lifecycle',
      title: `Startup lifecycle nodes scheduled: ${mission.title}`,
      summary: `${ready.length} ready node(s), ${blocked.length} blocked node(s)`,
      redactionState: 'redacted',
      sensitivity: 'internal',
      contentHash: hashJson({ ready, blocked }),
      replayRef: `mission:${mission.id}:schedule`,
      metadata: {
        schedulerVersion: 'mission-scheduler.v1',
        readyNodeKeys: ready.map((node) => node.nodeKey),
        blockedNodeKeys: blocked.map((node) => node.nodeKey),
        queuedTaskIds: ready
          .map((node) => node.taskId)
          .filter((taskId): taskId is string => Boolean(taskId)),
        productionReady: false,
      },
    });

    const response = ScheduledStartupMissionSchema.parse({
      workspaceId,
      missionId: mission.id,
      schedulerVersion: 'mission-scheduler.v1',
      productionReady: false,
      status: 'scheduled_not_executing',
      readyNodes: ready,
      blockedNodes: blocked,
      queuedTaskIds: ready
        .map((node) => node.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
      evidenceItemIds: [evidenceItemId],
      executionStarted: false,
      blockers: [
        'Mission scheduler identifies ready nodes and task rows but does not dispatch autonomous execution yet',
        'Mission runtime remains blocked until node execution, checkpointing, recovery, and Full Startup Launch Eval pass',
      ],
    });

    return c.json(response, 200);
  });

  app.post('/missions/:missionId/nodes/:nodeId/execute', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'execute startup lifecycle mission node');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = ExecuteStartupMissionNodeInputSchema.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
      missionId: c.req.param('missionId'),
      nodeId: c.req.param('nodeId'),
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const [mission] = await _deps.db
      .select()
      .from(missions)
      .where(and(eq(missions.id, parsed.data.missionId), eq(missions.workspaceId, workspaceId)))
      .limit(1);
    if (!mission) return c.json({ error: 'Mission not found' }, 404);

    const [node] = await _deps.db
      .select()
      .from(missionNodes)
      .where(
        and(
          eq(missionNodes.id, parsed.data.nodeId),
          eq(missionNodes.missionId, mission.id),
          eq(missionNodes.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!node) return c.json({ error: 'Mission node not found' }, 404);
    if (node.status !== 'ready') {
      return c.json(
        {
          error: 'mission node is not ready for execution',
          nodeStatus: node.status,
          requiredStatus: 'ready',
        },
        409,
      );
    }

    const result = await executeReadyMissionNode(_deps, workspaceId, mission, node, {
      context: parsed.data.context,
      iterationBudget: parsed.data.iterationBudget,
    });
    if (!result.ok) return c.json(result.body, result.status);
    return c.json(result.response, 200);
  });

  app.post('/missions/:missionId/execute-ready', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'execute ready startup lifecycle nodes');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = ExecuteStartupMissionInputSchema.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
      missionId: c.req.param('missionId'),
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const [mission] = await _deps.db
      .select()
      .from(missions)
      .where(and(eq(missions.id, parsed.data.missionId), eq(missions.workspaceId, workspaceId)))
      .limit(1);
    if (!mission) return c.json({ error: 'Mission not found' }, 404);

    const executedNodes: ExecutedStartupMissionNode[] = [];
    let missionStatus: 'completed' | 'scheduled_not_executing' | 'blocked' | 'awaiting_approval' =
      'scheduled_not_executing';
    for (let index = 0; index < parsed.data.maxNodes; index += 1) {
      const [node] = await _deps.db
        .select()
        .from(missionNodes)
        .where(
          and(
            eq(missionNodes.missionId, mission.id),
            eq(missionNodes.workspaceId, workspaceId),
            eq(missionNodes.status, 'ready'),
          ),
        )
        .orderBy(missionNodes.sortOrder)
        .limit(1);
      if (!node) break;

      const result = await executeReadyMissionNode(_deps, workspaceId, mission, node, {
        context: parsed.data.context,
        iterationBudget: parsed.data.iterationBudget,
      });
      if (!result.ok) return c.json(result.body, result.status);
      executedNodes.push(result.response);
      missionStatus = result.response.missionStatus;
      if (result.response.status !== 'completed') break;
    }

    const remainingReadyNodes = await _deps.db
      .select({ id: missionNodes.id })
      .from(missionNodes)
      .where(
        and(
          eq(missionNodes.missionId, mission.id),
          eq(missionNodes.workspaceId, workspaceId),
          eq(missionNodes.status, 'ready'),
        ),
      )
      .orderBy(missionNodes.sortOrder);

    const response = ExecutedStartupMissionSchema.parse({
      workspaceId,
      missionId: mission.id,
      executorVersion: 'mission-executor.v1',
      productionReady: false,
      executionStarted: executedNodes.length > 0,
      missionStatus:
        executedNodes.length > 0
          ? missionStatus
          : remainingReadyNodes.length > 0
            ? 'scheduled_not_executing'
            : mission.status === 'completed'
              ? 'completed'
              : 'blocked',
      executedNodes,
      remainingReadyNodeIds: remainingReadyNodes.map((node) => node.id),
      evidenceItemIds: executedNodes.flatMap((node) => node.evidenceItemIds),
      blockers: missionExecutorBlockers(executedNodes.length, remainingReadyNodes.length),
    });

    return c.json(response, 200);
  });

  return app;
}

async function executeReadyMissionNode(
  deps: GatewayDeps,
  workspaceId: string,
  mission: typeof missions.$inferSelect,
  node: typeof missionNodes.$inferSelect,
  input: {
    context?: string;
    iterationBudget?: number;
  },
): Promise<
  | { ok: true; response: typeof ExecutedStartupMissionNodeSchema._type }
  | {
      ok: false;
      status: 404 | 409 | 502;
      body: Record<string, unknown>;
    }
> {
  const [taskLink] = await deps.db
    .select()
    .from(missionTasks)
    .where(
      and(
        eq(missionTasks.missionId, mission.id),
        eq(missionTasks.nodeId, node.id),
        eq(missionTasks.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!taskLink) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'mission node has no execution task',
        remediation: 'Persist the lifecycle mission with createNodeTasks=true before execution.',
      },
    };
  }

  const [task] = await deps.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskLink.taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) {
    return { ok: false, status: 404, body: { error: 'Mission node task not found' } };
  }

  await deps.db
    .update(missionNodes)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(missionNodes.id, node.id), eq(missionNodes.workspaceId, workspaceId)));
  await deps.db
    .update(missions)
    .set({ status: 'running', startedAt: mission.startedAt ?? new Date(), updatedAt: new Date() })
    .where(and(eq(missions.id, mission.id), eq(missions.workspaceId, workspaceId)));
  await deps.db
    .update(tasks)
    .set({ status: 'running', completedAt: null, updatedAt: new Date() })
    .where(and(eq(tasks.id, task.id), eq(tasks.workspaceId, workspaceId)));

  const runTaskWithMissionContext = deps.orchestrator.runTask as MissionContextRunTask;
  let run;
  try {
    run = await runTaskWithMissionContext({
      taskId: task.id,
      workspaceId,
      ...(mission.ventureId ? { ventureId: mission.ventureId } : {}),
      missionId: mission.id,
      ...(task.operatorId ? { operatorId: task.operatorId } : {}),
      context: input.context ?? missionNodeExecutionContext(mission, node, task.description),
      iterationBudget: input.iterationBudget,
    });
  } catch (err) {
    const failedAt = new Date();
    await deps.db
      .update(missionNodes)
      .set({ status: 'failed', updatedAt: failedAt, completedAt: failedAt })
      .where(and(eq(missionNodes.id, node.id), eq(missionNodes.workspaceId, workspaceId)));
    await deps.db
      .update(missions)
      .set({ status: 'blocked', updatedAt: failedAt })
      .where(and(eq(missions.id, mission.id), eq(missions.workspaceId, workspaceId)));
    await deps.db
      .update(tasks)
      .set({ status: 'failed', updatedAt: failedAt, completedAt: failedAt })
      .where(and(eq(tasks.id, task.id), eq(tasks.workspaceId, workspaceId)));
    const evidenceItemId = await appendEvidenceItem(deps.db, {
      workspaceId,
      ventureId: mission.ventureId ?? null,
      missionId: mission.id,
      taskId: task.id,
      evidenceType: 'startup_lifecycle_node_failed',
      sourceType: 'gateway_startup_lifecycle',
      title: `Startup lifecycle node failed: ${node.title}`,
      summary: err instanceof Error ? err.message : String(err),
      redactionState: 'redacted',
      sensitivity: 'internal',
      contentHash: hashJson({
        nodeId: node.id,
        nodeKey: node.nodeKey,
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      }),
      replayRef: `mission:${mission.id}:node:${node.id}:failure`,
      metadata: {
        executorVersion: 'mission-node-executor.v1',
        nodeKey: node.nodeKey,
        stage: node.stage,
        nodeStatus: 'failed',
        missionStatus: 'blocked',
        productionReady: false,
      },
    });
    return {
      ok: false,
      status: 502,
      body: {
        error: 'mission node execution failed',
        detail: err instanceof Error ? err.message : String(err),
        productionReady: false,
        evidenceItemIds: [evidenceItemId],
      },
    };
  }

  const nodeStatus = mapRunStatusToMissionNodeStatus(run.status);
  await deps.db
    .update(missionNodes)
    .set({
      status: nodeStatus,
      updatedAt: new Date(),
      completedAt: nodeStatus === 'completed' ? new Date() : null,
    })
    .where(and(eq(missionNodes.id, node.id), eq(missionNodes.workspaceId, workspaceId)));
  await deps.db
    .update(tasks)
    .set({
      status: mapRunStatusToTaskStatus(run.status),
      updatedAt: new Date(),
      completedAt: run.status === 'completed' ? new Date() : null,
    })
    .where(and(eq(tasks.id, task.id), eq(tasks.workspaceId, workspaceId)));

  const advancement =
    nodeStatus === 'completed'
      ? await advanceReadyMissionNodes(deps, workspaceId, mission.id)
      : {
          advancedReadyNodes: [],
          missionStatus: mapRunStatusToMissionStatus(run.status),
        };
  await deps.db
    .update(missions)
    .set({
      status: advancement.missionStatus,
      updatedAt: new Date(),
      completedAt: advancement.missionStatus === 'completed' ? new Date() : null,
    })
    .where(and(eq(missions.id, mission.id), eq(missions.workspaceId, workspaceId)));

  const evidenceItemId = await appendEvidenceItem(deps.db, {
    workspaceId,
    ventureId: mission.ventureId ?? null,
    missionId: mission.id,
    taskId: task.id,
    evidenceType: 'startup_lifecycle_node_executed',
    sourceType: 'gateway_startup_lifecycle',
    title: `Startup lifecycle node executed: ${node.title}`,
    summary: `${node.nodeKey} finished with ${nodeStatus}`,
    redactionState: 'redacted',
    sensitivity: 'internal',
    contentHash: hashJson({
      nodeId: node.id,
      nodeKey: node.nodeKey,
      taskId: task.id,
      runStatus: run.status,
      iterationsUsed: run.iterationsUsed,
      actionCount: run.actions.length,
      advancedReadyNodes: advancement.advancedReadyNodes.map((advanced) => advanced.nodeKey),
    }),
    replayRef: `mission:${mission.id}:node:${node.id}:execute`,
    metadata: {
      executorVersion: 'mission-node-executor.v1',
      nodeKey: node.nodeKey,
      stage: node.stage,
      runStatus: run.status,
      nodeStatus,
      missionStatus: advancement.missionStatus,
      iterationsUsed: run.iterationsUsed,
      iterationBudget: run.iterationBudget,
      actionCount: run.actions.length,
      advancedReadyNodeKeys: advancement.advancedReadyNodes.map((advanced) => advanced.nodeKey),
      productionReady: false,
    },
  });

  const response = ExecutedStartupMissionNodeSchema.parse({
    workspaceId,
    missionId: mission.id,
    nodeId: node.id,
    nodeKey: node.nodeKey,
    taskId: task.id,
    executorVersion: 'mission-node-executor.v1',
    productionReady: false,
    executionStarted: true,
    status: nodeStatus,
    missionStatus: advancement.missionStatus,
    run: {
      status: run.status,
      iterationsUsed: run.iterationsUsed,
      iterationBudget: run.iterationBudget,
      actionCount: run.actions.length,
    },
    advancedReadyNodes: advancement.advancedReadyNodes,
    evidenceItemIds: [evidenceItemId],
    blockers: missionNodeExecutionBlockers(run.status),
  });

  return { ok: true, response };
}

function deriveVentureName(founderGoal: string): string {
  const compact = founderGoal.replace(/\s+/g, ' ').trim();
  if (compact.length <= 80) return compact;
  return `${compact.slice(0, 77).trim()}...`;
}

function taskPriorityForStage(stage: string): number {
  if (stage === 'founder_onboarding') return 100;
  if (stage === 'ideation' || stage === 'market_research' || stage === 'pmf_discovery') return 90;
  if (stage === 'engineering' || stage === 'infrastructure_deployment') return 80;
  if (stage.includes('prep')) return 70;
  return 50;
}

function persistedMissionBlockers(blockers: readonly string[]): string[] {
  const stalePersistenceBlockers = new Set([
    'Mission DAG is not persisted as the runtime backbone yet',
    'Lifecycle nodes are not bound to durable venture/mission/action records yet',
  ]);

  return [
    ...blockers.filter((blocker) => !stalePersistenceBlockers.has(blocker)),
    'Mission DAG is persisted but not executing through the runtime yet',
    'Lifecycle nodes are not yet dispatched as governed action/tool/evidence workflows',
  ];
}

function missionNodeExecutionContext(
  mission: typeof missions.$inferSelect,
  node: typeof missionNodes.$inferSelect,
  taskDescription: string,
): string {
  return [
    `Mission: ${mission.title}`,
    `Lifecycle node: ${node.title}`,
    `Objective: ${node.objective}`,
    `Task: ${taskDescription}`,
    `Required evidence: ${node.requiredEvidence.join(', ')}`,
    `Acceptance criteria: ${node.acceptanceCriteria.join(', ')}`,
    `HELM policy classes: ${node.helmPolicyClasses.join(', ')}`,
    'Do not perform irreversible external actions unless HELM policy and the current workspace mode explicitly allow them.',
  ].join('\n');
}

function mapRunStatusToMissionNodeStatus(
  status: 'completed' | 'budget_exhausted' | 'blocked' | 'awaiting_approval',
) {
  if (status === 'completed') return 'completed';
  if (status === 'awaiting_approval') return 'awaiting_approval';
  if (status === 'blocked') return 'blocked';
  return 'failed';
}

function mapRunStatusToTaskStatus(
  status: 'completed' | 'budget_exhausted' | 'blocked' | 'awaiting_approval',
) {
  if (status === 'completed') return 'completed';
  if (status === 'awaiting_approval') return 'awaiting_approval';
  return 'failed';
}

function mapRunStatusToMissionStatus(
  status: 'completed' | 'budget_exhausted' | 'blocked' | 'awaiting_approval',
) {
  if (status === 'awaiting_approval') return 'awaiting_approval';
  return 'blocked';
}

async function advanceReadyMissionNodes(
  deps: GatewayDeps,
  workspaceId: string,
  missionId: string,
): Promise<{
  advancedReadyNodes: Array<{
    nodeId: string;
    nodeKey: string;
    stage: string;
    title: string;
    taskId?: string;
    waitingOn: string[];
  }>;
  missionStatus: 'completed' | 'scheduled_not_executing' | 'blocked' | 'awaiting_approval';
}> {
  const nodeRows = await deps.db
    .select()
    .from(missionNodes)
    .where(and(eq(missionNodes.missionId, missionId), eq(missionNodes.workspaceId, workspaceId)));
  const edgeRows = await deps.db
    .select()
    .from(missionEdges)
    .where(and(eq(missionEdges.missionId, missionId), eq(missionEdges.workspaceId, workspaceId)));
  const taskLinks = await deps.db
    .select()
    .from(missionTasks)
    .where(and(eq(missionTasks.missionId, missionId), eq(missionTasks.workspaceId, workspaceId)));

  const taskIdByNodeId = new Map(
    taskLinks
      .filter((link) => Boolean(link.nodeId))
      .map((link) => [String(link.nodeId), link.taskId]),
  );
  const completedNodeKeys = new Set(
    nodeRows
      .filter((node) => node.status === 'completed' || node.status === 'skipped')
      .map((node) => node.nodeKey),
  );
  const advancedReadyNodes = [];
  for (const node of nodeRows.filter((item) => item.status === 'pending')) {
    const waitingOn = edgeRows
      .filter((edge) => edge.toNodeKey === node.nodeKey)
      .map((edge) => edge.fromNodeKey)
      .filter((dependency) => !completedNodeKeys.has(dependency));
    if (waitingOn.length > 0) continue;
    const taskId = taskIdByNodeId.get(node.id);
    const advanced = {
      nodeId: node.id,
      nodeKey: node.nodeKey,
      stage: node.stage,
      title: node.title,
      waitingOn,
      ...(taskId ? { taskId } : {}),
    };
    await deps.db
      .update(missionNodes)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(and(eq(missionNodes.id, node.id), eq(missionNodes.workspaceId, workspaceId)));
    advancedReadyNodes.push(advanced);
  }

  if (
    nodeRows.length > 0 &&
    nodeRows.every((node) => node.status === 'completed' || node.status === 'skipped')
  ) {
    return { advancedReadyNodes, missionStatus: 'completed' };
  }
  if (advancedReadyNodes.length > 0) {
    return { advancedReadyNodes, missionStatus: 'scheduled_not_executing' };
  }
  if (nodeRows.some((node) => node.status === 'ready')) {
    return { advancedReadyNodes, missionStatus: 'scheduled_not_executing' };
  }
  if (nodeRows.some((node) => node.status === 'awaiting_approval')) {
    return { advancedReadyNodes, missionStatus: 'awaiting_approval' };
  }
  return { advancedReadyNodes, missionStatus: 'blocked' };
}

function missionNodeExecutionBlockers(
  status: 'completed' | 'budget_exhausted' | 'blocked' | 'awaiting_approval',
): string[] {
  const blockers = [
    'Mission node execution uses the governed task runtime but has not passed Full Startup Launch Eval',
    'Mission-level checkpoint, recovery, rollback, and automatic next-node dispatch remain blocked',
  ];
  if (status === 'blocked')
    blockers.push('Agent run blocked before completing node acceptance criteria');
  if (status === 'budget_exhausted') blockers.push('Agent run exhausted iteration budget');
  if (status === 'awaiting_approval') blockers.push('Agent run is awaiting HELM/user approval');
  return blockers;
}

function missionExecutorBlockers(executedCount: number, remainingReadyCount: number): string[] {
  const blockers = [
    'Mission executor is explicit and bounded; it is not founder-off-grid autonomous execution',
    'Mission-level checkpoint, recovery, rollback, and Full Startup Launch Eval remain blocked',
  ];
  if (executedCount === 0) blockers.push('No ready mission node was executed');
  if (remainingReadyCount > 0) {
    blockers.push('Additional ready nodes remain and require another explicit execution call');
  }
  return blockers;
}

function hashJson(value: unknown) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortJson);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

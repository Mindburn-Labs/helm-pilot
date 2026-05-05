import { Hono } from 'hono';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import {
  actions,
  agentHandoffs,
  approvals,
  artifacts,
  auditLog,
  browserObservations,
  computerActions,
  evidenceItems,
  evidencePacks,
  taskRuns,
  tasks,
  toolExecutions,
} from '@pilot/db/schema';
import {
  getCapabilityRecord,
  getCapabilityRecords,
  getCapabilitySummary,
  type CapabilityKey,
} from '@pilot/shared/capabilities';
import {
  CommandCenterProofDagResponseSchema,
  CommandCenterResponseSchema,
} from '@pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, getWorkspaceRole, requireWorkspaceRole } from '../lib/workspace.js';

const focusCapabilityKeys = [
  'mission_runtime',
  'command_center',
  'evidence_ledger',
  'helm_receipts',
  'workspace_rbac',
  'operator_scoping',
  'browser_execution',
  'computer_use',
  'startup_lifecycle',
  'founder_off_grid',
] satisfies CapabilityKey[];

const focusCapabilityKeySet: ReadonlySet<CapabilityKey> = new Set(focusCapabilityKeys);

export function commandCenterRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view command center');
    if (roleDenied) return roleDenied;

    const capabilities = getCapabilityRecords();
    const commandCenter = getCapabilityRecord('command_center');
    const missionRuntime = getCapabilityRecord('mission_runtime');
    if (!commandCenter || !missionRuntime) {
      return c.json({ error: 'capability registry incomplete' }, 500);
    }

    const taskRows = await deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId))
      .orderBy(desc(tasks.updatedAt), desc(tasks.createdAt), desc(tasks.id))
      .limit(20);

    const taskIds = taskRows.map((task) => task.id);
    const taskRunRows =
      taskIds.length === 0
        ? []
        : await deps.db
            .select()
            .from(taskRuns)
            .where(inArray(taskRuns.taskId, taskIds))
            .orderBy(desc(taskRuns.startedAt), desc(taskRuns.runSequence), desc(taskRuns.id))
            .limit(30);

    const actionRows = await deps.db
      .select()
      .from(actions)
      .where(eq(actions.workspaceId, workspaceId))
      .orderBy(desc(actions.startedAt), desc(actions.id))
      .limit(30);

    const toolExecutionRows = await deps.db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.workspaceId, workspaceId))
      .orderBy(desc(toolExecutions.createdAt), desc(toolExecutions.id))
      .limit(30);

    const evidenceRows = await deps.db
      .select()
      .from(evidencePacks)
      .where(eq(evidencePacks.workspaceId, workspaceId))
      .orderBy(desc(evidencePacks.receivedAt), desc(evidencePacks.id))
      .limit(30);

    const evidenceItemRows = await deps.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.workspaceId, workspaceId))
      .orderBy(desc(evidenceItems.observedAt), desc(evidenceItems.id))
      .limit(30);

    const approvalRows = await deps.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.status, 'pending')))
      .orderBy(desc(approvals.requestedAt), desc(approvals.id))
      .limit(30);

    const auditRows = await deps.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, workspaceId))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(30);

    const browserObservationRows = await deps.db
      .select()
      .from(browserObservations)
      .where(eq(browserObservations.workspaceId, workspaceId))
      .orderBy(desc(browserObservations.observedAt), desc(browserObservations.replayIndex))
      .limit(20);

    const computerActionRows = await deps.db
      .select()
      .from(computerActions)
      .where(eq(computerActions.workspaceId, workspaceId))
      .orderBy(desc(computerActions.createdAt), desc(computerActions.replayIndex))
      .limit(20);

    const handoffRows = await deps.db
      .select()
      .from(agentHandoffs)
      .where(eq(agentHandoffs.workspaceId, workspaceId))
      .orderBy(desc(agentHandoffs.createdAt), desc(agentHandoffs.id))
      .limit(20);

    const artifactRows = await deps.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.workspaceId, workspaceId))
      .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
      .limit(20);

    const response = CommandCenterResponseSchema.parse({
      workspaceId,
      generatedAt: new Date().toISOString(),
      runtimeTruth: {
        productionReady:
          commandCenter.state === 'production_ready' && missionRuntime.state === 'production_ready',
        commandCenterState: commandCenter.state,
        missionRuntimeState: missionRuntime.state,
        statement:
          missionRuntime.state === 'production_ready'
            ? 'Command center is backed by mission runtime state.'
            : 'Mission runtime is not production_ready; command center exposes durable task, action, receipt, browser, computer, artifact, audit, and approval state without claiming mission autonomy.',
        blockers: Array.from(new Set([...commandCenter.blockers, ...missionRuntime.blockers])),
      },
      authorization: {
        workspaceRole: getWorkspaceRole(c) ?? null,
        requiredRole: 'partner',
        workspaceId,
      },
      capabilities: {
        summary: getCapabilitySummary(capabilities),
        records: capabilities.filter((capability) => focusCapabilityKeySet.has(capability.key)),
        focusKeys: focusCapabilityKeys,
      },
      status: {
        activeTasks: taskRows.filter((task) =>
          ['queued', 'running', 'awaiting_approval'].includes(String(task.status)),
        ).length,
        pendingApprovals: approvalRows.length,
        recentActions: actionRows.length,
        recentEvidence: evidenceRows.length,
        evidenceItems: evidenceItemRows.length,
        recentArtifacts: artifactRows.length,
        browserObservations: browserObservationRows.length,
        computerActions: computerActionRows.length,
      },
      recent: {
        tasks: taskRows,
        taskRuns: taskRunRows,
        actions: actionRows,
        toolExecutions: toolExecutionRows,
        evidencePacks: evidenceRows,
        evidenceItems: evidenceItemRows,
        approvals: approvalRows,
        auditEvents: auditRows,
        browserObservations: browserObservationRows,
        computerActions: computerActionRows,
        agentHandoffs: handoffRows,
        artifacts: artifactRows,
      },
    });

    return c.json(response);
  });

  app.get('/proof-dag/:taskRunId', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view subagent proof DAG');
    if (roleDenied) return roleDenied;

    const rootTaskRunId = c.req.param('taskRunId');
    const capability = getCapabilityRecord('subagent_lineage');
    if (!capability) return c.json({ error: 'capability registry incomplete' }, 500);

    const [rootRun] = await deps.db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.id, rootTaskRunId))
      .limit(1);
    if (!rootRun) return c.json({ error: 'Task run not found' }, 404);

    const [task] = await deps.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, rootRun.taskId), eq(tasks.workspaceId, workspaceId)))
      .limit(1);
    if (!task) return c.json({ error: 'Task run not found in workspace' }, 404);

    const taskRunRows = await deps.db
      .select()
      .from(taskRuns)
      .where(
        and(
          eq(taskRuns.taskId, rootRun.taskId),
          or(
            eq(taskRuns.id, rootTaskRunId),
            eq(taskRuns.rootTaskRunId, rootTaskRunId),
            eq(taskRuns.parentTaskRunId, rootTaskRunId),
            eq(taskRuns.spawnedByActionId, rootTaskRunId),
          ),
        ),
      )
      .orderBy(asc(taskRuns.runSequence), asc(taskRuns.startedAt), asc(taskRuns.id))
      .limit(200);

    const taskRunIds = Array.from(new Set(taskRunRows.map((row) => row.id)));
    const handoffRows =
      taskRunIds.length === 0
        ? []
        : await deps.db
            .select()
            .from(agentHandoffs)
            .where(
              and(
                eq(agentHandoffs.workspaceId, workspaceId),
                or(
                  inArray(agentHandoffs.parentTaskRunId, taskRunIds),
                  inArray(agentHandoffs.childTaskRunId, taskRunIds),
                ),
              ),
            )
            .orderBy(desc(agentHandoffs.createdAt), desc(agentHandoffs.id))
            .limit(200);
    const evidenceRows =
      taskRunIds.length === 0
        ? []
        : await deps.db
            .select()
            .from(evidencePacks)
            .where(
              and(
                eq(evidencePacks.workspaceId, workspaceId),
                inArray(evidencePacks.taskRunId, taskRunIds),
              ),
            )
            .orderBy(desc(evidencePacks.receivedAt), desc(evidencePacks.id))
            .limit(200);

    const response = CommandCenterProofDagResponseSchema.parse({
      workspaceId,
      rootTaskRunId,
      generatedAt: new Date().toISOString(),
      productionReady: false,
      capability,
      dag: {
        taskRuns: taskRunRows,
        agentHandoffs: handoffRows,
        evidencePacks: evidenceRows,
      },
      blockers: [
        'Proof DAG route is implemented for inspection but has not passed Proof DAG Lineage Regression',
        'This route does not promote subagent_lineage or command_center to production_ready',
      ],
    });

    return c.json(response);
  });

  return app;
}

import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  actions,
  agentHandoffs,
  approvals,
  artifacts,
  auditLog,
  browserObservations,
  computerActions,
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
import { CommandCenterResponseSchema } from '@pilot/shared/schemas';
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

  return app;
}

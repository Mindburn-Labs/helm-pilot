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
  CommandCenterReplayResponseSchema,
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

  app.get('/computer-actions/replay', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'replay computer actions');
    if (roleDenied) return roleDenied;

    const capability = getCapabilityRecord('computer_use');
    if (!capability) return c.json({ error: 'capability registry incomplete' }, 500);
    const taskId = c.req.query('taskId') || undefined;
    const rows = await deps.db
      .select()
      .from(computerActions)
      .where(
        taskId
          ? and(eq(computerActions.workspaceId, workspaceId), eq(computerActions.taskId, taskId))
          : eq(computerActions.workspaceId, workspaceId),
      )
      .orderBy(
        asc(computerActions.replayIndex),
        asc(computerActions.createdAt),
        asc(computerActions.id),
      )
      .limit(500);

    return c.json({
      replay: {
        kind: 'computer_action_sequence',
        workspaceId,
        taskId: taskId ?? null,
        orderedBy: ['replayIndex', 'createdAt', 'id'],
        capability: {
          key: capability.key,
          state: capability.state,
          productionReady: capability.state === 'production_ready',
        },
        redactionContract: 'bounded_stdout_stderr_and_file_diff_previews_no_secret_metadata',
        actions: rows.map((action) => ({
          id: action.id,
          taskId: action.taskId,
          toolActionId: action.toolActionId,
          operatorId: action.operatorId,
          actionType: action.actionType,
          environment: action.environment,
          objective: action.objective,
          status: action.status,
          cwd: action.cwd,
          command: action.command,
          args: action.args,
          filePath: action.filePath,
          devServerUrl: action.devServerUrl,
          stdoutPreview: previewText(action.stdout),
          stderrPreview: previewText(action.stderr),
          exitCode: action.exitCode,
          durationMs: action.durationMs,
          fileDiffPreview: previewText(action.fileDiff),
          outputHash: action.outputHash,
          policyDecisionId: action.policyDecisionId,
          policyVersion: action.policyVersion,
          evidencePackId: action.evidencePackId,
          replayIndex: action.replayIndex,
          createdAt: action.createdAt,
          completedAt: action.completedAt,
          metadata: redactReplayMetadata(action.metadata),
        })),
      },
    });
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

  app.get('/replay', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view command-center replay');
    if (roleDenied) return roleDenied;

    const replayRef = c.req.query('ref')?.trim();
    if (!replayRef) return c.json({ error: 'replay ref required' }, 400);

    const capability = getCapabilityRecord('evidence_ledger');
    if (!capability) return c.json({ error: 'capability registry incomplete' }, 500);

    const evidenceItemRows = await deps.db
      .select()
      .from(evidenceItems)
      .where(and(eq(evidenceItems.workspaceId, workspaceId), eq(evidenceItems.replayRef, replayRef)))
      .orderBy(desc(evidenceItems.observedAt), desc(evidenceItems.id))
      .limit(50);

    const linkedBrowserObservationIds = uniqueStrings(
      evidenceItemRows.map((row) => stringField(row, 'browserObservationId')),
    );
    const linkedComputerActionIds = uniqueStrings(
      evidenceItemRows.map((row) => stringField(row, 'computerActionId')),
    );
    const parsedBrowserRef = parseBrowserReplayRef(replayRef);
    const parsedComputerRef = parseComputerReplayRef(replayRef);

    const browserObservationRows =
      linkedBrowserObservationIds.length > 0
        ? await deps.db
            .select()
            .from(browserObservations)
            .where(
              and(
                eq(browserObservations.workspaceId, workspaceId),
                inArray(browserObservations.id, linkedBrowserObservationIds),
              ),
            )
            .orderBy(asc(browserObservations.replayIndex), asc(browserObservations.observedAt))
            .limit(50)
        : parsedBrowserRef
          ? await deps.db
              .select()
              .from(browserObservations)
              .where(
                and(
                  eq(browserObservations.workspaceId, workspaceId),
                  eq(browserObservations.sessionId, parsedBrowserRef.sessionId),
                  eq(browserObservations.replayIndex, parsedBrowserRef.replayIndex),
                ),
              )
              .orderBy(asc(browserObservations.replayIndex), asc(browserObservations.observedAt))
              .limit(50)
          : [];

    const computerActionRows =
      linkedComputerActionIds.length > 0
        ? await deps.db
            .select()
            .from(computerActions)
            .where(
              and(
                eq(computerActions.workspaceId, workspaceId),
                inArray(computerActions.id, linkedComputerActionIds),
              ),
            )
            .orderBy(asc(computerActions.replayIndex), asc(computerActions.createdAt))
            .limit(50)
        : parsedComputerRef
          ? await deps.db
              .select()
              .from(computerActions)
              .where(
                and(
                  eq(computerActions.workspaceId, workspaceId),
                  eq(computerActions.id, parsedComputerRef.actionId),
                  eq(computerActions.replayIndex, parsedComputerRef.replayIndex),
                ),
              )
              .orderBy(asc(computerActions.replayIndex), asc(computerActions.createdAt))
              .limit(50)
          : [];

    if (
      evidenceItemRows.length === 0 &&
      browserObservationRows.length === 0 &&
      computerActionRows.length === 0
    ) {
      return c.json({ error: 'Replay ref not found in workspace' }, 404);
    }

    const response = CommandCenterReplayResponseSchema.parse({
      workspaceId,
      replayRef,
      generatedAt: new Date().toISOString(),
      productionReady: false,
      capability,
      replay: {
        evidenceItems: evidenceItemRows.map(sanitizeGenericReplayRow),
        browserObservations: browserObservationRows.map(sanitizeGenericReplayRow),
        computerActions: computerActionRows.map(sanitizeComputerReplayRow),
      },
      blockers: [
        'Replay contract is implemented for workspace-scoped inspection but has not passed Browser/Computer Replay Eval',
        'This route does not promote evidence_ledger, browser_execution, computer_use, or command_center to production_ready',
      ],
    });

    return c.json(response);
  });

  return app;
}

function parseBrowserReplayRef(replayRef: string): { sessionId: string; replayIndex: number } | null {
  const match = /^browser:([^:]+):(\d+)$/.exec(replayRef);
  if (!match) return null;
  return { sessionId: match[1]!, replayIndex: Number(match[2]) };
}

function parseComputerReplayRef(replayRef: string): { actionId: string; replayIndex: number } | null {
  const match = /^computer:([^:]+):(\d+)$/.exec(replayRef);
  if (!match) return null;
  return { actionId: match[1]!, replayIndex: Number(match[2]) };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function stringField(row: unknown, field: string): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = (row as Record<string, unknown>)[field];
  return typeof value === 'string' && value ? value : undefined;
}

function sanitizeGenericReplayRow(row: unknown): Record<string, unknown> {
  const record = row && typeof row === 'object' ? { ...(row as Record<string, unknown>) } : {};
  if ('metadata' in record) record['metadata'] = redactReplayMetadata(record['metadata']);
  if ('extractedData' in record) record['extractedData'] = redactReplayMetadata(record['extractedData']);
  return record;
}

function sanitizeComputerReplayRow(row: unknown): Record<string, unknown> {
  const record = sanitizeGenericReplayRow(row);
  record['stdout'] = previewText(typeof record['stdout'] === 'string' ? record['stdout'] : null);
  record['stderr'] = previewText(typeof record['stderr'] === 'string' ? record['stderr'] : null);
  record['fileDiff'] = previewText(typeof record['fileDiff'] === 'string' ? record['fileDiff'] : null);
  return record;
}

function previewText(value: string | null | undefined): string | null {
  if (!value) return null;
  const preview = value.length > 4_000 ? `${value.slice(0, 4_000)}...[truncated]` : value;
  return redactReplayText(preview);
}

function redactReplayMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReplayMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if (/password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie|session/iu.test(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, typeof child === 'string' ? redactReplayText(child) : redactReplayMetadata(child)];
    }),
  );
}

function redactReplayText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gu, '$1[REDACTED]')
    .replace(/\b(token|secret|password|cookie|session)=([^&\s]+)/giu, '$1=[REDACTED]');
}

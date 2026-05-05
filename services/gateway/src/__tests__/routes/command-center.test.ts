import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { commandCenterRoutes } from '../../routes/command-center.js';
import { createMockDeps, expectJson } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const wsHeader = { 'X-Workspace-Id': workspaceId };

function createCommandCenterDb(selectResults: unknown[][] = []) {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const chain = {
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(async () => selectResults.shift() ?? []),
          then: (resolve: (value: unknown[]) => void) => resolve(selectResults.shift() ?? []),
        };
        return chain;
      }),
    })),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(async () => [{ '?column?': 1 }]),
    _setResult: vi.fn(),
    _reset: vi.fn(),
  };
  return db;
}

function createApp(selectResults: unknown[][] = []) {
  const db = createCommandCenterDb(selectResults);
  const deps = createMockDeps({ db: db as never });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const id = c.req.header('X-Workspace-Id');
    if (id) c.set('workspaceId', id);
    c.set('workspaceRole', c.req.header('X-Workspace-Role') ?? 'owner');
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', commandCenterRoutes(deps));
  return {
    db,
    fetch(method: string, path: string, headers?: Record<string, string>) {
      return app.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
        }),
      );
    },
  };
}

describe('commandCenterRoutes', () => {
  it('requires workspace scope', async () => {
    const { fetch } = createApp();
    const res = await fetch('GET', '/');
    const body = await expectJson<{ error: string }>(res, 400);

    expect(body.error).toContain('workspaceId');
  });

  it('requires partner role to inspect command-center state', async () => {
    const { fetch, db } = createApp();
    const res = await fetch('GET', '/', {
      ...wsHeader,
      'X-Workspace-Role': 'member',
    });
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('partner');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('requires a replay ref for command-center replay lookup', async () => {
    const { fetch, db } = createApp();
    const res = await fetch('GET', '/replay', wsHeader);
    const body = await expectJson<{ error: string }>(res, 400);

    expect(body.error).toBe('replay ref required');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns workspace-scoped browser and computer replay rows without production promotion', async () => {
    const replayRef = 'browser:session-1:0';
    const { fetch } = createApp([
      [
        {
          id: 'ev-browser-1',
          workspaceId,
          evidenceType: 'browser_observation',
          sourceType: 'browser_operator',
          title: 'Browser observation',
          redactionState: 'redacted',
          replayRef,
          browserObservationId: 'obs-1',
          computerActionId: 'computer-1',
          observedAt: new Date('2026-05-05T09:00:00Z'),
        },
      ],
      [
        {
          id: 'obs-1',
          workspaceId,
          sessionId: 'session-1',
          url: 'https://www.ycombinator.com/account',
          title: 'YC Account',
          domHash: 'sha256:dom',
          screenshotHash: 'sha256:shot',
          redactedDomSnapshot: '<main>[redacted]</main>',
          extractedData: { applicantName: 'redacted' },
          redactions: ['token'],
          replayIndex: 0,
          observedAt: new Date('2026-05-05T09:00:00Z'),
        },
      ],
      [
        {
          id: 'computer-1',
          workspaceId,
          actionType: 'terminal_command',
          objective: 'Check local server',
          status: 'completed',
          command: 'curl',
          args: ['-I', 'http://localhost:3000'],
          stdout: 'HTTP/1.1 200 OK',
          replayIndex: 0,
          createdAt: new Date('2026-05-05T09:01:00Z'),
        },
      ],
    ]);

    const res = await fetch('GET', `/replay?ref=${encodeURIComponent(replayRef)}`, wsHeader);
    const body = await expectJson<{
      workspaceId: string;
      replayRef: string;
      productionReady: boolean;
      capability: { key: string; state: string };
      replay: {
        evidenceItems: Array<{ id: string; replayRef: string }>;
        browserObservations: Array<{ id: string; domHash: string; redactedDomSnapshot: string }>;
        computerActions: Array<{ id: string; actionType: string; stdout: string }>;
      };
      blockers: string[];
    }>(res, 200);

    expect(body.workspaceId).toBe(workspaceId);
    expect(body.replayRef).toBe(replayRef);
    expect(body.productionReady).toBe(false);
    expect(body.capability.key).toBe('evidence_ledger');
    expect(body.capability.state).toBe('prototype');
    expect(body.replay.evidenceItems[0]?.id).toBe('ev-browser-1');
    expect(body.replay.browserObservations[0]?.domHash).toBe('sha256:dom');
    expect(body.replay.browserObservations[0]?.redactedDomSnapshot).toContain('[redacted]');
    expect(body.replay.computerActions[0]?.stdout).toContain('200 OK');
    expect(body.blockers.join(' ')).toContain('does not promote');
  });

  it('returns 404 when replay ref has no workspace rows', async () => {
    const { fetch } = createApp([[], []]);
    const res = await fetch('GET', '/replay?ref=browser:missing:0', wsHeader);
    const body = await expectJson<{ error: string }>(res, 404);

    expect(body.error).toBe('Replay ref not found in workspace');
  });

  it('returns real durable rows and capability truth without production-ready inflation', async () => {
    const task = {
      id: 'task-1',
      workspaceId,
      title: 'Score opportunity',
      description: 'Evidence-backed score',
      mode: 'discover',
      status: 'running',
      createdAt: new Date('2026-05-05T08:00:00Z'),
      updatedAt: new Date('2026-05-05T09:00:00Z'),
    };
    const action = {
      id: 'action-1',
      workspaceId,
      actionKey: 'score_opportunity',
      actionType: 'tool',
      riskClass: 'medium',
      status: 'completed',
      policyDecisionId: 'dec-1',
      policyVersion: 'founder-ops-v1',
      startedAt: new Date('2026-05-05T09:01:00Z'),
    };
    const receipt = {
      id: 'ep-1',
      workspaceId,
      decisionId: 'dec-1',
      verdict: 'ALLOW',
      action: 'TOOL_USE',
      resource: 'score_opportunity',
      principal: `workspace:${workspaceId}`,
      policyVersion: 'founder-ops-v1',
      receivedAt: new Date('2026-05-05T09:02:00Z'),
    };
    const { fetch } = createApp([
      [task],
      [
        {
          id: 'run-1',
          taskId: 'task-1',
          status: 'completed',
          actionTool: 'score_opportunity',
          runSequence: 1,
          lineageKind: 'parent_action',
          startedAt: new Date('2026-05-05T09:00:00Z'),
        },
      ],
      [action],
      [
        {
          id: 'tool-1',
          workspaceId,
          actionId: 'action-1',
          toolKey: 'score_opportunity',
          status: 'completed',
          idempotencyKey: 'idem-1',
          inputHash: 'sha256:in',
          outputHash: 'sha256:out',
          evidenceIds: ['ep-1'],
          createdAt: new Date('2026-05-05T09:01:00Z'),
        },
      ],
      [receipt],
      [
        {
          id: 'ev-1',
          workspaceId,
          evidenceType: 'tool_receipt',
          sourceType: 'agent_loop',
          title: 'TOOL_USE ALLOW',
          redactionState: 'redacted',
          evidencePackId: 'ep-1',
          replayRef: 'helm:dec-1',
          observedAt: new Date('2026-05-05T09:02:30Z'),
        },
      ],
      [
        {
          id: 'approval-1',
          workspaceId,
          taskId: 'task-1',
          action: 'EXTERNAL_POST',
          status: 'pending',
          reason: 'Founder approval required',
          requestedAt: new Date('2026-05-05T09:03:00Z'),
        },
      ],
      [
        {
          id: 'audit-1',
          workspaceId,
          action: 'TOOL_EXECUTION_COMPLETED',
          actor: 'agent:opportunity_scout',
          verdict: 'allow',
          createdAt: new Date('2026-05-05T09:04:00Z'),
        },
      ],
      [
        {
          id: 'obs-1',
          workspaceId,
          url: 'https://www.ycombinator.com/account',
          title: 'YC Account',
          domHash: 'sha256:dom',
          redactions: ['token'],
          observedAt: new Date('2026-05-05T09:05:00Z'),
        },
      ],
      [
        {
          id: 'computer-1',
          workspaceId,
          actionType: 'terminal_command',
          command: 'git',
          status: 'completed',
          evidencePackId: 'ep-1',
          createdAt: new Date('2026-05-05T09:06:00Z'),
        },
      ],
      [
        {
          id: 'handoff-1',
          workspaceId,
          taskId: 'task-1',
          fromAgent: 'conductor',
          toAgent: 'opportunity_scout',
          status: 'completed',
          createdAt: new Date('2026-05-05T09:07:00Z'),
        },
      ],
      [
        {
          id: 'artifact-1',
          workspaceId,
          type: 'scorecard',
          name: 'Opportunity Score',
          storagePath: 'artifacts/opportunity-score.json',
          updatedAt: new Date('2026-05-05T09:08:00Z'),
        },
      ],
    ]);

    const res = await fetch('GET', '/', wsHeader);
    const body = await expectJson<{
      runtimeTruth: {
        productionReady: boolean;
        commandCenterState: string;
        missionRuntimeState: string;
        statement: string;
      };
      authorization: { workspaceRole: string; requiredRole: string; workspaceId: string };
      capabilities: {
        summary: { productionReady: number };
        records: Array<{ key: string; state: string }>;
      };
      status: {
        activeTasks: number;
        pendingApprovals: number;
        recentEvidence: number;
        evidenceItems: number;
      };
      recent: {
        tasks: Array<{ id: string; title: string }>;
        actions: Array<{ id: string; policyDecisionId: string }>;
        evidencePacks: Array<{ id: string; decisionId: string }>;
        evidenceItems: Array<{ id: string; evidenceType: string; replayRef: string }>;
        browserObservations: Array<{ id: string; domHash: string }>;
        computerActions: Array<{ id: string; actionType: string }>;
      };
    }>(res, 200);

    expect(body.runtimeTruth.productionReady).toBe(false);
    expect(body.runtimeTruth.commandCenterState).toBe('prototype');
    expect(body.runtimeTruth.missionRuntimeState).toBe('blocked');
    expect(body.runtimeTruth.statement).toContain('without claiming mission autonomy');
    expect(body.authorization).toEqual({
      workspaceRole: 'owner',
      requiredRole: 'partner',
      workspaceId,
    });
    expect(body.capabilities.summary.productionReady).toBe(0);
    expect(body.capabilities.records.find((record) => record.key === 'command_center')?.state).toBe(
      'prototype',
    );
    expect(body.status.activeTasks).toBe(1);
    expect(body.status.pendingApprovals).toBe(1);
    expect(body.status.recentEvidence).toBe(1);
    expect(body.status.evidenceItems).toBe(1);
    expect(body.recent.tasks[0]?.title).toBe('Score opportunity');
    expect(body.recent.actions[0]?.policyDecisionId).toBe('dec-1');
    expect(body.recent.evidencePacks[0]?.decisionId).toBe('dec-1');
    expect(body.recent.evidenceItems[0]?.replayRef).toBe('helm:dec-1');
    expect(body.recent.browserObservations[0]?.domHash).toBe('sha256:dom');
    expect(body.recent.computerActions[0]?.actionType).toBe('terminal_command');
  });

  it('returns bounded computer action replay without secret metadata or production promotion', async () => {
    const longOutput = `token=abc ${'x'.repeat(4_010)}`;
    const { fetch } = createApp([
      [
        {
          id: 'computer-1',
          workspaceId,
          taskId: 'task-1',
          toolActionId: 'action-1',
          operatorId: 'operator-1',
          actionType: 'terminal_command',
          environment: 'local',
          objective: 'Check repository',
          status: 'completed',
          cwd: '/repo',
          command: 'npm',
          args: ['test'],
          filePath: null,
          devServerUrl: null,
          stdout: longOutput,
          stderr: 'warning only',
          exitCode: 0,
          durationMs: 123,
          fileDiff: 'diff --git a/file b/file',
          outputHash: 'sha256:out',
          policyDecisionId: 'dec-computer',
          policyVersion: 'founder-ops-v1',
          evidencePackId: 'ep-1',
          replayIndex: 2,
          createdAt: new Date('2026-05-05T10:00:00Z'),
          completedAt: new Date('2026-05-05T10:00:01Z'),
          metadata: {
            token: 'do-not-return',
            nested: { authorization: 'Bearer abc123', note: 'safe' },
          },
        },
      ],
    ]);

    const res = await fetch('GET', '/computer-actions/replay?taskId=task-1', wsHeader);
    const body = await expectJson<{
      replay: {
        kind: string;
        taskId: string;
        orderedBy: string[];
        capability: { key: string; state: string; productionReady: boolean };
        redactionContract: string;
        actions: Array<{
          id: string;
          replayIndex: number;
          stdoutPreview: string;
          metadata: Record<string, unknown>;
        }>;
      };
    }>(res, 200);

    expect(body.replay.kind).toBe('computer_action_sequence');
    expect(body.replay.taskId).toBe('task-1');
    expect(body.replay.orderedBy).toEqual(['replayIndex', 'createdAt', 'id']);
    expect(body.replay.capability).toEqual({
      key: 'computer_use',
      state: 'prototype',
      productionReady: false,
    });
    expect(body.replay.redactionContract).toContain('bounded_stdout_stderr');
    expect(body.replay.actions[0]).toMatchObject({
      id: 'computer-1',
      replayIndex: 2,
      metadata: {
        token: '[REDACTED]',
        nested: { authorization: '[REDACTED]', note: 'safe' },
      },
    });
    expect(body.replay.actions[0]?.stdoutPreview).toContain('[truncated]');
    expect(body.replay.actions[0]?.stdoutPreview).toContain('token=[REDACTED]');
    expect(JSON.stringify(body)).not.toContain('do-not-return');
    expect(JSON.stringify(body)).not.toContain('token=abc');
    expect(JSON.stringify(body)).not.toContain('Bearer abc123');
  });

  it('returns a workspace-scoped subagent proof DAG without production promotion', async () => {
    const rootTaskRunId = '00000000-0000-4000-8000-000000000101';
    const spawnTaskRunId = '00000000-0000-4000-8000-000000000102';
    const childTaskRunId = '00000000-0000-4000-8000-000000000103';
    const { fetch } = createApp([
      [
        {
          id: rootTaskRunId,
          taskId: 'task-1',
          status: 'completed',
          lineageKind: 'parent_action',
          startedAt: new Date('2026-05-05T09:00:00Z'),
        },
      ],
      [{ id: 'task-1' }],
      [
        {
          id: rootTaskRunId,
          taskId: 'task-1',
          status: 'completed',
          lineageKind: 'parent_action',
          startedAt: new Date('2026-05-05T09:00:00Z'),
        },
        {
          id: spawnTaskRunId,
          taskId: 'task-1',
          status: 'running',
          actionTool: 'subagent.spawn',
          parentTaskRunId: rootTaskRunId,
          rootTaskRunId,
          spawnedByActionId: rootTaskRunId,
          lineageKind: 'subagent_spawn',
          startedAt: new Date('2026-05-05T09:01:00Z'),
        },
        {
          id: childTaskRunId,
          taskId: 'task-1',
          status: 'completed',
          actionTool: 'finish',
          parentTaskRunId: spawnTaskRunId,
          rootTaskRunId,
          spawnedByActionId: spawnTaskRunId,
          lineageKind: 'subagent_action',
          startedAt: new Date('2026-05-05T09:02:00Z'),
        },
      ],
      [
        {
          id: 'handoff-1',
          workspaceId,
          taskId: 'task-1',
          parentTaskRunId: rootTaskRunId,
          childTaskRunId: spawnTaskRunId,
          fromAgent: 'conductor',
          toAgent: 'opportunity_scout',
          status: 'completed',
          createdAt: new Date('2026-05-05T09:01:00Z'),
        },
      ],
      [
        {
          id: 'ep-spawn',
          workspaceId,
          taskRunId: spawnTaskRunId,
          decisionId: 'local_spawn_1',
          verdict: 'ALLOW',
          policyVersion: 'founder-ops-v1',
          action: 'SUBAGENT_SPAWN',
          resource: 'opportunity_scout',
          principal: `workspace:${workspaceId}/operator:growth/subagent:opportunity_scout:abc123`,
          receivedAt: new Date('2026-05-05T09:01:00Z'),
        },
      ],
    ]);

    const res = await fetch('GET', `/proof-dag/${rootTaskRunId}`, wsHeader);
    const body = await expectJson<{
      workspaceId: string;
      rootTaskRunId: string;
      productionReady: boolean;
      capability: { key: string; state: string };
      dag: {
        taskRuns: Array<{ id: string; lineageKind: string; spawnedByActionId?: string }>;
        agentHandoffs: Array<{ childTaskRunId: string }>;
        evidencePacks: Array<{ taskRunId: string; action: string }>;
      };
      blockers: string[];
    }>(res, 200);

    expect(body.workspaceId).toBe(workspaceId);
    expect(body.rootTaskRunId).toBe(rootTaskRunId);
    expect(body.productionReady).toBe(false);
    expect(body.capability).toMatchObject({ key: 'subagent_lineage', state: 'implemented' });
    expect(body.dag.taskRuns.map((run) => run.lineageKind)).toEqual([
      'parent_action',
      'subagent_spawn',
      'subagent_action',
    ]);
    expect(body.dag.taskRuns.find((run) => run.id === childTaskRunId)?.spawnedByActionId).toBe(
      spawnTaskRunId,
    );
    expect(body.dag.agentHandoffs[0]?.childTaskRunId).toBe(spawnTaskRunId);
    expect(body.dag.evidencePacks[0]).toMatchObject({
      taskRunId: spawnTaskRunId,
      action: 'SUBAGENT_SPAWN',
    });
    expect(body.blockers.join(' ')).toContain('has not passed Proof DAG Lineage Regression');
  });
});

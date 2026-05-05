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
      status: { activeTasks: number; pendingApprovals: number; recentEvidence: number };
      recent: {
        tasks: Array<{ id: string; title: string }>;
        actions: Array<{ id: string; policyDecisionId: string }>;
        evidencePacks: Array<{ id: string; decisionId: string }>;
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
    expect(body.recent.tasks[0]?.title).toBe('Score opportunity');
    expect(body.recent.actions[0]?.policyDecisionId).toBe('dec-1');
    expect(body.recent.evidencePacks[0]?.decisionId).toBe('dec-1');
    expect(body.recent.browserObservations[0]?.domHash).toBe('sha256:dom');
    expect(body.recent.computerActions[0]?.actionType).toBe('terminal_command');
  });
});

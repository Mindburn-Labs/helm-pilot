import { describe, expect, it, vi } from 'vitest';
import { startupLifecycleRoutes } from '../../routes/startup-lifecycle.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const wsHeader = { 'X-Workspace-Id': workspaceId };

describe('startupLifecycleRoutes', () => {
  it('requires workspace scope', async () => {
    const { fetch } = testApp(startupLifecycleRoutes, createMockDeps());
    const res = await fetch('GET', '/templates');
    const body = await expectJson<{ error: string }>(res, 400);

    expect(body.error).toContain('workspaceId');
  });

  it('requires partner role to compile lifecycle missions', async () => {
    const { fetch } = testApp(startupLifecycleRoutes, createMockDeps());
    const res = await fetch(
      'POST',
      '/compile',
      {
        founderGoal: 'Build an AI finance operations assistant for small agencies.',
      },
      {
        ...wsHeader,
        'X-Workspace-Role': 'member',
      },
    );
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('partner');
  });

  it('rejects mismatched workspace ids', async () => {
    const { fetch } = testApp(startupLifecycleRoutes, createMockDeps());
    const res = await fetch(
      'POST',
      '/compile',
      {
        workspaceId: '00000000-0000-4000-8000-000000000099',
        founderGoal: 'Build an AI finance operations assistant for small agencies.',
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 403);

    expect(body.error).toContain('workspaceId');
  });

  it('compiles a founder goal into a non-production lifecycle DAG', async () => {
    const { fetch } = testApp(startupLifecycleRoutes, createMockDeps());
    const res = await fetch(
      'POST',
      '/compile',
      {
        founderGoal:
          'Build and launch a HELM-governed AI product for startup operators who need reliable weekly execution.',
        ventureContext: 'Founder has GitHub, Cloudflare, Stripe, and PostHog access.',
        constraints: ['No public launches without founder approval'],
        autonomyMode: 'review',
      },
      wsHeader,
    );
    const body = await expectJson<{
      workspaceId: string;
      capabilityState: string;
      productionReady: boolean;
      mission: {
        status: string;
        nodes: Array<{
          stage: string;
          requiredAgents: string[];
          requiredSkills: string[];
          requiredTools: string[];
          requiredEvidence: string[];
          helmPolicyClasses: string[];
          escalationConditions: string[];
          acceptanceCriteria: string[];
        }>;
        edges: Array<{ from: string; to: string }>;
        blockers: string[];
      };
    }>(res, 200);

    expect(body.workspaceId).toBe(workspaceId);
    expect(body.capabilityState).toBe('prototype');
    expect(body.productionReady).toBe(false);
    expect(body.mission.status).toBe('compiled_not_persisted');
    expect(body.mission.nodes.map((node) => node.stage)).toContain('company_formation_prep');
    expect(body.mission.nodes.map((node) => node.stage)).toContain('growth_experiments');
    expect(body.mission.edges.length).toBeGreaterThan(0);
    expect(body.mission.blockers.join(' ')).toContain('Mission DAG');

    const formation = body.mission.nodes.find((node) => node.stage === 'company_formation_prep');
    expect(formation?.helmPolicyClasses).toContain('legal');
    expect(formation?.escalationConditions.join(' ')).toMatch(/Signature|filing|payment/i);

    for (const node of body.mission.nodes) {
      expect(node.requiredAgents.length).toBeGreaterThan(0);
      expect(node.requiredSkills.length).toBeGreaterThan(0);
      expect(node.requiredTools.length).toBeGreaterThan(0);
      expect(node.requiredEvidence.length).toBeGreaterThan(0);
      expect(node.helmPolicyClasses.length).toBeGreaterThan(0);
      expect(node.acceptanceCriteria.length).toBeGreaterThan(0);
    }
  });

  it('exposes templates with capability truth', async () => {
    const { fetch } = testApp(startupLifecycleRoutes, createMockDeps());
    const res = await fetch('GET', '/templates', undefined, wsHeader);
    const body = await expectJson<{
      workspaceId: string;
      capability: { key: string; state: string };
      templates: Array<{ stage: string; requiredEvidence: string[] }>;
    }>(res, 200);

    expect(body.workspaceId).toBe(workspaceId);
    expect(body.capability.key).toBe('startup_lifecycle');
    expect(body.capability.state).toBe('prototype');
    expect(body.templates.map((node) => node.stage)).toContain('pmf_discovery');
    expect(body.templates[0]?.requiredEvidence.length).toBeGreaterThan(0);
  });

  it('persists a lifecycle DAG as durable mission runtime without starting execution', async () => {
    const deps = createMockDeps();
    deps.db._setResult([{ id: '00000000-0000-4000-8000-000000000010' }]);
    const { fetch } = testApp(startupLifecycleRoutes, deps);
    const res = await fetch(
      'POST',
      '/persist',
      {
        ventureName: 'EvidenceOS',
        founderGoal:
          'Build and launch a governed evidence automation product for startup founders.',
        ventureContext: 'Founder has GitHub and Cloudflare access.',
        constraints: ['No external sends without review'],
        autonomyMode: 'review',
      },
      wsHeader,
    );
    const body = await expectJson<{
      workspaceId: string;
      capabilityState: string;
      productionReady: boolean;
      persisted: {
        ventureId: string;
        goalId: string;
        missionId: string;
        nodeCount: number;
        edgeCount: number;
        taskCount: number;
      };
      mission: {
        status: string;
        blockers: string[];
      };
    }>(res, 201);

    expect(body.workspaceId).toBe(workspaceId);
    expect(body.capabilityState).toBe('prototype');
    expect(body.productionReady).toBe(false);
    expect(body.mission.status).toBe('persisted_not_executing');
    expect(body.persisted.ventureId).toBe('00000000-0000-4000-8000-000000000010');
    expect(body.persisted.nodeCount).toBeGreaterThan(10);
    expect(body.persisted.edgeCount).toBeGreaterThan(0);
    expect(body.persisted.taskCount).toBe(body.persisted.nodeCount);
    expect(body.mission.blockers.join(' ')).toContain('not executing through the runtime');
    expect(body.mission.blockers.join(' ')).not.toContain('not persisted');
  });

  it('schedules ready mission nodes without dispatching autonomous execution', async () => {
    const deps = createMockDeps();
    const missionId = '00000000-0000-4000-8000-000000000020';
    const founderNodeId = '00000000-0000-4000-8000-000000000021';
    const ideationNodeId = '00000000-0000-4000-8000-000000000022';
    const operationsNodeId = '00000000-0000-4000-8000-000000000026';
    const founderTaskId = '00000000-0000-4000-8000-000000000023';
    const selectResults = [
      [{ id: missionId, workspaceId, status: 'persisted_not_executing' }],
      [
        {
          id: founderNodeId,
          workspaceId,
          missionId,
          nodeKey: 'founder_onboarding',
          stage: 'founder_onboarding',
          title: 'Founder DNA and access charter',
          status: 'pending',
        },
        {
          id: ideationNodeId,
          workspaceId,
          missionId,
          nodeKey: 'ideation',
          stage: 'ideation',
          title: 'Venture hypothesis generation',
          status: 'pending',
        },
        {
          id: operationsNodeId,
          workspaceId,
          missionId,
          nodeKey: 'operations_recovery',
          stage: 'operations_recovery',
          title: 'Operations, monitoring, and recovery',
          status: 'pending',
        },
      ],
      [
        {
          id: '00000000-0000-4000-8000-000000000024',
          workspaceId,
          missionId,
          edgeKey: 'founder_onboarding->ideation',
          fromNodeKey: 'founder_onboarding',
          toNodeKey: 'ideation',
          reason: 'Ideation depends on founder onboarding',
        },
      ],
      [
        {
          id: '00000000-0000-4000-8000-000000000025',
          workspaceId,
          missionId,
          nodeId: founderNodeId,
          taskId: founderTaskId,
        },
      ],
    ];
    let selectCall = 0;
    const originalSelect = deps.db.select;
    deps.db.select = vi.fn(() => {
      deps.db._setResult(selectResults[selectCall] ?? []);
      selectCall += 1;
      return originalSelect();
    }) as typeof deps.db.select;

    const { fetch } = testApp(startupLifecycleRoutes, deps);
    const res = await fetch('POST', `/missions/${missionId}/schedule`, { maxNodes: 1 }, wsHeader);
    const body = await expectJson<{
      status: string;
      productionReady: boolean;
      readyNodes: Array<{ nodeKey: string; taskId?: string; waitingOn: string[] }>;
      blockedNodes: Array<{ nodeKey: string; waitingOn: string[] }>;
      queuedTaskIds: string[];
      executionStarted: boolean;
      blockers: string[];
    }>(res, 200);

    expect(body.status).toBe('scheduled_not_executing');
    expect(body.productionReady).toBe(false);
    expect(body.readyNodes).toEqual([
      expect.objectContaining({
        nodeKey: 'founder_onboarding',
        taskId: founderTaskId,
        waitingOn: [],
      }),
    ]);
    expect(body.blockedNodes).toEqual([
      expect.objectContaining({ nodeKey: 'ideation', waitingOn: ['founder_onboarding'] }),
      expect.objectContaining({
        nodeKey: 'operations_recovery',
        waitingOn: ['scheduler_batch_limit'],
      }),
    ]);
    expect(body.queuedTaskIds).toEqual([founderTaskId]);
    expect(body.executionStarted).toBe(false);
    expect(body.blockers.join(' ')).toContain('does not dispatch autonomous execution');
    expect(deps.orchestrator.runTask).not.toHaveBeenCalled();
  });

  it('executes a ready mission node through the governed task runtime without production promotion', async () => {
    const deps = createMockDeps();
    const missionId = '00000000-0000-4000-8000-000000000030';
    const ventureId = '00000000-0000-4000-8000-000000000031';
    const nodeId = '00000000-0000-4000-8000-000000000032';
    const taskId = '00000000-0000-4000-8000-000000000033';
    const operatorId = '00000000-0000-4000-8000-000000000034';
    const selectResults = [
      [
        {
          id: missionId,
          workspaceId,
          ventureId,
          title: 'Launch EvidenceOS',
          status: 'scheduled_not_executing',
          startedAt: null,
        },
      ],
      [
        {
          id: nodeId,
          workspaceId,
          missionId,
          nodeKey: 'founder_onboarding',
          stage: 'founder_onboarding',
          title: 'Founder DNA and access charter',
          objective: 'Draft founder DNA and access boundaries.',
          status: 'ready',
          requiredEvidence: ['founder goal intake'],
          acceptanceCriteria: ['Founder DNA draft exists'],
          helmPolicyClasses: ['access', 'audit'],
        },
      ],
      [
        {
          id: '00000000-0000-4000-8000-000000000035',
          workspaceId,
          missionId,
          nodeId,
          taskId,
        },
      ],
      [
        {
          id: taskId,
          workspaceId,
          operatorId,
          title: '[Lifecycle] Founder DNA and access charter',
          description: 'Draft founder DNA and access boundaries.',
          status: 'pending',
        },
      ],
    ];
    let selectCall = 0;
    const originalSelect = deps.db.select;
    deps.db.select = vi.fn(() => {
      deps.db._setResult(selectResults[selectCall] ?? []);
      selectCall += 1;
      return originalSelect();
    }) as typeof deps.db.select;

    const { fetch } = testApp(startupLifecycleRoutes, deps);
    const res = await fetch(
      'POST',
      `/missions/${missionId}/nodes/${nodeId}/execute`,
      { iterationBudget: 3 },
      wsHeader,
    );
    const body = await expectJson<{
      missionId: string;
      nodeId: string;
      taskId: string;
      productionReady: boolean;
      executionStarted: boolean;
      status: string;
      run: { status: string; iterationsUsed: number; iterationBudget: number; actionCount: number };
      blockers: string[];
    }>(res, 200);

    expect(body.missionId).toBe(missionId);
    expect(body.nodeId).toBe(nodeId);
    expect(body.taskId).toBe(taskId);
    expect(body.productionReady).toBe(false);
    expect(body.executionStarted).toBe(true);
    expect(body.status).toBe('completed');
    expect(body.run).toMatchObject({
      status: 'completed',
      iterationsUsed: 1,
      iterationBudget: 50,
      actionCount: 0,
    });
    expect(body.blockers.join(' ')).toContain('has not passed Full Startup Launch Eval');
    expect(deps.orchestrator.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId,
        workspaceId,
        ventureId,
        missionId,
        operatorId,
        iterationBudget: 3,
      }),
    );
  });

  it('refuses to execute mission nodes that have not been scheduled ready', async () => {
    const deps = createMockDeps();
    const missionId = '00000000-0000-4000-8000-000000000040';
    const nodeId = '00000000-0000-4000-8000-000000000041';
    const selectResults = [
      [
        {
          id: missionId,
          workspaceId,
          ventureId: null,
          title: 'Launch EvidenceOS',
          status: 'persisted_not_executing',
          startedAt: null,
        },
      ],
      [
        {
          id: nodeId,
          workspaceId,
          missionId,
          nodeKey: 'ideation',
          stage: 'ideation',
          title: 'Venture hypothesis generation',
          objective: 'Generate venture hypotheses.',
          status: 'pending',
          requiredEvidence: ['idea scoring evidence'],
          acceptanceCriteria: ['At least one venture hypothesis exists'],
          helmPolicyClasses: ['data_handling', 'audit'],
        },
      ],
    ];
    let selectCall = 0;
    const originalSelect = deps.db.select;
    deps.db.select = vi.fn(() => {
      deps.db._setResult(selectResults[selectCall] ?? []);
      selectCall += 1;
      return originalSelect();
    }) as typeof deps.db.select;

    const { fetch } = testApp(startupLifecycleRoutes, deps);
    const res = await fetch('POST', `/missions/${missionId}/nodes/${nodeId}/execute`, {}, wsHeader);
    const body = await expectJson<{ error: string; nodeStatus: string; requiredStatus: string }>(
      res,
      409,
    );

    expect(body.error).toContain('not ready');
    expect(body.nodeStatus).toBe('pending');
    expect(body.requiredStatus).toBe('ready');
    expect(deps.orchestrator.runTask).not.toHaveBeenCalled();
  });

  it('marks mission node and task failed when execution throws', async () => {
    const deps = createMockDeps();
    const missionId = '00000000-0000-4000-8000-000000000050';
    const nodeId = '00000000-0000-4000-8000-000000000051';
    const taskId = '00000000-0000-4000-8000-000000000052';
    const selectResults = [
      [
        {
          id: missionId,
          workspaceId,
          ventureId: null,
          title: 'Launch EvidenceOS',
          status: 'scheduled_not_executing',
          startedAt: null,
        },
      ],
      [
        {
          id: nodeId,
          workspaceId,
          missionId,
          nodeKey: 'founder_onboarding',
          stage: 'founder_onboarding',
          title: 'Founder DNA and access charter',
          objective: 'Draft founder DNA and access boundaries.',
          status: 'ready',
          requiredEvidence: ['founder goal intake'],
          acceptanceCriteria: ['Founder DNA draft exists'],
          helmPolicyClasses: ['access', 'audit'],
        },
      ],
      [{ id: '00000000-0000-4000-8000-000000000053', workspaceId, missionId, nodeId, taskId }],
      [
        {
          id: taskId,
          workspaceId,
          operatorId: null,
          title: '[Lifecycle] Founder DNA and access charter',
          description: 'Draft founder DNA and access boundaries.',
          status: 'pending',
        },
      ],
    ];
    let selectCall = 0;
    const originalSelect = deps.db.select;
    deps.db.select = vi.fn(() => {
      deps.db._setResult(selectResults[selectCall] ?? []);
      selectCall += 1;
      return originalSelect();
    }) as typeof deps.db.select;
    const updates: Array<Record<string, unknown>> = [];
    deps.db.update = vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return { where: vi.fn(async () => []) };
      }),
    })) as unknown as typeof deps.db.update;
    deps.orchestrator.runTask = vi.fn(async () => {
      throw new Error('HELM unavailable');
    }) as typeof deps.orchestrator.runTask;

    const { fetch } = testApp(startupLifecycleRoutes, deps);
    const res = await fetch('POST', `/missions/${missionId}/nodes/${nodeId}/execute`, {}, wsHeader);
    const body = await expectJson<{ error: string; detail: string; productionReady: boolean }>(
      res,
      502,
    );

    expect(body.error).toContain('execution failed');
    expect(body.detail).toContain('HELM unavailable');
    expect(body.productionReady).toBe(false);
    expect(updates.filter((payload) => payload.status === 'failed')).toHaveLength(2);
  });
});

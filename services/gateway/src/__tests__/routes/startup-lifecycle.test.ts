import { describe, expect, it } from 'vitest';
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
});

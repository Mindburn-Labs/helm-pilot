import { Hono } from 'hono';
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
  PersistStartupLifecycleInputSchema,
  PersistedStartupLifecycleMissionSchema,
  compileStartupLifecycleMission,
  getStartupLifecycleTemplates,
} from '@pilot/shared/schemas';
import { getCapabilityRecord } from '@pilot/shared/capabilities';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole, workspaceIdMismatch } from '../lib/workspace.js';

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

    const response = PersistedStartupLifecycleMissionSchema.parse({
      ...compiled,
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

  return app;
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

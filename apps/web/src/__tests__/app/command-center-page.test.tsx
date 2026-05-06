import { render, screen, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CommandCenterPage from '../../app/command-center/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('CommandCenterPage', () => {
  it('renders real command-center API state and non-production capability labels', async () => {
    localStorage.setItem('helm_user', JSON.stringify({ id: 'user-1' }));
    localStorage.setItem('helm_workspace', JSON.stringify({ id: 'ws-1' }));
    const rootTaskRunId = '00000000-0000-4000-8000-000000000101';
    const spawnTaskRunId = '00000000-0000-4000-8000-000000000102';
    const childTaskRunId = '00000000-0000-4000-8000-000000000103';
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          workspaceId: 'ws-1',
          generatedAt: '2026-05-05T00:00:00.000Z',
          runtimeTruth: {
            productionReady: false,
            commandCenterState: 'prototype',
            missionRuntimeState: 'blocked',
            statement:
              'Mission runtime is not production_ready; command center exposes durable task, action, receipt, browser, computer, artifact, audit, and approval state without claiming mission autonomy.',
            blockers: ['Mission runtime is still blocked'],
          },
          authorization: {
            workspaceRole: 'owner',
            requiredRole: 'partner',
            workspaceId: 'ws-1',
          },
          capabilities: {
            summary: {
              generatedAt: '2026-05-05T00:00:00.000Z',
              total: 18,
              productionReady: 0,
              byState: {
                implemented: 8,
                prototype: 4,
                scaffolded: 0,
                stub: 0,
                blocked: 6,
                production_ready: 0,
              },
            },
            records: [
              {
                key: 'command_center',
                name: 'Command center UI',
                state: 'prototype',
                summary: 'Backed by real durable rows.',
                blockers: ['Mission runtime is still blocked'],
                evalRequirement: 'Command Center Real-State UX Eval',
              },
              {
                key: 'mission_runtime',
                name: 'Mission runtime',
                state: 'blocked',
                summary: 'Mission DAG is not the runtime backbone.',
                blockers: ['No mission compiler'],
                evalRequirement: 'Full Startup Launch Eval',
              },
              {
                key: 'workspace_rbac',
                name: 'Workspace RBAC',
                state: 'implemented',
                summary: 'Sensitive routes enforce workspace role checks.',
                blockers: ['Eval pending'],
                evalRequirement: 'HELM Governance Eval',
              },
              {
                key: 'operator_scoping',
                name: 'Operator ownership scoping',
                state: 'implemented',
                summary: 'Foreign workspace operator IDs are rejected.',
                blockers: ['Eval pending'],
                evalRequirement: 'Cross-workspace operator rejection regression',
              },
            ],
          },
          status: {
            activeTasks: 1,
            pendingApprovals: 1,
            recentActions: 1,
            recentEvidence: 1,
            evidenceItems: 1,
            recentArtifacts: 1,
            browserObservations: 1,
            computerActions: 1,
          },
          recent: {
            tasks: [
              {
                id: 'task-1',
                title: 'Score opportunity',
                description: 'Evidence-backed score',
                mode: 'discover',
                status: 'running',
              },
            ],
            taskRuns: [
              {
                id: rootTaskRunId,
                taskId: 'task-1',
                status: 'completed',
                actionTool: 'score_opportunity',
                lineageKind: 'parent_action',
              },
            ],
            actions: [
              {
                id: 'action-1',
                actionKey: 'score_opportunity',
                riskClass: 'medium',
                status: 'completed',
                policyDecisionId: 'dec-1',
              },
            ],
            toolExecutions: [
              {
                id: 'tool-1',
                toolKey: 'score_opportunity',
                status: 'completed',
                policyDecisionId: 'dec-1',
                idempotencyKey: 'idem-1',
              },
            ],
            evidencePacks: [
              {
                id: 'ep-1',
                decisionId: 'dec-1',
                verdict: 'ALLOW',
                policyVersion: 'founder-ops-v1',
                action: 'TOOL_USE',
                resource: 'score_opportunity',
              },
            ],
            evidenceItems: [
              {
                id: 'ev-1',
                evidenceType: 'tool_receipt',
                sourceType: 'agent_loop',
                title: 'TOOL_USE ALLOW',
                redactionState: 'redacted',
                replayRef: 'helm:dec-1',
              },
            ],
            approvals: [
              {
                id: 'approval-1',
                action: 'EXTERNAL_POST',
                status: 'pending',
                reason: 'Founder approval required',
              },
            ],
            auditEvents: [
              {
                id: 'audit-1',
                action: 'TOOL_EXECUTION_COMPLETED',
                actor: 'agent:opportunity_scout',
                verdict: 'allow',
              },
            ],
            browserObservations: [
              {
                id: 'obs-1',
                url: 'https://www.ycombinator.com/account',
                origin: 'https://www.ycombinator.com',
                title: 'YC Account',
                domHash: 'sha256:dom',
                redactions: ['token'],
                evidencePackId: 'ep-1',
                replayIndex: 0,
              },
            ],
            computerActions: [
              {
                id: 'computer-1',
                objective: 'Check dev server',
                actionType: 'dev_server_status',
                environment: 'local',
                status: 'completed',
                evidencePackId: 'ep-1',
                replayIndex: 0,
              },
            ],
            agentHandoffs: [
              {
                id: 'handoff-1',
                fromAgent: 'conductor',
                toAgent: 'opportunity_scout',
                status: 'completed',
                handoffKind: 'subagent_spawn',
                taskId: 'task-1',
              },
            ],
            artifacts: [
              {
                id: 'artifact-1',
                type: 'scorecard',
                name: 'Opportunity Score',
                currentVersion: 1,
                storagePath: 'artifacts/opportunity-score.json',
              },
            ],
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          workspaceId: 'ws-1',
          generatedAt: '2026-05-05T00:00:00.000Z',
          productionReady: false,
          capability: {
            key: 'command_center',
            name: 'Command center UI',
            state: 'prototype',
            summary: 'Backed by real durable rows.',
            blockers: ['Permission graph is read-only'],
            evalRequirement: 'Command Center Real-State UX Eval',
          },
          redactionContract: 'member user ids and raw policy values are withheld',
          graph: {
            nodes: [
              { id: 'workspace:ws-1', kind: 'workspace', label: 'Workspace', state: 'scoped' },
              {
                id: 'workspace-role:current',
                kind: 'workspace_role',
                label: 'Current role owner',
                state: 'allowed',
              },
              {
                id: 'required-role:partner',
                kind: 'required_role',
                label: 'Command center requires partner',
                state: 'allowed',
              },
              {
                id: 'operator:operator-1',
                kind: 'operator',
                label: 'Opportunity Scout',
                state: 'active',
              },
              {
                id: 'tool-scope:score_opportunity',
                kind: 'tool_scope',
                label: 'score_opportunity',
                state: 'configured',
              },
            ],
            edges: [
              {
                id: 'current-role-command-center',
                from: 'workspace-role:current',
                to: 'required-role:partner',
                relation: 'meets_required_role',
                status: 'allowed',
              },
              {
                id: 'operator-tool',
                from: 'operator:operator-1',
                to: 'tool-scope:score_opportunity',
                relation: 'declares_tool_scope',
                status: 'configured',
              },
            ],
          },
          blockers: ['Permission graph is read-only command-center introspection'],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          workspaceId: 'ws-1',
          generatedAt: '2026-05-05T00:00:00.000Z',
          productionReady: false,
          missionId: null,
          graph: {
            missions: [
              {
                id: 'mission-1',
                missionKey: 'pmf-discovery',
                title: 'PMF Discovery',
                status: 'scheduled',
                autonomyMode: 'review',
                capabilityState: 'prototype',
                productionReady: false,
              },
            ],
            nodes: [
              {
                id: 'node-1',
                nodeKey: 'research',
                stage: 'market_research',
                title: 'Research market',
                status: 'ready',
                requiredTools: ['score_opportunity'],
                requiredEvidence: ['citations'],
              },
            ],
            edges: [
              {
                id: 'edge-1',
                edgeKey: 'research-to-score',
                fromNodeKey: 'research',
                toNodeKey: 'score',
                reason: 'Evidence precedes scoring',
              },
            ],
            taskLinks: [{ id: 'mission-task-1', taskId: 'task-1', nodeId: 'node-1' }],
            orderedBy: ['mission.updatedAt', 'node.sortOrder'],
          },
          blockers: ['Mission graph is read-only command-center introspection'],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          workspaceId: 'ws-1',
          rootTaskRunId,
          generatedAt: '2026-05-05T00:00:00.000Z',
          productionReady: false,
          capability: {
            key: 'subagent_lineage',
            name: 'Subagent proof lineage',
            state: 'implemented',
            summary: 'Parent/spawn/child lineage is durable and inspectable.',
            blockers: ['Proof DAG Lineage Regression pending'],
            evalRequirement: 'Proof DAG Lineage Regression',
          },
          dag: {
            taskRuns: [
              {
                id: rootTaskRunId,
                status: 'completed',
                actionTool: 'score_opportunity',
                lineageKind: 'parent_action',
              },
              {
                id: spawnTaskRunId,
                status: 'completed',
                actionTool: 'subagent.spawn',
                lineageKind: 'subagent_spawn',
                parentTaskRunId: rootTaskRunId,
                spawnedByActionId: rootTaskRunId,
              },
              {
                id: childTaskRunId,
                status: 'completed',
                actionTool: 'finish',
                lineageKind: 'subagent_action',
                parentTaskRunId: spawnTaskRunId,
                spawnedByActionId: spawnTaskRunId,
              },
            ],
            agentHandoffs: [
              {
                id: 'handoff-1',
                fromAgent: 'conductor',
                toAgent: 'opportunity_scout',
                status: 'completed',
                handoffKind: 'subagent_spawn',
                parentTaskRunId: rootTaskRunId,
                childTaskRunId: spawnTaskRunId,
              },
            ],
            evidencePacks: [
              {
                id: 'ep-spawn',
                taskRunId: spawnTaskRunId,
                decisionId: 'local_spawn_1',
                verdict: 'ALLOW',
                policyVersion: 'founder-ops-v1',
                action: 'SUBAGENT_SPAWN',
              },
            ],
          },
          blockers: [
            'Proof DAG route is implemented for inspection but has not passed Proof DAG Lineage Regression',
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<CommandCenterPage />);

    expect(await screen.findByText('Agent Command Center')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Score opportunity')).toBeTruthy());

    expect(screen.getByText('0/18')).toBeTruthy();
    expect(screen.getAllByText('prototype').length).toBeGreaterThan(0);
    expect(screen.getAllByText('blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('dec-1').length).toBeGreaterThan(0);
    expect(screen.getByText('TOOL_USE ALLOW')).toBeTruthy();
    expect(screen.getByText('YC Account')).toBeTruthy();
    expect(screen.getByText('dev_server_status')).toBeTruthy();
    expect(screen.getByText('Opportunity Score')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('PMF Discovery')).toBeTruthy());
    expect(screen.getByText('Research market')).toBeTruthy();
    expect(screen.getByText('research -> score')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('Current role owner -> Command center requires partner')).toBeTruthy(),
    );
    expect(screen.getByText('Opportunity Scout -> score_opportunity')).toBeTruthy();
    expect(screen.getAllByText('Operator ownership scoping').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Subagent Proof DAG')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('SUBAGENT_SPAWN')).toBeTruthy());
    expect(screen.getAllByText('subagent_spawn').length).toBeGreaterThan(0);
    expect(screen.getByText(/Proof DAG route is implemented for inspection/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/command-center/proof-dag/${encodeURIComponent(rootTaskRunId)}`,
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/command-center/permission-graph',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/command-center/mission-graph',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(screen.queryByText('18/18')).toBeNull();
  });
});

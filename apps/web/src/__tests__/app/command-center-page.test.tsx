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
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
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
            taskRuns: [],
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
    );

    render(<CommandCenterPage />);

    expect(await screen.findByText('Agent Command Center')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Score opportunity')).toBeTruthy());

    expect(screen.getByText('0/18')).toBeTruthy();
    expect(screen.getAllByText('prototype').length).toBeGreaterThan(0);
    expect(screen.getAllByText('blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('dec-1').length).toBeGreaterThan(0);
    expect(screen.getByText('YC Account')).toBeTruthy();
    expect(screen.getByText('dev_server_status')).toBeTruthy();
    expect(screen.getByText('Opportunity Score')).toBeTruthy();
    expect(screen.getByText('Workspace role owner')).toBeTruthy();
    expect(screen.getAllByText('Operator ownership scoping').length).toBeGreaterThan(0);
    expect(screen.queryByText('18/18')).toBeNull();
  });
});

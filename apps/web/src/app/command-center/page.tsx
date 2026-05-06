'use client';

import React, { type CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, isAuthenticated } from '../../lib/api';

type CapabilityState =
  | 'implemented'
  | 'prototype'
  | 'scaffolded'
  | 'stub'
  | 'blocked'
  | 'production_ready';

interface CapabilityRecord {
  key: string;
  name: string;
  state: CapabilityState;
  summary: string;
  blockers: string[];
  evalRequirement: string;
}

type DurableRow = Record<string, unknown>;

interface CommandCenterResponse {
  workspaceId: string;
  generatedAt: string;
  runtimeTruth: {
    productionReady: boolean;
    commandCenterState: CapabilityState;
    missionRuntimeState: CapabilityState;
    statement: string;
    blockers: string[];
  };
  authorization: {
    workspaceRole: string | null;
    requiredRole: 'partner';
    workspaceId: string;
  };
  capabilities: {
    summary: {
      total: number;
      productionReady: number;
      byState: Record<CapabilityState, number>;
    };
    records: CapabilityRecord[];
  };
  status: {
    activeTasks: number;
    pendingApprovals: number;
    recentActions: number;
    recentEvidence: number;
    evidenceItems: number;
    recentArtifacts: number;
    browserObservations: number;
    computerActions: number;
  };
  recent: {
    tasks: DurableRow[];
    taskRuns: DurableRow[];
    actions: DurableRow[];
    toolExecutions: DurableRow[];
    evidencePacks: DurableRow[];
    evidenceItems: DurableRow[];
    approvals: DurableRow[];
    auditEvents: DurableRow[];
    browserObservations: DurableRow[];
    computerActions: DurableRow[];
    agentHandoffs: DurableRow[];
    artifacts: DurableRow[];
  };
}

interface CommandCenterProofDagResponse {
  workspaceId: string;
  rootTaskRunId: string;
  generatedAt: string;
  productionReady: false;
  capability: CapabilityRecord;
  dag: {
    taskRuns: DurableRow[];
    agentHandoffs: DurableRow[];
    evidencePacks: DurableRow[];
  };
  blockers: string[];
}

interface CommandCenterPermissionGraphResponse {
  workspaceId: string;
  generatedAt: string;
  productionReady: false;
  redactionContract: string;
  graph: {
    nodes: Array<{
      id: string;
      kind: string;
      label: string;
      state?: string;
      metadata?: DurableRow;
    }>;
    edges: Array<{
      id: string;
      from: string;
      to: string;
      relation: string;
      status: string;
      reason?: string;
    }>;
  };
  blockers: string[];
}

interface CommandCenterMissionGraphResponse {
  workspaceId: string;
  generatedAt: string;
  productionReady: false;
  missionId: string | null;
  graph: {
    missions: DurableRow[];
    nodes: DurableRow[];
    edges: DurableRow[];
    taskLinks: DurableRow[];
    orderedBy: string[];
  };
  blockers: string[];
}

const navItems = [
  { label: 'Command', href: '/command-center' },
  { label: 'Ventures', href: '/discover' },
  { label: 'Missions', href: '/command-center' },
  { label: 'Agents', href: '/workspace-agents' },
  { label: 'Browser/Computer', href: '/command-center#sessions' },
  { label: 'Artifacts', href: '/command-center#artifacts' },
  { label: 'Evidence', href: '/command-center#evidence' },
  { label: 'Growth', href: '/launch' },
  { label: 'Build', href: '/build' },
  { label: 'Company', href: '/applications' },
  { label: 'Integrations', href: '/settings' },
  { label: 'Governance', href: '/governance' },
  { label: 'Memory', href: '/knowledge' },
  { label: 'Admin', href: '/settings' },
];

const stateOrder: CapabilityState[] = [
  'production_ready',
  'implemented',
  'prototype',
  'scaffolded',
  'stub',
  'blocked',
];

export default function CommandCenterPage() {
  const [data, setData] = useState<CommandCenterResponse | null>(null);
  const [selectedProofDagRunId, setSelectedProofDagRunId] = useState<string | null>(null);
  const [proofDag, setProofDag] = useState<CommandCenterProofDagResponse | null>(null);
  const [proofDagError, setProofDagError] = useState<string | null>(null);
  const [proofDagLoading, setProofDagLoading] = useState(false);
  const [permissionGraph, setPermissionGraph] =
    useState<CommandCenterPermissionGraphResponse | null>(null);
  const [permissionGraphError, setPermissionGraphError] = useState<string | null>(null);
  const [missionGraph, setMissionGraph] = useState<CommandCenterMissionGraphResponse | null>(null);
  const [missionGraphError, setMissionGraphError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isNarrow = useNarrowViewport(760);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/login';
      return;
    }

    apiFetch<CommandCenterResponse>('/api/command-center')
      .then((response) => {
        if (!response) {
          setError('Command-center state unavailable.');
          return;
        }
        setData(response);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) return;

    let cancelled = false;
    apiFetch<CommandCenterPermissionGraphResponse>('/api/command-center/permission-graph')
      .then((response) => {
        if (cancelled) return;
        if (!response) {
          setPermissionGraphError('Permission graph unavailable.');
          return;
        }
        setPermissionGraph(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPermissionGraphError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) return;

    let cancelled = false;
    apiFetch<CommandCenterMissionGraphResponse>('/api/command-center/mission-graph')
      .then((response) => {
        if (cancelled) return;
        if (!response) {
          setMissionGraphError('Mission graph unavailable.');
          return;
        }
        setMissionGraph(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMissionGraphError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data || selectedProofDagRunId) return;
    const firstRunId = data.recent.taskRuns
      .map((row) => row.id)
      .find((id): id is string => typeof id === 'string' && id.length > 0);
    if (firstRunId) setSelectedProofDagRunId(firstRunId);
  }, [data, selectedProofDagRunId]);

  useEffect(() => {
    if (!selectedProofDagRunId) {
      setProofDag(null);
      return;
    }

    let cancelled = false;
    setProofDagLoading(true);
    setProofDagError(null);

    apiFetch<CommandCenterProofDagResponse>(
      `/api/command-center/proof-dag/${encodeURIComponent(selectedProofDagRunId)}`,
    )
      .then((response) => {
        if (cancelled) return;
        if (!response) {
          setProofDag(null);
          setProofDagError('Proof DAG unavailable for the selected run.');
          return;
        }
        setProofDag(response);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProofDag(null);
        setProofDagError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setProofDagLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProofDagRunId]);

  const capabilities = useMemo(() => {
    return [...(data?.capabilities.records ?? [])].sort((a, b) => {
      const stateDelta = stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state);
      return stateDelta === 0 ? a.key.localeCompare(b.key) : stateDelta;
    });
  }, [data]);

  const proofDagCandidates = useMemo(() => {
    return (data?.recent.taskRuns ?? [])
      .map((row) => ({
        id: typeof row.id === 'string' ? row.id : '',
        lineageKind: display(row.lineageKind, 'task run'),
        actionTool: display(row.actionTool, 'action'),
        status: display(row.status, 'unknown'),
      }))
      .filter((row) => row.id.length > 0)
      .slice(0, 8);
  }, [data]);

  const permissionRows = useMemo(() => {
    if (!permissionGraph) {
      return [
        {
          id: 'permission-graph-loading',
          title: 'Permission graph',
          meta: permissionGraphError ?? 'loading',
          detail:
            permissionGraphError ??
            'Waiting for workspace-scoped permission graph from the command-center API.',
        },
      ];
    }
    const labelById = new Map(permissionGraph.graph.nodes.map((node) => [node.id, node.label]));
    const graphRows = permissionGraph.graph.edges.slice(0, 12).map((edge) => ({
      id: edge.id,
      title: `${labelById.get(edge.from) ?? edge.from} -> ${labelById.get(edge.to) ?? edge.to}`,
      meta: `${edge.relation} / ${edge.status}`,
      detail: edge.reason ?? permissionGraph.redactionContract,
    }));
    return [
      ...graphRows,
      ...permissionGraph.blockers.slice(0, 2).map((blocker, index) => ({
        id: `permission-blocker-${index}`,
        title: 'Permission graph blocker',
        meta: 'prototype',
        detail: blocker,
      })),
    ];
  }, [permissionGraph, permissionGraphError]);

  const missionRows = useMemo(() => {
    if (!missionGraph) {
      return [
        {
          id: 'mission-graph-loading',
          title: 'Mission graph',
          meta: missionGraphError ?? 'loading',
          detail:
            missionGraphError ?? 'Waiting for durable mission graph from the command-center API.',
        },
      ];
    }
    const missions = Array.isArray(missionGraph.graph.missions) ? missionGraph.graph.missions : [];
    const nodes = Array.isArray(missionGraph.graph.nodes) ? missionGraph.graph.nodes : [];
    const edges = Array.isArray(missionGraph.graph.edges) ? missionGraph.graph.edges : [];
    return [
      ...missions.slice(0, 5).map((row) => ({
        id: String(row.id ?? row.missionKey ?? 'mission'),
        title: display(row.title, display(row.missionKey, 'Mission')),
        meta: `${display(row.status, 'status')} / ${display(row.autonomyMode, 'mode')}`,
        detail: `capability ${display(row.capabilityState, 'unknown')} / production ${display(
          row.productionReady,
          'false',
        )}`,
      })),
      ...nodes.slice(0, 8).map((row) => ({
        id: String(row.id ?? row.nodeKey ?? 'node'),
        title: display(row.title, display(row.nodeKey, 'Mission node')),
        meta: `${display(row.stage, 'stage')} / ${display(row.status, 'status')}`,
        detail: `tools ${arrayCount(row.requiredTools)} / evidence ${arrayCount(
          row.requiredEvidence,
        )}`,
      })),
      ...edges.slice(0, 8).map((row) => ({
        id: String(row.id ?? row.edgeKey ?? 'edge'),
        title: `${display(row.fromNodeKey, 'from')} -> ${display(row.toNodeKey, 'to')}`,
        meta: display(row.edgeKey, 'dependency'),
        detail: display(row.reason, 'No dependency reason recorded'),
      })),
      ...missionGraph.blockers.slice(0, 2).map((blocker, index) => ({
        id: `mission-blocker-${index}`,
        title: 'Mission graph blocker',
        meta: 'prototype',
        detail: blocker,
      })),
    ];
  }, [missionGraph, missionGraphError]);

  if (typeof window !== 'undefined' && !isAuthenticated()) return null;

  return (
    <main style={isNarrow ? narrowPageStyle : pageStyle}>
      <aside style={isNarrow ? narrowNavStyle : navStyle} aria-label="Command center navigation">
        <Link href="/" style={brandStyle}>
          Pilot
        </Link>
        <nav style={isNarrow ? narrowNavListStyle : navListStyle}>
          {navItems.map((item) => (
            <Link key={`${item.label}-${item.href}`} href={item.href} style={navLinkStyle}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div style={isNarrow ? narrowContentStyle : contentStyle}>
        <header style={isNarrow ? narrowHeaderStyle : headerStyle}>
          <div>
            <span style={eyebrowStyle}>Gate 8</span>
            <h1 style={titleStyle}>Agent Command Center</h1>
            <p style={subtitleStyle}>
              Real workspace state with capability truth attached to every surface.
            </p>
          </div>
          {data ? (
            <div style={readinessStyle}>
              <span style={labelStyle}>Production ready</span>
              <strong style={readinessNumberStyle}>
                {data.capabilities.summary.productionReady}/{data.capabilities.summary.total}
              </strong>
            </div>
          ) : null}
        </header>

        {loading ? <section style={loadingStyle}>Loading command-center state...</section> : null}

        {error ? (
          <section style={errorStyle}>
            <strong>Command center unavailable</strong>
            <p style={mutedTextStyle}>{error}</p>
          </section>
        ) : null}

        {data ? (
          <>
            <section
              style={isNarrow ? narrowTruthBandStyle : truthBandStyle}
              aria-label="Runtime truth"
            >
              <div>
                <span style={labelStyle}>Command center</span>
                <StateBadge state={data.runtimeTruth.commandCenterState} />
              </div>
              <div>
                <span style={labelStyle}>Mission runtime</span>
                <StateBadge state={data.runtimeTruth.missionRuntimeState} />
              </div>
              <p style={truthTextStyle}>{data.runtimeTruth.statement}</p>
            </section>

            <section style={statGridStyle} aria-label="Workspace execution summary">
              <Stat label="Active tasks" value={data.status.activeTasks} />
              <Stat label="Pending approvals" value={data.status.pendingApprovals} />
              <Stat label="Actions" value={data.status.recentActions} />
              <Stat label="Receipts" value={data.status.recentEvidence} />
              <Stat label="Evidence items" value={data.status.evidenceItems} />
              <Stat label="Browser observations" value={data.status.browserObservations} />
              <Stat label="Computer actions" value={data.status.computerActions} />
            </section>

            <section style={splitStyle}>
              <TimelineSection
                title="Mission Graph"
                empty="No durable mission graph rows returned."
                rows={missionRows}
              />

              <TimelineSection
                title="What Pilot Is Doing"
                empty="No durable task/action rows yet."
                rows={[
                  ...data.recent.tasks.slice(0, 5).map((row) => ({
                    id: String(row.id ?? row.title ?? 'task'),
                    title: display(row.title, 'Untitled task'),
                    meta: `${display(row.status, 'unknown')} / ${display(row.mode, 'mode')}`,
                    detail: display(row.description, ''),
                  })),
                  ...data.recent.actions.slice(0, 5).map((row) => ({
                    id: String(row.id ?? row.actionKey ?? 'action'),
                    title: display(row.actionKey, 'Action'),
                    meta: `${display(row.status, 'unknown')} / ${display(row.riskClass, 'risk')}`,
                    detail: display(row.policyDecisionId, 'No policy decision id recorded'),
                  })),
                ]}
              />

              <TimelineSection
                title="Why It Is Allowed"
                empty="No HELM receipts or policy decisions recorded yet."
                rows={[
                  ...data.recent.evidencePacks.slice(0, 6).map((row) => ({
                    id: String(row.id ?? row.decisionId ?? 'receipt'),
                    title: display(row.decisionId, 'HELM receipt'),
                    meta: `${display(row.verdict, 'verdict')} / ${display(row.policyVersion, 'policy')}`,
                    detail: `${display(row.action, 'action')} -> ${display(row.resource, 'resource')}`,
                  })),
                  ...data.recent.toolExecutions.slice(0, 4).map((row) => ({
                    id: String(row.id ?? row.toolKey ?? 'tool'),
                    title: display(row.toolKey, 'Tool execution'),
                    meta: `${display(row.status, 'unknown')} / ${display(row.policyDecisionId, 'policy decision')}`,
                    detail: display(row.idempotencyKey, 'No idempotency key recorded'),
                  })),
                ]}
              />
            </section>

            <section id="evidence" style={splitStyle}>
              <TimelineSection
                title="What Evidence Exists"
                empty="No evidence, browser, or computer replay rows recorded yet."
                rows={[
                  ...data.recent.evidenceItems.slice(0, 6).map((row) => ({
                    id: String(row.id ?? row.evidenceType ?? 'evidence-item'),
                    title: display(row.title, display(row.evidenceType, 'Evidence item')),
                    meta: `${display(row.sourceType, 'source')} / ${display(row.redactionState, 'redaction')}`,
                    detail: display(
                      row.replayRef,
                      display(row.contentHash, display(row.summary, 'No replay reference')),
                    ),
                  })),
                  ...data.recent.browserObservations.slice(0, 5).map((row) => ({
                    id: String(row.id ?? row.url ?? 'browser'),
                    title: display(row.title, display(row.url, 'Browser observation')),
                    meta: `DOM ${display(row.domHash, 'unhashed')}`,
                    detail: `redactions ${arrayCount(row.redactions)} / screenshot ${display(row.screenshotHash, 'not captured')}`,
                  })),
                  ...data.recent.computerActions.slice(0, 5).map((row) => ({
                    id: String(row.id ?? row.actionType ?? 'computer'),
                    title: display(row.actionType, 'Computer action'),
                    meta: `${display(row.status, 'unknown')} / exit ${display(row.exitCode, 'n/a')}`,
                    detail: display(
                      row.command,
                      display(row.filePath, display(row.devServerUrl, 'No command')),
                    ),
                  })),
                ]}
              />

              <TimelineSection
                title="What Requires Founder"
                empty="No pending approvals or blocking escalation rows."
                rows={[
                  ...data.recent.approvals.slice(0, 6).map((row) => ({
                    id: String(row.id ?? row.action ?? 'approval'),
                    title: display(row.action, 'Approval'),
                    meta: display(row.status, 'pending'),
                    detail: display(row.reason, 'Founder decision required'),
                  })),
                  ...data.runtimeTruth.blockers.slice(0, 4).map((blocker) => ({
                    id: blocker,
                    title: 'Capability blocker',
                    meta: 'non-production',
                    detail: blocker,
                  })),
                ]}
              />
            </section>

            <section id="sessions" style={splitStyle}>
              <TimelineSection
                title="Browser/Computer Sessions"
                empty="No replayable browser or computer session rows."
                rows={[
                  ...data.recent.browserObservations.slice(0, 4).map((row) => ({
                    id: String(row.id ?? row.url ?? 'browser-session'),
                    title: display(row.url, 'Browser URL'),
                    meta: display(row.origin, 'origin'),
                    detail: `replay ${display(row.replayIndex, '0')} / evidence ${display(row.evidencePackId, 'none')}`,
                  })),
                  ...data.recent.computerActions.slice(0, 4).map((row) => ({
                    id: String(row.id ?? row.objective ?? 'computer-session'),
                    title: display(row.objective, 'Computer objective'),
                    meta: display(row.environment, 'local'),
                    detail: `replay ${display(row.replayIndex, '0')} / evidence ${display(row.evidencePackId, 'none')}`,
                  })),
                ]}
              />

              <TimelineSection
                title="Agent Lanes"
                empty="No durable handoff rows recorded yet."
                rows={data.recent.agentHandoffs.slice(0, 8).map((row) => ({
                  id: String(row.id ?? row.toAgent ?? 'handoff'),
                  title: `${display(row.fromAgent, 'agent')} -> ${display(row.toAgent, 'agent')}`,
                  meta: `${display(row.status, 'unknown')} / ${display(row.handoffKind, 'handoff')}`,
                  detail: `task ${display(row.taskId, 'unlinked')}`,
                }))}
              />
            </section>

            <section style={proofDagSectionStyle} aria-label="Subagent proof DAG">
              <div style={sectionHeaderStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>Subagent Proof DAG</h2>
                  <p style={mutedTextStyle}>
                    Workspace-scoped lineage from parent run to spawn marker, subagent action,
                    handoff, evidence, and receipt state.
                  </p>
                </div>
                {proofDag ? <StateBadge state={proofDag.capability.state} /> : null}
              </div>

              {proofDagCandidates.length > 0 ? (
                <div style={runSelectorStyle} aria-label="Proof DAG run selector">
                  {proofDagCandidates.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedProofDagRunId(run.id)}
                      style={
                        run.id === selectedProofDagRunId ? selectedRunButtonStyle : runButtonStyle
                      }
                    >
                      <span style={buttonTitleStyle}>{run.lineageKind}</span>
                      <span style={buttonMetaStyle}>
                        {run.actionTool} / {run.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={emptyStyle}>
                  No recent task runs are available for proof-DAG inspection.
                </p>
              )}

              {proofDagLoading ? <p style={loadingInlineStyle}>Loading proof DAG...</p> : null}
              {proofDagError ? <p style={errorInlineStyle}>{proofDagError}</p> : null}

              {proofDag ? (
                <div style={proofDagGridStyle}>
                  <TimelineSection
                    title="Lineage Runs"
                    empty="No related task-run rows returned."
                    rows={proofDag.dag.taskRuns.map((row) => ({
                      id: String(row.id ?? row.lineageKind ?? 'task-run'),
                      title: display(row.lineageKind, 'Task run'),
                      meta: `${display(row.status, 'unknown')} / ${display(row.actionTool, 'action')}`,
                      detail: `parent ${display(row.parentTaskRunId, 'none')} / spawned by ${display(
                        row.spawnedByActionId,
                        'none',
                      )}`,
                    }))}
                  />
                  <TimelineSection
                    title="Handoffs"
                    empty="No durable handoff rows returned."
                    rows={proofDag.dag.agentHandoffs.map((row) => ({
                      id: String(row.id ?? row.childTaskRunId ?? 'handoff'),
                      title: `${display(row.fromAgent, 'agent')} -> ${display(row.toAgent, 'agent')}`,
                      meta: `${display(row.status, 'unknown')} / ${display(row.handoffKind, 'handoff')}`,
                      detail: `parent ${display(row.parentTaskRunId, 'none')} / child ${display(
                        row.childTaskRunId,
                        'none',
                      )}`,
                    }))}
                  />
                  <TimelineSection
                    title="Spawn Evidence"
                    empty="No evidence packs returned for this proof DAG."
                    rows={proofDag.dag.evidencePacks.map((row) => ({
                      id: String(row.id ?? row.decisionId ?? 'evidence'),
                      title: display(row.action, 'Evidence pack'),
                      meta: `${display(row.verdict, 'verdict')} / ${display(row.policyVersion, 'policy')}`,
                      detail: `${display(row.decisionId, 'decision')} / task run ${display(
                        row.taskRunId,
                        'unlinked',
                      )}`,
                    }))}
                  />
                </div>
              ) : null}

              {proofDag ? (
                <div style={blockerStripStyle}>
                  <span style={labelStyle}>Production blockers</span>
                  {proofDag.blockers.map((blocker) => (
                    <p key={blocker} style={mutedTextStyle}>
                      {blocker}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            <section id="artifacts" style={splitStyle}>
              <TimelineSection
                title="Permission Graph"
                empty="No permission graph edges returned."
                rows={permissionRows}
              />

              <TimelineSection
                title="Artifacts"
                empty="No artifact records yet."
                rows={data.recent.artifacts.slice(0, 8).map((row) => ({
                  id: String(row.id ?? row.name ?? 'artifact'),
                  title: display(row.name, 'Artifact'),
                  meta: `${display(row.type, 'type')} / v${display(row.currentVersion, '1')}`,
                  detail: display(row.storagePath, 'No storage path recorded'),
                }))}
              />

              <TimelineSection
                title="Audit Ledger"
                empty="No audit events in this workspace window."
                rows={data.recent.auditEvents.slice(0, 8).map((row) => ({
                  id: String(row.id ?? row.action ?? 'audit'),
                  title: display(row.action, 'Audit event'),
                  meta: `${display(row.verdict, 'verdict')} / ${display(row.actor, 'actor')}`,
                  detail: display(row.reason, display(row.target, 'No target')),
                }))}
              />
            </section>

            <section style={capabilitySectionStyle} aria-label="Capability matrix">
              <div style={sectionHeaderStyle}>
                <h2 style={sectionTitleStyle}>Capability Matrix</h2>
                <Link href="/capabilities" style={smallLinkStyle}>
                  Full matrix
                </Link>
              </div>
              <div style={capabilityGridStyle}>
                {capabilities.map((capability) => (
                  <article key={capability.key} style={capabilityRowStyle}>
                    <div>
                      <h3 style={capabilityTitleStyle}>{capability.name}</h3>
                      <code style={codeStyle}>{capability.key}</code>
                    </div>
                    <StateBadge state={capability.state} />
                    <p style={capabilitySummaryStyle}>{capability.summary}</p>
                    <p style={mutedTextStyle}>{capability.evalRequirement}</p>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function StateBadge({ state }: { state: CapabilityState }) {
  return <span style={stateBadgeStyle(state)}>{formatState(state)}</span>;
}

function useNarrowViewport(maxWidth: number): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth <= maxWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [maxWidth]);

  return isNarrow;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={statStyle}>
      <span style={labelStyle}>{label}</span>
      <strong style={statValueStyle}>{value}</strong>
    </div>
  );
}

function TimelineSection({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ id: string; title: string; meta: string; detail: string }>;
  empty: string;
}) {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      {rows.length === 0 ? <p style={emptyStyle}>{empty}</p> : null}
      <div style={timelineStyle}>
        {rows.map((row) => (
          <article key={`${title}-${row.id}`} style={timelineRowStyle}>
            <div style={timelineDotStyle} aria-hidden="true" />
            <div>
              <h3 style={timelineTitleStyle}>{row.title}</h3>
              <p style={timelineMetaStyle}>{row.meta}</p>
              {row.detail ? <p style={mutedTextStyle}>{row.detail}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function display(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  return JSON.stringify(value);
}

function arrayCount(value: unknown): string {
  return Array.isArray(value) ? String(value.length) : '0';
}

function formatState(state: CapabilityState): string {
  return state.replace(/_/g, ' ');
}

function stateBadgeStyle(state: CapabilityState): CSSProperties {
  const palette: Record<CapabilityState, CSSProperties> = {
    production_ready: {
      color: 'var(--ok)',
      borderColor: 'var(--ok)',
      background: 'var(--ok-soft)',
    },
    implemented: {
      color: 'var(--info)',
      borderColor: 'var(--info)',
      background: 'var(--info-soft)',
    },
    prototype: {
      color: 'var(--warn)',
      borderColor: 'var(--warn)',
      background: 'var(--warn-soft)',
    },
    scaffolded: {
      color: 'var(--warn)',
      borderColor: 'var(--ds-line-2)',
      background: 'var(--ds-surface-2)',
    },
    stub: {
      color: 'var(--danger)',
      borderColor: 'var(--danger)',
      background: 'var(--accent-soft)',
    },
    blocked: {
      color: 'var(--danger)',
      borderColor: 'var(--danger)',
      background: 'var(--accent-soft)',
    },
  };

  return {
    ...badgeBaseStyle,
    ...palette[state],
  };
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 240px) minmax(0, 1fr)',
  background: 'var(--ds-bg)',
  color: 'var(--ink)',
};

const narrowPageStyle: CSSProperties = {
  ...pageStyle,
  display: 'block',
};

const navStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  height: '100vh',
  padding: '1.25rem',
  borderRight: '1px solid var(--ds-line)',
  background: 'var(--ds-bg-2)',
  overflowY: 'auto',
};

const narrowNavStyle: CSSProperties = {
  ...navStyle,
  position: 'static',
  height: 'auto',
  borderRight: 0,
  borderBottom: '1px solid var(--ds-line)',
  overflowX: 'auto',
  overflowY: 'visible',
};

const brandStyle: CSSProperties = {
  display: 'block',
  marginBottom: '1.25rem',
  color: 'var(--ink)',
  textDecoration: 'none',
  fontFamily: 'var(--ds-font-display)',
  fontSize: '1.4rem',
  fontWeight: 700,
};

const navListStyle: CSSProperties = {
  display: 'grid',
  gap: '0.35rem',
};

const narrowNavListStyle: CSSProperties = {
  ...navListStyle,
  gridAutoFlow: 'column',
  gridAutoColumns: 'max-content',
  overflowX: 'auto',
};

const navLinkStyle: CSSProperties = {
  color: 'var(--ink-2)',
  textDecoration: 'none',
  border: '1px solid transparent',
  borderRadius: 8,
  padding: '0.55rem 0.65rem',
  fontSize: '0.92rem',
};

const contentStyle: CSSProperties = {
  width: '100%',
  maxWidth: 1280,
  margin: '0 auto',
  padding: '1.5rem',
};

const narrowContentStyle: CSSProperties = {
  ...contentStyle,
  padding: '1rem',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'flex-start',
  paddingBottom: '1.25rem',
  borderBottom: '1px solid var(--ds-line)',
};

const narrowHeaderStyle: CSSProperties = {
  ...headerStyle,
  flexDirection: 'column',
};

const eyebrowStyle: CSSProperties = {
  color: 'var(--accent)',
  fontSize: '0.8rem',
  fontWeight: 700,
  textTransform: 'uppercase',
};

const titleStyle: CSSProperties = {
  margin: '0.15rem 0 0.35rem',
  fontSize: '2.2rem',
  fontFamily: 'var(--ds-font-display)',
  letterSpacing: 0,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--ink-2)',
  fontSize: '1rem',
};

const readinessStyle: CSSProperties = {
  minWidth: 160,
  padding: '0.9rem',
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  background: 'var(--ds-surface)',
};

const readinessNumberStyle: CSSProperties = {
  display: 'block',
  marginTop: '0.2rem',
  fontSize: '1.6rem',
};

const labelStyle: CSSProperties = {
  display: 'block',
  color: 'var(--ink-3)',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
};

const loadingStyle: CSSProperties = {
  marginTop: '1.25rem',
  padding: '1rem',
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  background: 'var(--ds-surface)',
};

const errorStyle: CSSProperties = {
  ...loadingStyle,
  borderColor: 'var(--danger)',
};

const truthBandStyle: CSSProperties = {
  marginTop: '1.25rem',
  display: 'grid',
  gridTemplateColumns: 'minmax(140px, 180px) minmax(140px, 180px) minmax(0, 1fr)',
  gap: '1rem',
  alignItems: 'center',
  padding: '1rem 0',
  borderBottom: '1px solid var(--ds-line)',
};

const narrowTruthBandStyle: CSSProperties = {
  ...truthBandStyle,
  gridTemplateColumns: '1fr',
  alignItems: 'start',
};

const truthTextStyle: CSSProperties = {
  margin: 0,
  color: 'var(--ink-2)',
  lineHeight: 1.5,
};

const statGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '0.8rem',
  marginTop: '1.25rem',
};

const statStyle: CSSProperties = {
  minHeight: 90,
  padding: '0.9rem',
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  background: 'var(--ds-surface)',
};

const statValueStyle: CSSProperties = {
  display: 'block',
  marginTop: '0.35rem',
  fontSize: '1.8rem',
};

const splitStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  gap: '1.2rem',
  marginTop: '1.4rem',
};

const sectionStyle: CSSProperties = {
  borderTop: '1px solid var(--ds-line)',
  paddingTop: '1rem',
};

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'center',
};

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 0.8rem',
  fontSize: '1rem',
  letterSpacing: 0,
};

const timelineStyle: CSSProperties = {
  display: 'grid',
  gap: '0.7rem',
};

const timelineRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '14px minmax(0, 1fr)',
  gap: '0.65rem',
  padding: '0.85rem',
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  background: 'var(--ds-surface)',
};

const timelineDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  marginTop: '0.35rem',
  borderRadius: 8,
  background: 'var(--accent)',
};

const timelineTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.98rem',
  overflowWrap: 'anywhere',
};

const timelineMetaStyle: CSSProperties = {
  margin: '0.2rem 0',
  color: 'var(--ink-2)',
  fontSize: '0.86rem',
  overflowWrap: 'anywhere',
};

const mutedTextStyle: CSSProperties = {
  margin: 0,
  color: 'var(--ink-3)',
  fontSize: '0.86rem',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
};

const emptyStyle: CSSProperties = {
  ...mutedTextStyle,
  padding: '0.85rem',
  border: '1px dashed var(--ds-line-2)',
  borderRadius: 8,
};

const capabilitySectionStyle: CSSProperties = {
  marginTop: '1.4rem',
  borderTop: '1px solid var(--ds-line)',
  paddingTop: '1rem',
};

const proofDagSectionStyle: CSSProperties = {
  marginTop: '1.4rem',
  borderTop: '1px solid var(--ds-line)',
  paddingTop: '1rem',
};

const runSelectorStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
  gap: '0.7rem',
  marginTop: '1rem',
};

const runButtonStyle: CSSProperties = {
  display: 'grid',
  gap: '0.25rem',
  textAlign: 'left',
  padding: '0.75rem',
  color: 'var(--ink)',
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  background: 'var(--ds-surface)',
  cursor: 'pointer',
};

const selectedRunButtonStyle: CSSProperties = {
  ...runButtonStyle,
  borderColor: 'var(--accent)',
  background: 'var(--accent-soft)',
};

const buttonTitleStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: '0.86rem',
  overflowWrap: 'anywhere',
};

const buttonMetaStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '0.78rem',
  overflowWrap: 'anywhere',
};

const proofDagGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
  gap: '1rem',
  marginTop: '1rem',
};

const blockerStripStyle: CSSProperties = {
  display: 'grid',
  gap: '0.35rem',
  marginTop: '1rem',
  padding: '0.85rem',
  border: '1px solid var(--warn)',
  borderRadius: 8,
  background: 'var(--warn-soft)',
};

const loadingInlineStyle: CSSProperties = {
  ...mutedTextStyle,
  marginTop: '1rem',
};

const errorInlineStyle: CSSProperties = {
  ...loadingInlineStyle,
  color: 'var(--danger)',
};

const capabilityGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))',
  gap: '0.8rem',
};

const capabilityRowStyle: CSSProperties = {
  display: 'grid',
  gap: '0.6rem',
  alignContent: 'start',
  padding: '0.9rem',
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  background: 'var(--ds-surface)',
};

const capabilityTitleStyle: CSSProperties = {
  margin: '0 0 0.2rem',
  fontSize: '0.95rem',
};

const capabilitySummaryStyle: CSSProperties = {
  margin: 0,
  color: 'var(--ink-2)',
  fontSize: '0.86rem',
  lineHeight: 1.45,
};

const smallLinkStyle: CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
  fontSize: '0.9rem',
};

const codeStyle: CSSProperties = {
  fontFamily: 'var(--ds-font-mono)',
  color: 'var(--ink-3)',
  fontSize: '0.78rem',
  overflowWrap: 'anywhere',
};

const badgeBaseStyle: CSSProperties = {
  display: 'inline-flex',
  width: 'fit-content',
  alignItems: 'center',
  border: '1px solid',
  borderRadius: 8,
  padding: '0.25rem 0.45rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
};

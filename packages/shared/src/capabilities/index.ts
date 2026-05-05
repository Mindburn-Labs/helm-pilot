import { z } from 'zod';

export const capabilityStateValues = [
  'implemented',
  'prototype',
  'scaffolded',
  'stub',
  'blocked',
  'production_ready',
] as const;

export const capabilityKeyValues = [
  'mission_runtime',
  'helm_receipts',
  'workspace_rbac',
  'operator_scoping',
  'decision_court',
  'skill_registry_runtime',
  'opportunity_scoring',
  'browser_metadata_connector',
  'browser_execution',
  'computer_use',
  'a2a_durable_state',
  'subagent_lineage',
  'approval_resume',
  'evidence_ledger',
  'command_center',
  'startup_lifecycle',
  'founder_off_grid',
  'polsia_outperformance',
] as const;

export const CapabilityStateSchema = z.enum(capabilityStateValues);
export const CapabilityKeySchema = z.enum(capabilityKeyValues);

export const CapabilityEvalMetadataSchema = z.object({
  evalName: z.string().min(1),
  passedAt: z.string().datetime(),
  evidenceRef: z.string().min(1),
});

export const CapabilityRecordSchema = z.object({
  key: CapabilityKeySchema,
  name: z.string().min(1),
  state: CapabilityStateSchema,
  summary: z.string().min(1),
  owner: z.string().min(1),
  blockers: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)),
  evalRequirement: z.string().min(1),
  eval: CapabilityEvalMetadataSchema.optional(),
  updatedAt: z.string().datetime(),
});

export const CapabilitySummarySchema = z.object({
  generatedAt: z.string().datetime(),
  total: z.number().int().nonnegative(),
  productionReady: z.number().int().nonnegative(),
  byState: z.record(CapabilityStateSchema, z.number().int().nonnegative()),
  blockers: z.array(
    z.object({
      key: CapabilityKeySchema,
      state: CapabilityStateSchema,
      blockers: z.array(z.string().min(1)),
    }),
  ),
});

export type CapabilityState = z.infer<typeof CapabilityStateSchema>;
export type CapabilityKey = z.infer<typeof CapabilityKeySchema>;
export type CapabilityEvalMetadata = z.infer<typeof CapabilityEvalMetadataSchema>;
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>;
export type CapabilitySummary = z.infer<typeof CapabilitySummarySchema>;

export const CAPABILITY_REGISTRY_UPDATED_AT = '2026-05-05T00:00:00.000Z';

const capabilityRecords = validateCapabilityRecords([
  {
    key: 'mission_runtime',
    name: 'Mission runtime',
    state: 'blocked',
    summary:
      'Pilot now has durable venture, goal, mission, DAG, task, action, and tool ledgers plus scheduler, narrow mission-node task dispatch, bounded ready-node execution, and post-completion dependency advancement, but execution is not yet checkpointed, recovered, rolled back, and evaluated as the runtime backbone.',
    owner: 'Foundation Agent',
    blockers: [
      'Mission execution is explicit bounded ready-node dispatch, not production-ready founder-off-grid DAG automation',
      'No mission-level checkpoint, recovery, and rollback executor',
      'No durable long-running mission loop with retry, resume, and replay semantics',
      'Current task APIs must remain compatible until mission-backed equivalents pass regression gates',
    ],
    evidence: [
      'Gate 5 adds durable actions and tool executions with missionId fields',
      'Gate 9 adds durable ventures, goals, missions, mission_nodes, mission_edges, and mission_tasks plus /api/startup-lifecycle/persist',
      'Gateway exposes /api/startup-lifecycle/missions/:missionId/schedule to identify dependency-ready nodes and queued task rows without dispatching execution',
      'Gateway exposes /api/startup-lifecycle/missions/:missionId/nodes/:nodeId/execute for partner-scoped execution of a scheduled ready node through orchestrator.runTask with missionId context and advances newly unblocked pending nodes to ready',
      'Gateway exposes /api/startup-lifecycle/missions/:missionId/execute-ready for explicit bounded execution of currently ready nodes without production promotion',
    ],
    evalRequirement: 'Full Startup Launch Eval and Multi-Agent Parallel Build Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'helm_receipts',
    name: 'Mandatory HELM receipts',
    state: 'implemented',
    summary:
      'HelmClient.evaluate now requires a durable receipt sink for elevated actions and fails closed when that sink is missing or cannot persist.',
    owner: 'Governance Agent',
    blockers: [
      'HELM Governance Eval has not promoted the capability to production_ready',
      'Policy and document version pinning is not attached to every meaningful action',
      'End-to-end HELM Governance Eval must prove helper receipt persistence failures block execution',
    ],
    evidence: [
      'Gate 2A adds required_for_elevated receipt persistence to @pilot/helm-client evaluate()',
      'Gateway server wiring installs a global evidence_packs receipt sink for HELM receipts',
      'Tests cover missing sink and sink persistence failure for elevated evaluate actions',
      'AgentLoop denies elevated tool execution when no HELM governance client is configured; Tool Broker rejects elevated calls without policy metadata; ToolRegistry refuses elevated implementations without brokered HELM context',
      'Launch deploy, health-check, and rollback routes require HELM governance for elevated launch actions and pass explicit effect levels into evaluation',
      'Managed Telegram claim, webhook, send, token rotation, and disable actions require HELM governance and pass explicit effect levels into evaluation',
      'Operator computer-use and browser-read helper tests prove those elevated helpers inherit generic evaluate() receipt-sink fail-closed behavior',
      'HelmClient.chatCompletion classifies LLM_INFERENCE as receipt-required under required_for_elevated and checks for a receipt sink before model calls',
      'HELM admin helper endpoints now have an explicit action catalog: read-only inspection is E1/no-receipt, createObligation is E2 governed write, and promoteMemory is E3 governed write',
      'Tool Broker now pins policy/document metadata on every brokered action and tool execution, including explicit local policy pins for low-risk tools without HELM decisions',
      'Launch deployment, health-check, and rollback paths now persist HELM policy/document pins into deployment and health metadata after approval',
      'Browser read and safe computer action ledgers now persist queryable HELM document version pins beside policy decision/version metadata after approval',
      'Managed Telegram bot and message actions now persist HELM policy/document pins into bot/message governance metadata after approval',
    ],
    evalRequirement: 'HELM Governance Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'workspace_rbac',
    name: 'Workspace RBAC',
    state: 'implemented',
    summary:
      'Gateway now carries workspace role context and sensitive existing routes enforce owner or partner requirements before mutation or inspection.',
    owner: 'Governance Agent',
    blockers: [
      'HELM Governance Eval has not promoted the capability to production_ready',
      'Future browser/computer session and policy-document routes must use the shared role helper when they land',
      'Admin-token surfaces remain outside workspace RBAC and need separate operational controls',
    ],
    evidence: [
      'Gate 2B adds requireWorkspaceRole for governance receipts, audit approvals, secrets, connectors, workspace settings/mode/invites, task runtime starts, conductor runs, and operator mutation',
      'Route tests deny member-role access before sensitive mutations execute',
    ],
    evalRequirement: 'HELM Governance Eval and Security RBAC Regression Suite',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'operator_scoping',
    name: 'Operator ownership scoping',
    state: 'implemented',
    summary:
      'Task and conductor ingress validate operator ownership, and orchestrator runtime resolution rejects foreign operator IDs before agent execution.',
    owner: 'Governance Agent',
    blockers: [
      'Cross-Workspace Operator Rejection Regression has not promoted the capability to production_ready',
      'New autonomous ingress paths must reuse the same ownership validation pattern',
    ],
    evidence: [
      'Gate 2B rejects foreign operator IDs in task creation and conductor runs',
      'Orchestrator resolveRuntime now filters operators by workspaceId and fails closed when no owned operator exists',
      'Startup lifecycle mission-node execution now validates task operator ownership before mutating mission, node, or task state',
      'Regression tests cover gateway and runtime foreign operator rejection',
    ],
    evalRequirement: 'Cross-Workspace Operator Rejection Regression',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'decision_court',
    name: 'Decision Court',
    state: 'implemented',
    summary:
      'Decision Court now exposes explicit heuristic_preview, governed_llm_court, and unavailable modes; governed mode requires HELM-governed model-call receipts.',
    owner: 'Decision Agent',
    blockers: [
      'Decision Court Governed Model Eval has not promoted the capability to production_ready',
      'Court audit records are persisted to audit_log, but first-class evidence/artifact links still need the Gate 5+ ledger',
      'Provider availability depends on HELM_GOVERNANCE_URL and a configured upstream model provider',
    ],
    evidence: [
      'Gate 4 prevents silent fallback from governed_llm_court to heuristic reasoning',
      'Gateway persists Decision Court run records with mode, status, participants, prompts, model usage, costs, policy decisions, and final recommendation metadata',
      'Tests cover unavailable, heuristic preview, governed calls with receipts, missing-governance denial, and referee failure',
    ],
    evalRequirement: 'Decision Court Governed Model Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'skill_registry_runtime',
    name: 'Runtime skill registry',
    state: 'implemented',
    summary:
      'Skill registry loading is wired into gateway, orchestrator, conductor, and subagent prompts with versioned metadata recorded on spawned runs and handoffs.',
    owner: 'Runtime Agent',
    blockers: [
      'Skill Invocation Governance Eval has not promoted the capability to production_ready',
      'Skills are still prompt packages rather than fully Tool Broker callable capabilities',
      'Broader agent registry cost limits, memory scopes, and policy constraints are not complete',
    ],
    evidence: [
      'Gate 3 loads SkillRegistry in gateway startup and passes it through Orchestrator and Conductor',
      'Conductor validates explicit skills are loaded and blocks declared skills whose tools exceed the subagent scope',
      'task_runs.skill_invocations and agent_handoffs.skill_invocations record skill version, risk, permissions, eval status, declared tools, and source path',
    ],
    evalRequirement: 'Skill Invocation Governance Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'opportunity_scoring',
    name: 'Opportunity scoring',
    state: 'implemented',
    summary:
      'score_opportunity returns an evidence-backed startup scorecard across pain, urgency, ICP, monetization, channel, competition, founder fit, feasibility, evidence quality, confidence, assumptions, and citations.',
    owner: 'Tooling Agent',
    blockers: [
      'PMF Discovery Eval has not promoted the capability to production_ready',
      'Scoring rationale and citations are persisted through tool_executions/audit metadata and background worker evidence items, but not yet a full Evidence Center artifact pack',
      'Scoring remains deterministic evidence scoring until governed LLM scorer promotion has eval coverage',
    ],
    evidence: [
      'Gate 5 score_opportunity persists opportunity_scores, returns dimensions/citations/assumptions, and updates opportunity status',
      'Tool Broker records action/tool_execution/audit metadata for autonomous score_opportunity calls',
      'Background opportunity.score jobs no longer silently downgrade configured LLM/HELM failures into heuristic scores and persist policy/model metadata on score rows',
      'opportunity_scout tool scope includes create_opportunity and score_opportunity so scraped candidates can be persisted before scoring',
    ],
    evalRequirement: 'PMF Discovery Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'browser_metadata_connector',
    name: 'Browser metadata connector',
    state: 'implemented',
    summary:
      'Browser session, active grant, and redacted observation records now represent the governed read/extract boundary without storing raw credentials.',
    owner: 'Browser Agent',
    blockers: [
      'Browser extension/bridge handoff is not yet productized',
      'Observation replay is stored as ordered records but not yet exposed in the command-center UI',
      'YC Logged-In Browser Extraction Eval has not promoted the capability to production_ready',
    ],
    evidence: [
      'Gate 6 adds browser_sessions, browser_session_grants, browser_actions, and browser_observations',
      'Gateway /api/browser-sessions stores session boundaries, grants active origins, and persists redacted observations',
      'Browser session creation and grant mutations now require HELM evaluation and persist policy decision, document pins, and evidence pack metadata on session/grant rows',
    ],
    evalRequirement: 'YC Logged-In Browser Extraction Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'browser_execution',
    name: 'Browser execution',
    state: 'prototype',
    summary:
      'Pilot has a HELM-governed read-only browser observation path for logged-in sessions, with active grants, origin scopes, redaction, DOM hashes, and evidence references.',
    owner: 'Browser Agent',
    blockers: [
      'No productized browser extension/bridge that drives active tabs end-to-end',
      'No arbitrary clicking, posting, payment, or destructive browser operations by design',
      'YC Logged-In Browser Extraction Eval has not passed',
    ],
    evidence: [
      'operator.browser_read requires HELM evaluation before persisting a read-only observation',
      'Browser session creation and active-tab grant APIs fail closed without HELM governance and persist access-boundary decision metadata before read/extract can occur',
      'Browser actions and observations persist URL, origin, title, redacted DOM, DOM hash, screenshot refs, extracted data, redactions, replay ordering, and HELM evidence pack id',
      'Gateway /api/browser-sessions/observations fails closed when HELM is not configured',
    ],
    evalRequirement: 'YC Logged-In Browser Extraction Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'computer_use',
    name: 'Computer and sandbox use',
    state: 'prototype',
    summary:
      'operator.computer_use now supports narrow HELM-governed local safe actions for allowlisted terminal commands, project-scoped file reads/writes, and local dev-server status checks with replayable evidence rows.',
    owner: 'Computer Agent',
    blockers: [
      'Safe Computer/Sandbox Action Eval has not promoted the capability to production_ready',
      'Sandbox provider execution remains unavailable unless a future provider bridge is wired',
      'No unrestricted desktop, IDE, browser clicking, external posting, payment, or destructive computer operation is allowed',
    ],
    evidence: [
      'Gate 7 adds computer_actions evidence rows for terminal_command, file_read, file_write, and dev_server_status operations',
      'operator.computer_use requires Tool Broker action lineage, HELM OPERATOR_COMPUTER_USE approval, restricted path deny rules, and command allowlisting before execution',
    ],
    evalRequirement: 'Safe Computer/Sandbox Action Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'a2a_durable_state',
    name: 'Durable A2A state',
    state: 'implemented',
    summary:
      'Pilot-as-server A2A task state is persisted as workspace-scoped threads and ordered messages, and tasks/get reconstructs state from the database instead of process-local memory.',
    owner: 'Foundation Agent',
    blockers: [
      'Multi-Agent Parallel Build Eval has not promoted the capability to production_ready',
      'A2A state is durable for gateway protocol tasks, but broader mission/action/evidence handoff linkage is still incomplete',
      'Founder-off-grid recovery semantics still need eval coverage over long-running A2A conversations',
    ],
    evidence: [
      'Gate 1 adds a2a_threads and a2a_messages with workspace-scoped persistence',
      'Gateway A2A tasks/send persists threads/messages and tasks/get reloads ordered messages from the database',
      'Route tests reconstruct durable A2A state after route re-instantiation',
    ],
    evalRequirement: 'Multi-Agent Parallel Build Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'subagent_lineage',
    name: 'Subagent proof lineage',
    state: 'implemented',
    summary:
      'Conductor-spawned child work is anchored through durable task_run parent/root/spawn columns, SUBAGENT_SPAWN evidence packs, child action rows, and agent_handoffs.',
    owner: 'Runtime Agent',
    blockers: [
      'Proof DAG Lineage Regression has not promoted the capability to production_ready',
      'Command Center proof-DAG UI is inspection-only and has not passed eval-backed promotion',
      'Nested mission-level replay and recovery evals have not proven lineage across checkpoint boundaries',
    ],
    evidence: [
      'task_runs has parent_task_run_id, root_task_run_id, spawned_by_action_id, lineage_kind, run_sequence, and checkpoint_id columns',
      'AgentLoop pre-persists a parent task_run anchor before subagent tool execution and passes it into ToolRegistry context',
      'Conductor writes a subagent_spawn task_run row, attaches the SUBAGENT_SPAWN evidence pack to that row, and fails closed if persistence/attachment fails',
      'SubagentLoop persists child actions with lineage_kind=subagent_action anchored to the subagent task_run root/parent frame',
      'agent_handoffs records parent_task_run_id, child_task_run_id, handoff status, skill metadata, input, and output',
      'Gateway exposes /api/command-center/proof-dag/:taskRunId for workspace-scoped parent/spawn/child/evidence DAG inspection',
      'apps/web /command-center renders a founder-facing proof-DAG inspection surface backed by the API route',
      'orchestrator tests cover parent anchor pre-persistence, spawn row lineage fields, child action lineage fields, evidence attachment failure, handoff persistence failure, and concurrent subagent spawn isolation',
    ],
    evalRequirement: 'Proof DAG Lineage Regression',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'approval_resume',
    name: 'Deterministic approval resume',
    state: 'implemented',
    summary:
      'Approval resume now loads workspace-validated parent task history in deterministic replay order and excludes child/subagent rows through lineage filters before invoking AgentLoop.resume.',
    owner: 'Foundation Agent',
    blockers: [
      'Approval Resume Isolation Regression has not promoted the capability to production_ready',
      'Subagent proof DAG lineage is implemented but not production_ready, so child-row replay opt-in is not exposed as a production workflow',
      'Long-running mission replay and recovery evals have not proven resume behavior across mission-level checkpoints',
    ],
    evidence: [
      'services/orchestrator/src/run-history.ts validates task workspace ownership before reading task_runs',
      'loadParentRunHistory filters task_runs to lineage_kind=parent_action, parent_task_run_id IS NULL, and action_tool IS NOT NULL',
      'Replay history orders by run_sequence, started_at, and id for deterministic approval resume',
      'task.resume pg-boss handler loads parent run history before calling orchestrator.resumeTask',
      'services/orchestrator/src/__tests__/run-history.test.ts covers cross-workspace rejection and deterministic parent-only replay query semantics',
    ],
    evalRequirement: 'Approval Resume Isolation Regression',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'evidence_ledger',
    name: 'Evidence ledger',
    state: 'prototype',
    summary:
      'A canonical evidence_items schema exists and core HELM receipt, agent-loop receipt, subagent spawn, Tool Broker, browser observation, computer action, connector lifecycle, workspace-scoped pipeline/ingestion jobs, artifact creation, startup lifecycle, and eval writers append to it. Tool Broker now fails closed before elevated tool execution without HELM policy metadata and fails elevated completions closed if evidence persistence fails, but evidence coverage is still not complete for every meaningful action.',
    owner: 'Foundation Agent',
    blockers: [
      'Non-workspace scheduled ingestion jobs and non-broker legacy writers do not yet append evidence_items for every meaningful action',
      'Browser/computer replay contract has not passed Browser/Computer Replay Eval and is not production-ready',
      'Non-broker legacy execution paths still need elevated-action receipt/evidence fail-closed guards',
    ],
    evidence: [
      'packages/db/src/schema/evidence.ts defines evidence_items with workspace, venture, mission, task, task_run, action, tool_execution, evidence_pack, browser_observation, computer_action, artifact, and audit_event links',
      'packages/db/migrations/0025_evidence_items.sql creates the canonical evidence_items ledger and indexes cross-surface lookup fields',
      'packages/db/src/__tests__/foundation-lineage-schema.test.ts verifies evidence item columns are exported',
      'packages/db/src/evidence-ledger.ts exposes appendEvidenceItem for DB-owned evidence indexing',
      'Gateway HELM receipt persistence, agent-loop governance mirroring, conductor SUBAGENT_SPAWN packs, browser read/extract, and safe computer actions append evidence_items rows',
      'Tool Broker completed and failed executions append tool_broker evidence_items rows linked to action_id and tool_execution_id',
      'Tool Broker refuses medium, high, and restricted tool manifests before action persistence or execution unless HELM policy decision metadata is present, and marks elevated tool executions failed if evidence_items persistence fails before completion',
      'Connector refresh background worker success and failure paths append sanitized evidence_items rows without token material',
      'Workspace-scoped YC, Startup School, private YC, knowledge ingestion, and opportunity-cluster pipeline workers append redacted pipeline_worker evidence_items rows for success and failure',
      'YC scraper ingestion finalizers append redacted yc_scraper_ingestion evidence_items rows for parsed and failed workspace-scoped ingestion records without session, token, or raw error material',
      'Orchestrator and MCP artifact creation append artifact_created evidence_items rows linked to artifact_id and replay refs',
      'Connector grant, revoke, token metadata, browser-session metadata, validation queue, OAuth initiation, callback, refresh, and session-delete routes append redacted evidence_items rows without token or session payloads',
      'Startup lifecycle persistence, scheduling, and node execution append evidence_items rows linked to mission/task state and replay refs',
      'Production eval run/result/evidence-reference writes append evidence_items rows and return evidenceItemIds from the eval API',
      '/api/command-center returns recent evidence_items and the web command center renders them in the evidence surface',
      '/api/command-center/replay resolves workspace-scoped replay refs to linked evidence_items, browser_observations, and computer_actions without production promotion',
      '/api/browser-sessions/:sessionId/replay and /api/command-center/computer-actions/replay expose ordered browser/computer replay sequences with explicit redaction contracts',
    ],
    evalRequirement: 'HELM Governance Eval and Recovery Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'command_center',
    name: 'Command center UI',
    state: 'prototype',
    summary:
      'The web app has a command center backed by real task, action, tool execution, receipt, browser, computer, artifact, audit, handoff, approval, and capability-state rows, while mission DAG autonomy remains blocked.',
    owner: 'UI Agent',
    blockers: [
      'Mission runtime is still blocked, so the command center cannot claim venture/mission DAG autonomy',
      'No first-class permission graph, live mission graph, or founder-off-grid execution control surface',
      'Command Center Real-State UX Eval has not promoted the capability to production_ready',
    ],
    evidence: [
      'Gate 8 adds /api/command-center backed by durable task/action/tool/evidence/browser/computer/artifact/audit/approval/handoff rows',
      'Gate 8 adds /api/command-center/proof-dag/:taskRunId for subagent proof DAG inspection without production promotion',
      'apps/web /command-center renders capability truth, blocked mission runtime, receipt chips, evidence drawers, browser/computer replay rows, subagent proof-DAG rows, and escalation state from the API',
    ],
    evalRequirement: 'Command Center Real-State UX Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'startup_lifecycle',
    name: 'Startup lifecycle engine',
    state: 'prototype',
    summary:
      'Pilot can compile, persist, schedule, execute one or more explicitly ready lifecycle nodes, and advance newly unblocked nodes through the governed task runtime across onboarding, PMF, build, launch, growth, sales, formation, fundraising, and operations, but it does not execute the mission DAG as production-ready founder-off-grid automation yet.',
    owner: 'Runtime Agent',
    blockers: [
      'Lifecycle node execution is explicit bounded dispatch, not a production-ready autonomous startup launch workflow',
      'Dependency advancement marks nodes ready, but retry, checkpoint, recovery, and rollback over the mission DAG are incomplete',
      'Legal/financial/external communication escalation contracts are compiled but not enforced by a running lifecycle engine',
      'No end-to-end startup launch eval passing against the lifecycle engine',
    ],
    evidence: [
      'Gate 9 adds startup lifecycle templates with agents, skills, tools, evidence, HELM policy classes, escalation conditions, and acceptance criteria',
      'Gateway exposes /api/startup-lifecycle/compile for partner-scoped founder-goal compilation without starting execution',
      'Gateway exposes /api/startup-lifecycle/persist to store compiled lifecycle DAGs as durable venture, goal, mission, node, edge, and task records without starting execution',
      'Gateway exposes /api/startup-lifecycle/missions/:missionId/schedule, /api/startup-lifecycle/missions/:missionId/nodes/:nodeId/execute, and /api/startup-lifecycle/missions/:missionId/execute-ready for scheduling and bounded ready-node execution',
    ],
    evalRequirement: 'Full Startup Launch Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'founder_off_grid',
    name: 'Founder-off-grid mode',
    state: 'blocked',
    summary:
      'Pilot cannot yet safely continue long-running work while the founder is absent within delegated constraints, checkpoints, recovery, and escalation queues.',
    owner: 'Eval Agent',
    blockers: [
      'Mission runtime, HELM receipts, permission graph, durable agents, browser/computer evidence, and recovery are not complete',
      'No off-grid autonomy mode with budget/risk limits and emergency stop coverage',
      'No controlled founder-off-grid eval has passed',
    ],
    evidence: ['Gate 10 must gate this capability with controlled eval evidence'],
    evalRequirement: 'Founder-Off-Grid Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'polsia_outperformance',
    name: 'Polsia outperformance proof',
    state: 'blocked',
    summary:
      'Pilot has not yet produced sourced competitive parity/outperformance requirements or eval-backed proof that it beats Polsia on real external startup outcomes, governance, evidence, and trust.',
    owner: 'Docs Agent',
    blockers: [
      'Benchmark Lock issue MIN-301 must complete with sourced capability-level teardown',
      'Benchmark-derived requirements must map to phase issues or explicit out-of-scope decisions',
      'Pilot must pass external-world autonomy evals before claiming outperformance',
    ],
    evidence: [
      'MIN-301 blocks later autonomy/product phases until benchmark findings are reflected in implementation and eval requirements',
    ],
    evalRequirement: 'Polsia Outperformance Proof and Production Autonomy Eval Suite',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
]);

export function validateCapabilityRecords(
  records: readonly CapabilityRecord[],
): readonly CapabilityRecord[] {
  const parsed = z.array(CapabilityRecordSchema).parse(records);
  const expectedKeys = new Set<CapabilityKey>(capabilityKeyValues);
  const seenKeys = new Set<CapabilityKey>();

  for (const record of parsed) {
    if (seenKeys.has(record.key)) {
      throw new Error(`Duplicate capability key: ${record.key}`);
    }
    seenKeys.add(record.key);

    if (record.state === 'production_ready' && !record.eval) {
      throw new Error(`Capability ${record.key} cannot be production_ready without eval metadata`);
    }
  }

  for (const key of expectedKeys) {
    if (!seenKeys.has(key)) {
      throw new Error(`Missing required capability key: ${key}`);
    }
  }

  return parsed;
}

export function getCapabilityRecords(): readonly CapabilityRecord[] {
  return capabilityRecords;
}

export function getCapabilityRecord(key: CapabilityKey): CapabilityRecord | undefined {
  return capabilityRecords.find((record) => record.key === key);
}

export function getCapabilitySummary(
  records: readonly CapabilityRecord[] = capabilityRecords,
): CapabilitySummary {
  const byState = Object.fromEntries(capabilityStateValues.map((state) => [state, 0])) as Record<
    CapabilityState,
    number
  >;

  for (const record of records) {
    byState[record.state] = byState[record.state] + 1;
  }

  return CapabilitySummarySchema.parse({
    generatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
    total: records.length,
    productionReady: byState.production_ready,
    byState,
    blockers: records
      .filter((record) => record.state !== 'implemented' && record.state !== 'production_ready')
      .map((record) => ({
        key: record.key,
        state: record.state,
        blockers: record.blockers,
      })),
  });
}

export function renderCapabilityStatusMarkdown(
  records: readonly CapabilityRecord[] = capabilityRecords,
): string {
  const summary = getCapabilitySummary(records);
  const rows = records
    .map((record) =>
      [record.key, record.state, record.owner, record.evalRequirement, record.blockers.join('<br>')]
        .map(escapeMarkdownCell)
        .join(' | '),
    )
    .join('\n');

  return [
    '# Pilot Capability Status',
    '',
    'Source of truth: `packages/shared/src/capabilities/index.ts`.',
    '',
    `Generated at registry revision: ${summary.generatedAt}.`,
    '',
    `Production-ready capabilities: ${summary.productionReady}/${summary.total}.`,
    '',
    '| Capability | State | Owner | Production eval gate | Blockers |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
    'No capability may be described as production-ready unless its state is `production_ready` and it carries passing eval metadata with an evidence reference.',
  ].join('\n');
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

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
      'Pilot is still task/operator oriented; durable venture, goal, mission, action, checkpoint, and rollback state is not the runtime backbone yet.',
    owner: 'Foundation Agent',
    blockers: [
      'No durable venture/goal/mission/action runtime model',
      'No mission DAG compiler with checkpoints and recovery',
      'Current task APIs must remain compatible until mission-backed equivalents pass regression gates',
    ],
    evidence: [
      'Gate 1 must add mission/action lineage before command-center UI can represent real autonomy',
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
      'Non-evaluate HELM helper endpoints still need explicit action-catalog classification',
    ],
    evidence: [
      'Gate 2A adds required_for_elevated receipt persistence to @pilot/helm-client evaluate()',
      'Gateway server wiring installs a global evidence_packs receipt sink for HELM receipts',
      'Tests cover missing sink and sink persistence failure for elevated evaluate actions',
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
      'Regression tests cover gateway and runtime foreign operator rejection',
    ],
    evalRequirement: 'Cross-Workspace Operator Rejection Regression',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'decision_court',
    name: 'Decision Court',
    state: 'stub',
    summary:
      'Decision Court can present heuristic adversarial output, but the production path is not split into heuristic_preview, governed_llm_court, and unavailable states.',
    owner: 'Decision Agent',
    blockers: [
      'Gateway can construct DecisionCourt without a governed LLM provider',
      'Bull, bear, and referee model calls are not persisted with costs, receipts, and evidence',
      'No unavailable response when governed provider is absent',
    ],
    evidence: [
      'Gate 4 must prevent silent degradation from governed adversarial reasoning to heuristics',
    ],
    evalRequirement: 'Decision Court Governed Model Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'skill_registry_runtime',
    name: 'Runtime skill registry',
    state: 'blocked',
    summary:
      'Skill definitions exist, but skills are not yet runtime-loaded, permissioned, version-pinned, eval-gated, and audited through orchestrator/conductor paths.',
    owner: 'Runtime Agent',
    blockers: [
      'Skill registry is not loaded into the main autonomous runtime',
      'Skill manifests are not enforced by Tool Broker and HELM',
      'Skill run records do not yet capture version, risk, permissions, and eval status',
    ],
    evidence: ['Gate 3 must make skills executable capabilities, not prompt/documentation assets'],
    evalRequirement: 'Skill Invocation Governance Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'opportunity_scoring',
    name: 'Opportunity scoring',
    state: 'stub',
    summary:
      'Opportunity scoring is not yet a real evidence-backed startup evaluation across pain, urgency, ICP, channel, competition, founder fit, feasibility, confidence, and citations.',
    owner: 'Tooling Agent',
    blockers: [
      'score_opportunity is not a complete evidence-backed implementation',
      'opportunity_scout is not wired to durable evidence and assumptions',
      'Scoring output is not attached to tool execution, evidence, and audit records',
    ],
    evidence: ['Gate 5 must replace stub scoring with a governed tool implementation'],
    evalRequirement: 'PMF Discovery Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'browser_metadata_connector',
    name: 'Browser metadata connector',
    state: 'scaffolded',
    summary:
      'Browser connector scaffolding can represent browser-related metadata, but it is not a governed read/extract execution path.',
    owner: 'Browser Agent',
    blockers: [
      'No active tab grant model',
      'No screenshot/DOM observation persistence',
      'No browser action timeline or replay sequence',
    ],
    evidence: ['Gate 6 must turn browser metadata into read-only logged-in extraction capability'],
    evalRequirement: 'YC Logged-In Browser Extraction Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'browser_execution',
    name: 'Browser execution',
    state: 'blocked',
    summary:
      'Pilot cannot yet autonomously read and extract from logged-in browser sessions without user copy/paste while preserving credential boundaries.',
    owner: 'Browser Agent',
    blockers: [
      'No governed browser session manager',
      'No read-only session execution bridge',
      'No credential-leakage redaction and evidence replay contract',
    ],
    evidence: [
      'Gate 6 starts with read-only extraction; arbitrary clicking/posting/payments remain out of scope',
    ],
    evalRequirement: 'YC Logged-In Browser Extraction Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'computer_use',
    name: 'Computer and sandbox use',
    state: 'stub',
    summary:
      'operator.computer_use is not yet a real governed terminal, file, IDE, app, or desktop execution substrate with evidence.',
    owner: 'Computer Agent',
    blockers: [
      'Current computer-use path does not perform safe end-to-end action execution',
      'No command/file evidence persistence contract',
      'No local daemon or sandbox authorization model',
    ],
    evidence: ['Gate 7 starts with safe sandbox/local-dev command and file scope'],
    evalRequirement: 'Safe Computer/Sandbox Action Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'a2a_durable_state',
    name: 'Durable A2A state',
    state: 'blocked',
    summary:
      'Agent-to-agent protocol state is not yet durable enough to survive process restart and support long-running founder-off-grid work.',
    owner: 'Foundation Agent',
    blockers: [
      'A2A task/message state is process-local or not uniformly persisted',
      'No restart/reload regression for A2A conversations',
      'No durable handoff linkage to mission/action/evidence records',
    ],
    evidence: ['Gate 1 must add a2a_threads and a2a_messages or equivalent durable models'],
    evalRequirement: 'Multi-Agent Parallel Build Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'subagent_lineage',
    name: 'Subagent proof lineage',
    state: 'blocked',
    summary:
      'Conductor-spawned child work is not yet guaranteed to anchor to parent runs, spawn actions, evidence chains, and audit receipts.',
    owner: 'Runtime Agent',
    blockers: [
      'parent_run_id/root_run_id/spawned_by_action_id lineage is not guaranteed',
      'Proof DAG cannot reliably show parent run -> spawn marker -> child run -> receipts',
      'Lineage tests with concurrent subagents are missing',
    ],
    evidence: ['Gate 1 and Gate 3 must make subagent lineage durable and queryable'],
    evalRequirement: 'Proof DAG Lineage Regression',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'approval_resume',
    name: 'Deterministic approval resume',
    state: 'blocked',
    summary:
      'Approval resume is not yet proven to load only intended parent history in deterministic order while excluding child rows unless requested.',
    owner: 'Foundation Agent',
    blockers: [
      'Task-run history ordering needs deterministic query semantics',
      'Child/subagent rows can pollute parent replay unless explicitly filtered',
      'Resume tests with child rows present are not yet part of the baseline suite',
    ],
    evidence: ['Gate 1 must make approval replay safe before long-running autonomy expands'],
    evalRequirement: 'Approval Resume Isolation Regression',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'evidence_ledger',
    name: 'Evidence ledger',
    state: 'prototype',
    summary:
      'Evidence-like records exist in governance paths, but evidence is not yet a first-class redacted, linked, replayable ledger across tools, browser, computer, artifacts, and decisions.',
    owner: 'Foundation Agent',
    blockers: [
      'No canonical evidence_items/artifacts/action linkage for every meaningful action',
      'No browser/computer observation replay contract',
      'No mandatory evidence persistence before medium/high/restricted action execution',
    ],
    evidence: ['Gate 1 and Gate 2 must make evidence a runtime invariant'],
    evalRequirement: 'HELM Governance Eval and Recovery Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'command_center',
    name: 'Command center UI',
    state: 'blocked',
    summary:
      'The web app has mode pages and governance views, but not a command center backed by real mission/action/evidence/receipt state.',
    owner: 'UI Agent',
    blockers: [
      'Backend truth for mission/action/evidence is not ready',
      'No live mission DAG, agent lanes, receipt chips, evidence drawer, or escalation inbox backed by durable state',
      'Current UI can overstate autonomy unless capability truth is visible',
    ],
    evidence: ['Gate 8 must wait for Gate 1 and Gate 2 backend truth'],
    evalRequirement: 'Command Center Real-State UX Eval',
    updatedAt: CAPABILITY_REGISTRY_UPDATED_AT,
  },
  {
    key: 'startup_lifecycle',
    name: 'Startup lifecycle engine',
    state: 'blocked',
    summary:
      'Pilot has startup-domain surfaces, but no mission compiler that turns founder goals into governed lifecycle DAGs from onboarding through PMF, build, launch, growth, sales, formation, and operations.',
    owner: 'Runtime Agent',
    blockers: [
      'No lifecycle mission templates with required agents, skills, tools, evidence, policy classes, and acceptance criteria',
      'No legal/financial/external communication escalation contract per lifecycle stage',
      'No end-to-end startup launch eval passing against the lifecycle engine',
    ],
    evidence: ['Gate 9 must encode startup lifecycle workflows after runtime and governance gates'],
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

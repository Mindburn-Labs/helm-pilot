# Pilot End-State Execution Plan

Date: 2026-05-05

This is the control artifact for moving Pilot from a governed agent/task prototype to a HELM-governed autonomous startup operating system. It is intentionally conservative: capability claims follow `packages/shared/src/capabilities/index.ts`, `GET /api/capabilities`, and `docs/capabilities.md`.

## Current Observed Repo State

- Shared capability truth exists in `packages/shared/src/capabilities/index.ts` with states, required keys, validation, summaries, and markdown rendering.
- Gateway exposes the read-only registry through `services/gateway/src/routes/capabilities.ts`, mounted at `/api/capabilities` behind the normal `/api/*` authentication path.
- Web exposes `/capabilities` in `apps/web/src/app/capabilities/page.tsx` and reads the API instead of route-local mock state.
- README and roadmap already warn that Pilot is not production-ready as a fully autonomous startup OS.
- Decision Court API still constructs `new DecisionCourt()` without injecting a governed model provider, so it must remain `stub`.
- `operator.computer_use` currently stops at HELM preflight and does not execute a real browser/computer action, so it must remain `stub`.
- `score_opportunity` currently enqueues/marks scoring rather than producing the required evidence-backed scorecard, so it must remain `stub`.
- Skill registry code exists under `packages/shared/src/skills`, but the conductor currently passes `undefined` for `SkillRegistry`, so runtime skill loading must remain `blocked`.
- Subagent spawn rows are partially represented through `task_runs.parent_task_run_id` and spawn evidence packs, but root lineage, spawn action anchoring, and proof DAG queries are not complete.
- A2A protocol files exist under `packages/shared/src/a2a` and gateway A2A routes exist, but durable A2A thread/message storage is not proven.
- Evidence packs and approvals exist, but evidence is not a first-class action/tool/browser/computer/artifact ledger.
- The command-center UI is not yet backed by durable mission/action/evidence/receipt state.

## Capability Matrix

| Capability                   | Current state | Owner            | Production gate                                                |
| ---------------------------- | ------------- | ---------------- | -------------------------------------------------------------- |
| `mission_runtime`            | `blocked`     | Foundation Agent | Full Startup Launch Eval and Multi-Agent Parallel Build Eval   |
| `helm_receipts`              | `implemented` | Governance Agent | HELM Governance Eval                                           |
| `workspace_rbac`             | `blocked`     | Governance Agent | HELM Governance Eval and RBAC regressions                      |
| `operator_scoping`           | `blocked`     | Governance Agent | Cross-workspace operator rejection regression                  |
| `decision_court`             | `stub`        | Decision Agent   | Decision Court Governed Model Eval                             |
| `skill_registry_runtime`     | `blocked`     | Runtime Agent    | Skill Invocation Governance Eval                               |
| `opportunity_scoring`        | `stub`        | Tooling Agent    | PMF Discovery Eval                                             |
| `browser_metadata_connector` | `scaffolded`  | Browser Agent    | YC Logged-In Browser Extraction Eval                           |
| `browser_execution`          | `blocked`     | Browser Agent    | YC Logged-In Browser Extraction Eval                           |
| `computer_use`               | `stub`        | Computer Agent   | Safe Computer/Sandbox Action Eval                              |
| `a2a_durable_state`          | `blocked`     | Foundation Agent | Multi-Agent Parallel Build Eval                                |
| `subagent_lineage`           | `blocked`     | Runtime Agent    | Proof DAG Lineage Regression                                   |
| `approval_resume`            | `blocked`     | Foundation Agent | Approval Resume Isolation Regression                           |
| `evidence_ledger`            | `prototype`   | Foundation Agent | HELM Governance Eval and Recovery Eval                         |
| `command_center`             | `blocked`     | UI Agent         | Command Center Real-State UX Eval                              |
| `startup_lifecycle`          | `blocked`     | Runtime Agent    | Full Startup Launch Eval                                       |
| `founder_off_grid`           | `blocked`     | Eval Agent       | Founder-Off-Grid Eval                                          |
| `polsia_outperformance`      | `blocked`     | Docs Agent       | Polsia Outperformance Proof and production autonomy eval suite |

No row may move to `production_ready` without passing eval metadata in the registry.

## Gate Checklist

- Gate 0, Capability Truth and Claim Control: shared registry, API, UI surface, docs, and tests. Status: in progress in this PR.
- Gate 1, Foundation Correctness: durable mission/task/action/agent/evidence/artifact/A2A lineage; deterministic replay; approval resume isolation.
- Gate 2, Governance Correctness: mandatory HELM receipt sink, fail-closed medium/high/restricted actions, RBAC, operator scoping, policy/document version pinning.
- Gate 3, Runtime Agent and Skill Correctness: agent registry, runtime skill loading, manifest validation, scoped subagents, durable handoffs.
- Gate 4, Decision Court Production Split: `heuristic_preview`, `governed_llm_court`, `unavailable`; governed model calls only in governed mode.
- Gate 5, Tool Broker and Startup Tool Reality: typed manifests, tool execution ledger, stub rejection, real `score_opportunity`, `opportunity_scout` wiring.
- Gate 6, Browser Operation: read-only logged-in browser observation, active tab grants, screenshots, DOM hashes, redaction, replay, receipts.
- Gate 7, Computer/Sandbox Operation: governed safe terminal/file/dev-server actions with evidence and deny rules.
- Gate 8, Command Center UI: real mission/action/evidence/receipt state, agent lanes, evidence drawer, permission graph, capability matrix.
- Gate 9, Startup Lifecycle Engine: mission templates/compiler for founder lifecycle workflows with evidence and escalation conditions.
- Gate 10, Eval Suite and Production Promotion: persisted eval runs, evidence packs, blocker creation, and registry promotion rules.

## PR Sequence

1. Gate 0 truth control: registry hardening, `/api/capabilities`, `/capabilities`, docs, and focused tests.
2. Foundation PR A: add or repair durable lineage fields/tables and deterministic history queries.
3. Foundation PR B: durable A2A threads/messages and approval resume isolation tests.
4. Governance PR A: mandatory HELM receipt sink and fail-closed receipt persistence.
5. Governance PR B: `requireWorkspaceRole`, sensitive-route enforcement, and operator ownership validation.
6. Runtime PR: runtime-loaded skill registry, agent registry, scoped subagent tools, and handoff persistence.
7. Decision PR: court mode split and governed model provider integration.
8. Tooling PR: Tool Broker manifests, tool execution ledger, stub rejection, and real opportunity scoring.
9. Browser PR: read-only browser session observation with evidence/replay.
10. Computer PR: safe sandbox/local command and file actions with HELM and evidence.
11. UI PR: command-center shell backed by durable state from Gates 1 and 2.
12. Lifecycle PR: startup mission compiler and lifecycle templates.
13. Eval PR: eval persistence, promotion rules, HELM Governance eval, and first runtime eval.
14. Docs PR: docs truth pass, public readiness checklist, and eval-linked claims.

## Test Plan

- Gate 0: shared registry tests, capabilities API tests, web capability rendering test, orchestrator stub/prototype capability metadata tests.
- Gate 1: deterministic task-run ordering, parent/child proof DAG queries, restart-durable A2A messages, approval resume child-row exclusion, cross-workspace isolation.
- Gate 2: receipt persistence failure denial, medium/high/restricted fail-closed behavior, sensitive RBAC denial, foreign operator rejection, policy/document version pinning.
- Gate 3: skill registry load, invalid manifest rejection, unpermitted skill denial, subagent scope filtering, parent/subagent evidence lineage.
- Gate 4: court unavailable without provider, heuristic mode labels, governed calls with receipts/costs/evidence, referee failure prevents production decision.
- Gate 5: manifest validation, stub tool rejection outside demo/test mode, idempotent tool execution replay, evidence-backed opportunity scoring.
- Gate 6: YC logged-in read/extract eval, credential redaction, observation replay, screenshot/DOM/evidence persistence.
- Gate 7: allowed command, denied command, denied path, file diff evidence, receipt failure denial.
- Gate 8: navigation, capability-state rendering, mission detail state rendering, receipt/evidence empty/blocked/live/completed states.
- Gate 9: goal-to-mission compiler output, legal/financial/external-comms escalation, controlled startup launch workflow.
- Gate 10: eval result persistence, failing eval blocker creation, promotion-only-after-passing-eval rule.

## Known Blockers

- Decision Court needs a HELM-governed model provider and durable participant/model-call records.
- Browser execution needs a real read-only session execution bridge, active tab grants, evidence, redaction, and replay.
- Computer use needs a safe execution substrate, Tool Broker routing, command/file evidence, and deny policy.
- Subagent lineage needs durable root/parent/spawn action anchoring and proof DAG queries.
- Approval resume needs deterministic ordering and child-row exclusion.
- Skill registry must be loaded into conductor/orchestrator runtime and audited through Tool Broker and HELM.
- HELM receipts need a mandatory global sink and fail-closed persistence.
- Opportunity scoring needs the full evidence-backed scorecard and `opportunity_scout` workflow wiring.
- A2A state must move from protocol/process-local assumptions to durable Postgres storage.
- Workspace RBAC and operatorId scoping need centralized enforcement before broad delegated access.

## Ownership By Agent Area

- Foundation Agent: schemas, migrations, repositories, deterministic history, lineage, A2A durability, evidence/artifact foundations.
- Governance Agent: HelmClient receipt sink, RBAC, operator scoping, policy/action catalogs, audit events.
- Runtime Agent: orchestrator, conductor, agent registry, skill registry loading, subagent scopes, handoffs.
- Decision Agent: Decision Court mode split, governed model calls, court records.
- Tooling Agent: Tool Broker, manifests, `tool_executions`, idempotency, score opportunity, opportunity scout.
- Browser Agent: browser profile/session models, active tab grants, observations, redaction, replay.
- Computer Agent: safe sandbox/local execution, file scope, command evidence, policy enforcement.
- UI Agent: command center shell, mission graph, agent lanes, evidence drawer, receipts, capability matrix.
- Eval Agent: eval schema/harness, evidence packs, promotion rules, blocker creation.
- Docs Agent: capability matrix docs, readiness checklist, docs truth, eval-linked production claims.

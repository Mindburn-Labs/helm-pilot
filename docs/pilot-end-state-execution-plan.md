# Pilot End-State Execution Plan

Date: 2026-05-05

This is the control artifact for moving Pilot from a governed agent/task prototype to a HELM-governed autonomous startup operating system. It is intentionally conservative: capability claims follow `packages/shared/src/capabilities/index.ts`, `GET /api/capabilities`, and `docs/capabilities.md`.

## Current Observed Repo State

- Shared capability truth exists in `packages/shared/src/capabilities/index.ts` with states, required keys, validation, summaries, and markdown rendering.
- Gateway exposes the read-only registry through `services/gateway/src/routes/capabilities.ts`, mounted at `/api/capabilities` behind the normal `/api/*` authentication path.
- Web exposes `/capabilities` in `apps/web/src/app/capabilities/page.tsx` and reads the API instead of route-local mock state.
- README and roadmap already warn that Pilot is not production-ready as a fully autonomous startup OS.
- Decision Court now splits `heuristic_preview`, `governed_llm_court`, and `unavailable`; governed mode requires HELM-governed model-call receipts and no longer silently falls back to fake adversarial output.
- `operator.computer_use` now supports narrow HELM-governed local safe actions for allowlisted terminal commands, project-scoped file reads/writes, and local dev-server status checks with durable `computer_actions` evidence rows. It remains `prototype`, not `production_ready`, because sandbox provider execution, unrestricted desktop automation, and the Safe Computer/Sandbox Action Eval are not complete.
- `/api/command-center` now aggregates real workspace-scoped durable rows for tasks, task runs, actions, tool executions, HELM receipts, approvals, audit events, browser observations, computer actions, agent handoffs, artifacts, an authorization snapshot, and capability truth. The web `/command-center` surface renders that state without route-local demo data.
- Startup lifecycle templates now compile founder goals into governed lifecycle DAG drafts with required agents, skills, tools, evidence, HELM policy classes, escalation conditions, and acceptance criteria. `/api/startup-lifecycle/persist` stores those DAGs as durable venture, goal, mission, node, edge, and task rows. `/api/startup-lifecycle/missions/:missionId/schedule` identifies dependency-ready nodes and queued task rows without dispatching execution. This remains `prototype`, not `production_ready`, because scheduled mission nodes are not dispatched through executable runtime and Full Startup Launch Eval has not passed.
- The Gate 10 eval registry now defines the required production autonomy eval scenarios, durable `eval_runs`/`eval_results`/`eval_evidence_links` records store eval packs, failed evals create blocker tasks, and passed eval packs create promotion-eligibility rows without mutating the capability registry. `/api/evals/execute` runs a narrow control-plane proof check for a registered scenario, but full external-world eval orchestration remains incomplete.
- `score_opportunity` now returns a deterministic evidence-backed scorecard and writes Tool Broker records for autonomous calls, but PMF Discovery Eval has not promoted it to `production_ready`.
- Skill registry code exists under `packages/shared/src/skills`, and Gate 3 wires it into gateway/orchestrator/conductor with audited skill metadata on subagent spawns. It is still not `production_ready` because skills are not fully Tool Broker callable and have not passed the Skill Invocation Governance Eval.
- Subagent spawn rows are partially represented through `task_runs.parent_task_run_id` and spawn evidence packs, but root lineage, spawn action anchoring, and proof DAG queries are not complete.
- A2A protocol files exist under `packages/shared/src/a2a`; gateway A2A routes persist workspace-scoped `a2a_threads` and ordered `a2a_messages`, and `tasks/get` reconstructs state from the database. This is `implemented`, not `production_ready`, because the Multi-Agent Parallel Build Eval has not promoted it and broader mission/action/evidence handoff recovery is incomplete.
- Evidence packs and approvals exist, but evidence is not a first-class action/tool/browser/computer/artifact ledger.
- The command-center UI is a `prototype`: it is backed by durable state, but mission runtime is still blocked and no Command Center Real-State UX Eval has promoted the surface to `production_ready`.

## Capability Matrix

| Capability                   | Current state | Owner            | Production gate                                                |
| ---------------------------- | ------------- | ---------------- | -------------------------------------------------------------- |
| `mission_runtime`            | `blocked`     | Foundation Agent | Full Startup Launch Eval and Multi-Agent Parallel Build Eval   |
| `helm_receipts`              | `implemented` | Governance Agent | HELM Governance Eval                                           |
| `workspace_rbac`             | `implemented` | Governance Agent | HELM Governance Eval and RBAC regressions                      |
| `operator_scoping`           | `implemented` | Governance Agent | Cross-workspace operator rejection regression                  |
| `decision_court`             | `implemented` | Decision Agent   | Decision Court Governed Model Eval                             |
| `skill_registry_runtime`     | `implemented` | Runtime Agent    | Skill Invocation Governance Eval                               |
| `opportunity_scoring`        | `implemented` | Tooling Agent    | PMF Discovery Eval                                             |
| `browser_metadata_connector` | `implemented` | Browser Agent    | YC Logged-In Browser Extraction Eval                           |
| `browser_execution`          | `prototype`   | Browser Agent    | YC Logged-In Browser Extraction Eval                           |
| `computer_use`               | `prototype`   | Computer Agent   | Safe Computer/Sandbox Action Eval                              |
| `a2a_durable_state`          | `implemented` | Foundation Agent | Multi-Agent Parallel Build Eval                                |
| `subagent_lineage`           | `blocked`     | Runtime Agent    | Proof DAG Lineage Regression                                   |
| `approval_resume`            | `blocked`     | Foundation Agent | Approval Resume Isolation Regression                           |
| `evidence_ledger`            | `prototype`   | Foundation Agent | HELM Governance Eval and Recovery Eval                         |
| `command_center`             | `prototype`   | UI Agent         | Command Center Real-State UX Eval                              |
| `startup_lifecycle`          | `prototype`   | Runtime Agent    | Full Startup Launch Eval                                       |
| `founder_off_grid`           | `blocked`     | Eval Agent       | Founder-Off-Grid Eval                                          |
| `polsia_outperformance`      | `blocked`     | Docs Agent       | Polsia Outperformance Proof and production autonomy eval suite |

No row may move to `production_ready` without passing eval metadata in the registry.

## Gate Checklist

- Gate 0, Capability Truth and Claim Control: shared registry, API, UI surface, docs, and tests. Status: merged in PR #11.
- Gate 1, Foundation Correctness: durable mission/task/action/agent/evidence/artifact/A2A lineage; deterministic replay; approval resume isolation. Status: merged in PR #12, still not production-ready.
- Gate 2, Governance Correctness: mandatory HELM receipt sink, fail-closed medium/high/restricted actions, RBAC, operator scoping, policy/document version pinning. Status: merged across PR #13 and PR #14, still not production-ready.
- Gate 3, Runtime Agent and Skill Correctness: agent registry, runtime skill loading, manifest validation, scoped subagents, durable handoffs. Status: merged in PR #15, still not production-ready.
- Gate 4, Decision Court Production Split: `heuristic_preview`, `governed_llm_court`, `unavailable`; governed model calls only in governed mode. Status: merged in PR #16, still not production-ready.
- Gate 5, Tool Broker and Startup Tool Reality: typed manifests, tool execution ledger, stub rejection, real `score_opportunity`, `opportunity_scout` wiring. Status: merged in PR #17, still not production-ready.
- Gate 6, Browser Operation: read-only logged-in browser sessions, active-tab grants, browser actions, screenshots, DOM hashes, redaction, replay, receipts. Status: merged in PR #18, prototype until eval-backed.
- Gate 7, Computer/Sandbox Operation: governed safe terminal/file/dev-server actions with evidence and deny rules. Status: merged in PR #19, prototype until eval-backed.
- Gate 8, Command Center UI: real task/action/evidence/receipt/browser/computer/artifact/audit/approval state, agent lanes, evidence drawer, browser/computer replay rows, permission graph snapshot, escalation queue, and capability matrix. Status: merged in PR #20, prototype until eval-backed.
- Gate 9, Startup Lifecycle Engine: mission templates/compiler for founder lifecycle workflows with required agents, skills, tools, evidence, policy classes, escalation conditions, and acceptance criteria, plus durable venture/goal/mission/node/edge/task persistence and non-executing ready-node scheduling. Status: merged in PR #21 plus follow-up persistence/scheduling PR, prototype until eval-backed execution exists.
- Gate 10, Eval Suite and Production Promotion: production eval scenario registry, durable eval run/result/evidence records, failed-eval blocker tasks, promotion eligibility records, promotion guard, and narrow control-plane proof-check execution are present. Status: merged across PR #22 and PR #23; full external-world eval orchestration remains incomplete.

## PR Sequence

1. Gate 0 truth control: registry hardening, `/api/capabilities`, `/capabilities`, docs, and focused tests.
2. Foundation PR A: add or repair durable lineage fields/tables and deterministic history queries.
3. Foundation PR B: durable A2A threads/messages and approval resume isolation tests.
4. Governance PR A: mandatory HELM receipt sink and fail-closed receipt persistence.
5. Governance PR B: `requireWorkspaceRole`, sensitive-route enforcement, and operator ownership validation.
6. Runtime PR: runtime-loaded skill registry, agent registry, scoped subagent tools, and handoff persistence.
7. Decision PR: court mode split and governed model provider integration.
8. Tooling PR: Tool Broker manifests, tool execution ledger, stub rejection, and real opportunity scoring.
9. Browser PR: read-only browser session actions and observations with evidence/replay.
10. Computer PR: safe sandbox/local command and file actions with HELM and evidence.
11. UI PR: command-center shell backed by durable state from Gates 1 and 2.
12. Lifecycle PR: startup mission compiler, lifecycle templates, and durable DAG persistence.
13. Eval PR: eval persistence, promotion rules, HELM Governance eval, and first runtime eval proof checks.
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
- Gate 9: goal-to-mission compiler output, mission DAG persistence, ready-node scheduling, legal/financial/external-comms escalation, controlled startup launch workflow.
- Gate 10: eval result persistence, failing eval blocker creation, promotion-only-after-passing-eval rule.

## Known Blockers

- Decision Court needs the governed model eval and first-class evidence/artifact ledger links before it can become `production_ready`.
- Browser execution needs a productized browser extension/bridge and the YC logged-in extraction eval before it can become `production_ready`.
- Computer use has a narrow safe local execution substrate, Tool Broker routing, command/file evidence, and deny policy; it still needs sandbox provider execution and the Safe Computer/Sandbox Action Eval before production-ready claims.
- Subagent lineage needs durable root/parent/spawn action anchoring and proof DAG queries.
- Approval resume needs deterministic ordering and child-row exclusion.
- Skills must move from runtime-loaded prompt packages to fully Tool Broker governed callable capabilities, then pass the Skill Invocation Governance Eval.
- HELM receipts have mandatory elevated-action sink enforcement, but still need HELM Governance Eval promotion before production-ready claims.
- Opportunity scoring needs PMF Discovery Eval promotion and first-class Evidence Center artifact packs before production-ready claims.
- A2A gateway task state is durable in Postgres, but multi-agent mission handoff recovery still needs eval coverage before production-ready claims.
- Mission runtime has durable venture, goal, mission, node, edge, task, and mission-task rows, but still needs executable scheduling, checkpoint, recovery, and replay semantics.
- Workspace RBAC and operatorId scoping need centralized enforcement before broad delegated access.

## Ownership By Agent Area

- Foundation Agent: schemas, migrations, repositories, deterministic history, lineage, A2A durability, evidence/artifact foundations.
- Governance Agent: HelmClient receipt sink, RBAC, operator scoping, policy/action catalogs, audit events.
- Runtime Agent: orchestrator, conductor, agent registry, skill registry loading, subagent scopes, handoffs.
- Decision Agent: Decision Court mode split, governed model calls, court records.
- Tooling Agent: Tool Broker, manifests, `tool_executions`, idempotency, score opportunity, opportunity scout.
- Browser Agent: browser profile/session models, active tab grants, browser actions, observations, redaction, replay.
- Computer Agent: safe sandbox/local execution, file scope, command evidence, policy enforcement.
- UI Agent: command center shell, mission graph, agent lanes, evidence drawer, receipts, capability matrix.
- Eval Agent: eval schema/harness, evidence packs, promotion rules, blocker creation.
- Docs Agent: capability matrix docs, readiness checklist, docs truth, eval-linked production claims.

# Pilot Capability Matrix

Source of truth: `packages/shared/src/capabilities/index.ts`.

This document is a human-readable Gate 0 mirror. The API and UI must read the shared registry; production claims must not be made from this document alone.

## Capability States

- `implemented`: working in runtime, but not yet eval-promoted to production-ready.
- `prototype`: partially working, but missing mandatory production invariants.
- `scaffolded`: shape or metadata exists, but there is no real end-to-end capability.
- `stub`: returns placeholder, heuristic, preflight-only, or queued behavior that does not satisfy the stated product capability.
- `blocked`: known blocker prevents honest runtime use.
- `production_ready`: passing eval metadata and evidence are attached in the shared registry.

## Current Matrix

| Capability                   | State         | Required eval                                                  | Current blocker                                                                            |
| ---------------------------- | ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `mission_runtime`            | `blocked`     | Full Startup Launch Eval and Multi-Agent Parallel Build Eval   | Durable mission/action runtime is not the backbone yet                                     |
| `helm_receipts`              | `implemented` | HELM Governance Eval                                           | HELM Governance Eval has not promoted the capability to production_ready                   |
| `workspace_rbac`             | `implemented` | HELM Governance Eval and RBAC regressions                      | HELM Governance Eval has not promoted the capability to production_ready                   |
| `operator_scoping`           | `implemented` | Cross-workspace operator rejection regression                  | Cross-workspace operator rejection regression has not promoted the capability              |
| `decision_court`             | `stub`        | Decision Court Governed Model Eval                             | API can construct Decision Court without a governed LLM provider                           |
| `skill_registry_runtime`     | `blocked`     | Skill Invocation Governance Eval                               | Skill registry is not loaded into conductor/orchestrator runtime                           |
| `opportunity_scoring`        | `stub`        | PMF Discovery Eval                                             | `score_opportunity` is not a complete evidence-backed implementation                       |
| `browser_metadata_connector` | `scaffolded`  | YC Logged-In Browser Extraction Eval                           | Browser metadata is not a governed read/extract path                                       |
| `browser_execution`          | `blocked`     | YC Logged-In Browser Extraction Eval                           | No governed logged-in browser read/extract session manager                                 |
| `computer_use`               | `stub`        | Safe Computer/Sandbox Action Eval                              | `operator.computer_use` does not perform real safe end-to-end action execution             |
| `a2a_durable_state`          | `blocked`     | Multi-Agent Parallel Build Eval                                | A2A task/message state is not uniformly durable                                            |
| `subagent_lineage`           | `blocked`     | Proof DAG Lineage Regression                                   | Child work is not guaranteed to anchor to parent runs and spawn actions                    |
| `approval_resume`            | `blocked`     | Approval Resume Isolation Regression                           | Resume is not proven to exclude child rows unless requested                                |
| `evidence_ledger`            | `prototype`   | HELM Governance Eval and Recovery Eval                         | Evidence is not first-class across tools, browser, computer, artifacts, and decisions      |
| `command_center`             | `blocked`     | Command Center Real-State UX Eval                              | UI is not backed by durable mission/action/evidence/receipt state                          |
| `startup_lifecycle`          | `blocked`     | Full Startup Launch Eval                                       | No mission compiler for startup lifecycle DAGs                                             |
| `founder_off_grid`           | `blocked`     | Founder-Off-Grid Eval                                          | Long-running delegated work lacks complete runtime, governance, recovery, and eval backing |
| `polsia_outperformance`      | `blocked`     | Polsia Outperformance Proof and production autonomy eval suite | External-world outperformance proof is incomplete                                          |

Current production-ready count: `0/18`.

## Enforcement Rule

A capability can move to `production_ready` only when the shared registry record includes passing eval metadata with an evidence reference. Docs, UI labels, API responses, and README copy must treat every other state as non-production.

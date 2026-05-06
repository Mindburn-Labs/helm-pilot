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

| Capability                   | State         | Required eval                                                  | Current blocker                                                                                                                  |
| ---------------------------- | ------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `mission_runtime`            | `prototype`   | Full Startup Launch Eval and Multi-Agent Parallel Build Eval   | Mission execution is explicit bounded ready-node dispatch, not production-ready founder-off-grid DAG automation                  |
| `helm_receipts`              | `implemented` | HELM Governance Eval                                           | HELM Governance Eval has not promoted the capability to production_ready                                                         |
| `workspace_rbac`             | `implemented` | HELM Governance Eval and RBAC regressions                      | HELM Governance Eval has not promoted the capability to production_ready                                                         |
| `operator_scoping`           | `implemented` | Cross-workspace operator rejection regression                  | Cross-workspace operator rejection regression has not promoted the capability                                                    |
| `decision_court`             | `implemented` | Decision Court Governed Model Eval                             | Decision Court Governed Model Eval has not promoted the capability to production_ready                                           |
| `skill_registry_runtime`     | `implemented` | Skill Invocation Governance Eval                               | Skill Invocation Governance Eval has not promoted the capability to production_ready                                             |
| `opportunity_scoring`        | `implemented` | PMF Discovery Eval                                             | PMF Discovery Eval has not promoted the capability to production_ready                                                           |
| `browser_metadata_connector` | `implemented` | YC Logged-In Browser Extraction Eval                           | YC Logged-In Browser Extraction Eval has not promoted the capability to production_ready                                         |
| `browser_execution`          | `prototype`   | YC Logged-In Browser Extraction Eval                           | Browser extension/bridge and YC logged-in extraction eval are not complete                                                       |
| `computer_use`               | `prototype`   | Safe Computer/Sandbox Action Eval                              | Safe local command/file/dev-server actions exist, but sandbox provider execution and eval promotion are incomplete               |
| `a2a_durable_state`          | `implemented` | Multi-Agent Parallel Build Eval                                | Multi-Agent Parallel Build Eval has not promoted the capability to production_ready                                              |
| `subagent_lineage`           | `implemented` | Proof DAG Lineage Regression                                   | Proof DAG Lineage Regression has not promoted the capability to production_ready                                                 |
| `approval_resume`            | `implemented` | Approval Resume Isolation Regression                           | Approval Resume Isolation Regression has not promoted the capability to production_ready                                         |
| `evidence_ledger`            | `prototype`   | HELM Governance Eval and Recovery Eval                         | Core receipt/Tool Broker/browser/computer/connector/pipeline/ingestion/artifact/lifecycle/eval writers append evidence_items, replay endpoints exist, and Tool Broker blocks elevated tools without HELM metadata or evidence persistence, but non-workspace scheduled ingestion and legacy writer coverage is incomplete |
| `command_center`             | `prototype`   | Command Center Real-State UX Eval                              | Real task/action/evidence/receipt/browser/computer rows are visible, but mission DAG autonomy is still prototype-only            |
| `startup_lifecycle`          | `prototype`   | Full Startup Launch Eval                                       | Lifecycle execution is explicit bounded dispatch with checkpoint/recovery/rollback controls, not production-ready automation     |
| `founder_off_grid`           | `blocked`     | Founder-Off-Grid Eval                                          | Long-running delegated work lacks complete runtime, governance, recovery, and eval backing                                       |
| `polsia_outperformance`      | `blocked`     | Polsia Outperformance Proof and production autonomy eval suite | External-world outperformance proof is incomplete                                                                                |

Current production-ready count: `0/18`.

## Enforcement Rule

A capability can move to `production_ready` only when the shared registry record includes passing eval metadata with an evidence reference. Docs, UI labels, API responses, and README copy must treat every other state as non-production.

# Pilot Capability Status

Source of truth: `packages/shared/src/capabilities/index.ts`.

Registry revision: `2026-05-05T00:00:00.000Z`.

Production-ready capabilities: `0/18`.

This Gate 0 status document is intentionally conservative. Pilot must not claim production autonomous startup OS readiness until a capability is marked `production_ready` by the registry and includes passing eval metadata with an evidence reference.

| Capability                   | State         | Production eval gate                                           | Primary blocker                                                                                                        |
| ---------------------------- | ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mission_runtime`            | `blocked`     | Full Startup Launch Eval and Multi-Agent Parallel Build Eval   | No mission node execution dispatcher over scheduled mission nodes                                                      |
| `helm_receipts`              | `implemented` | HELM Governance Eval                                           | HELM Governance Eval has not promoted the capability to production_ready                                               |
| `workspace_rbac`             | `implemented` | HELM Governance Eval and Security RBAC Regression Suite        | HELM Governance Eval has not promoted the capability to production_ready                                               |
| `operator_scoping`           | `implemented` | Cross-Workspace Operator Rejection Regression                  | Cross-workspace operator rejection regression has not promoted the capability                                          |
| `decision_court`             | `implemented` | Decision Court Governed Model Eval                             | Decision Court Governed Model Eval has not promoted the capability to production_ready                                 |
| `skill_registry_runtime`     | `implemented` | Skill Invocation Governance Eval                               | Skill Invocation Governance Eval has not promoted the capability to production_ready                                   |
| `opportunity_scoring`        | `implemented` | PMF Discovery Eval                                             | PMF Discovery Eval has not promoted the capability to production_ready                                                 |
| `browser_metadata_connector` | `implemented` | YC Logged-In Browser Extraction Eval                           | YC Logged-In Browser Extraction Eval has not promoted the capability to production_ready                               |
| `browser_execution`          | `prototype`   | YC Logged-In Browser Extraction Eval                           | Browser extension/bridge and YC logged-in extraction eval are not complete                                             |
| `computer_use`               | `prototype`   | Safe Computer/Sandbox Action Eval                              | Safe local command/file/dev-server actions exist, but sandbox provider execution and eval promotion are incomplete     |
| `a2a_durable_state`          | `blocked`     | Multi-Agent Parallel Build Eval                                | A2A task/message state is not uniformly durable                                                                        |
| `subagent_lineage`           | `blocked`     | Proof DAG Lineage Regression                                   | Child work is not guaranteed to anchor to parent runs and spawn actions                                                |
| `approval_resume`            | `blocked`     | Approval Resume Isolation Regression                           | Resume is not proven to exclude child rows unless explicitly requested                                                 |
| `evidence_ledger`            | `prototype`   | HELM Governance Eval and Recovery Eval                         | Evidence is not first-class across tools, browser, computer, artifacts, and decisions                                  |
| `command_center`             | `prototype`   | Command Center Real-State UX Eval                              | Real task/action/evidence/receipt/browser/computer rows are visible, but mission DAG autonomy is still blocked         |
| `startup_lifecycle`          | `prototype`   | Full Startup Launch Eval                                       | Founder goals compile and persist into lifecycle DAGs, but mission runtime execution and eval promotion are incomplete |
| `founder_off_grid`           | `blocked`     | Founder-Off-Grid Eval                                          | Long-running delegated work lacks complete runtime, governance, recovery, and eval backing                             |
| `polsia_outperformance`      | `blocked`     | Polsia Outperformance Proof and Production Autonomy Eval Suite | Benchmark Lock `MIN-301` and external-world proof are incomplete                                                       |

# Pilot Capability Status

Source of truth: `packages/shared/src/capabilities/index.ts`.

Registry revision: `2026-05-05T00:00:00.000Z`.

Production-ready capabilities: `0/18`.

This Gate 0 status document is intentionally conservative. Pilot must not claim production autonomous startup OS readiness until a capability is marked `production_ready` by the registry and includes passing eval metadata with an evidence reference.

| Capability                   | State        | Production eval gate                                           | Primary blocker                                                                            |
| ---------------------------- | ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `mission_runtime`            | `blocked`    | Full Startup Launch Eval and Multi-Agent Parallel Build Eval   | No durable venture/goal/mission/action runtime model                                       |
| `helm_receipts`              | `prototype`  | HELM Governance Eval                                           | No global mandatory receipt sink for every `HelmClient.evaluate()` path                    |
| `workspace_rbac`             | `blocked`    | HELM Governance Eval and Security RBAC Regression Suite        | Sensitive workspace mutations are not uniformly role-gated                                 |
| `operator_scoping`           | `blocked`    | Cross-Workspace Operator Rejection Regression                  | `operatorId` ownership validation is not centralized                                       |
| `decision_court`             | `stub`       | Decision Court Governed Model Eval                             | Gateway can construct Decision Court without a governed LLM provider                       |
| `skill_registry_runtime`     | `blocked`    | Skill Invocation Governance Eval                               | Skill registry is not loaded into the main autonomous runtime                              |
| `opportunity_scoring`        | `stub`       | PMF Discovery Eval                                             | `score_opportunity` is not a complete evidence-backed implementation                       |
| `browser_metadata_connector` | `scaffolded` | YC Logged-In Browser Extraction Eval                           | Browser metadata is not a governed read/extract execution path                             |
| `browser_execution`          | `blocked`    | YC Logged-In Browser Extraction Eval                           | No governed logged-in browser read/extract session manager                                 |
| `computer_use`               | `stub`       | Safe Computer/Sandbox Action Eval                              | `operator.computer_use` does not perform real safe end-to-end action execution             |
| `a2a_durable_state`          | `blocked`    | Multi-Agent Parallel Build Eval                                | A2A task/message state is not uniformly durable                                            |
| `subagent_lineage`           | `blocked`    | Proof DAG Lineage Regression                                   | Child work is not guaranteed to anchor to parent runs and spawn actions                    |
| `approval_resume`            | `blocked`    | Approval Resume Isolation Regression                           | Resume is not proven to exclude child rows unless explicitly requested                     |
| `evidence_ledger`            | `prototype`  | HELM Governance Eval and Recovery Eval                         | Evidence is not first-class across tools, browser, computer, artifacts, and decisions      |
| `command_center`             | `blocked`    | Command Center Real-State UX Eval                              | UI is not backed by durable mission/action/evidence/receipt state                          |
| `startup_lifecycle`          | `blocked`    | Full Startup Launch Eval                                       | No mission compiler for startup lifecycle DAGs                                             |
| `founder_off_grid`           | `blocked`    | Founder-Off-Grid Eval                                          | Long-running delegated work lacks complete runtime, governance, recovery, and eval backing |
| `polsia_outperformance`      | `blocked`    | Polsia Outperformance Proof and Production Autonomy Eval Suite | Benchmark Lock `MIN-301` and external-world proof are incomplete                           |

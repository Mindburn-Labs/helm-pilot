# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 13 (v1.0.0-rc)

### Added

- **Connector token refresh** (Track B): pg-boss tick + per-grant job queue, advisory-lock serialization, 30-min proactive refresh window, 3-attempt permanent-failure threshold, Telegram re-auth notifier, `GET /api/connectors/reauth-status` endpoint. Migration `0011_connector_refresh_state.sql`.
- **CI/CD hardening** (Track E): CycloneDX SBOM + SLSA L3 provenance via `actions/attest-build-provenance@v2`, Trivy CRITICAL/HIGH vulnerability gate, gitleaks job, license-audit script, weekly `restore-drill.yml` cron, staging smoke-test gate before prod promotion.
- **Observability deepening** (Track D): 5 new Prometheus alerts (`HelmUnavailable`, `DbPoolSaturated`, `BackupMissedTwoRuns`, `TenantOverBudget`, `ConductorSpawnFailureRate`), Alertmanager config with Telegram + SMTP receivers + inhibit rule for HELM outage, OpenTelemetry GenAI semantic-conventions wrapper (`withAgentSpan`, `withToolSpan`, `setLlmUsageAttributes`, `setHelmAttributes`), GenAI-focused Grafana dashboard, Sentry + OTel env-var documentation.
- **Real Fly.io Machines API v2 provider** (Track A): `FlyMachinesClient` with Zod-validated responses + typed `FlyApiError`, `FlyProvider` dual-mode (mock for dev / real for prod), blue-green rollback via `image_ref.tag` lookup. Vercel + DigitalOcean deferred to Phase 14.
- **Web dashboard mode pages + governance DAG** (Tracks C1+C2): `/decide`, `/launch`, `/apply`, `/governance` pages; `GET /api/governance/proofgraph/:taskId` recursive-CTE endpoint; pure-CSS DAG tree viewer (no new deps); `scripts/dump-proof-graph.ts` CLI emitting Graphviz DOT or JSON.
- **Mini App re-auth banner** (Track C3): Polls `getReauthStatus(workspaceId)` every 60s; per-grant reconnect CTAs with session-local dismiss.
- **Telegram bot orchestrator wiring** (Track C4): `/chat` free-text routes to `orchestrator.runTask`; new `/conduct <prompt>` command routes to `orchestrator.runConduct` (Phase 12 subagents). `BotDeps` gains `runTask?` and `runConduct?` callbacks.
- **E2E test coverage** (Track F1): `e2e/tests/{conduct,governance-dag,tenancy-isolation}.spec.ts` — 16 new cases lifting coverage from 6 to 9 specs.
- **k6 baseline load test** (Track F2): `loadtests/k6/founder-50.js` — 50-VU ramp with p99<500ms / error-rate<1% / checks>99% SLO thresholds.
- **Phase 13.5 — HELM evaluate() client cutover**: `HelmClient.evaluate()` real implementation gated on `HELM_EVALUATE_ENABLED=1`; migration `0012_reverify_spawn_receipts.sql` clears `verified_at` on Path-A SUBAGENT_SPAWN rows so they re-sign after sidecar upgrade.

### Deferred to Phase 14

- Vercel + DigitalOcean launch providers
- Playwright docker-stack shared fixture
- Interactive DAG replay (re-execute node with modified inputs)
- Mini App full per-mode tabs
- `decision_court_run` tool wrapper
- Four more built-in subagents (build_engineer, launch_captain, application_drafter, SMTM-ops wrappers)

### Upstream dependency

- `helm-oss` must ship `POST /api/v1/guardian/evaluate` (target v0.3.1). Client-side already wired; one env-var flip cuts over once the upstream endpoint lands.

## [0.1.0] - 2026-04-16

### Added

- HELM governance sidecar integration (fail-closed policy enforcement)
- Multi-tenant workspace isolation with encrypted secrets vault
- Tenancy lint rule — blocks unscoped DB queries on workspace-scoped tables
- Scoring engine with configurable rubrics and LLM-as-judge evaluation
- Semantic deduplication via pgvector embeddings
- HDBSCAN clustering for knowledge organization
- Decision court (multi-judge deliberation with evidence-based verdicts)
- Build engine (structured task decomposition and execution)
- Launch engine (go-to-market campaign orchestration)
- Apply engine (automated job application pipeline)
- 13-source intelligence pipeline (web research, scraping, enrichment)
- `founder_ops` HELM policy pack (cost ceilings, tool allowlists, PII guards)
- Magic-link and Telegram authentication
- Playwright E2E test suite
- Prometheus metrics and alerting rules
- Fly.io deployment configuration (gateway + HELM sidecar)
- Docker multi-stage build with non-root user

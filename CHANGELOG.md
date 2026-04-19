# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — Phase 14 (SOTA-100% release) — 2026-04-19

### Added

- **Track A — MCP consumer + provider.** `@helm-pilot/shared/mcp` ships an MCP 2025-11-25 `McpClient` over stdio + HTTP transports plus an `McpServerRegistry` that resolves names from `packs/mcp/servers.json` (env-overridable). Subagents declaring `mcp_servers:` in frontmatter now actually load — every upstream tool is namespaced `mcp.<server>.<tool>` inside the scoped tool registry, governed end-to-end by HELM. New `services/mcp-server/` workspace exposes Pilot's own DB-only tool whitelist (`list_opportunities`, `score_opportunity`, `search_knowledge`, `get_workspace_context`, `create_task`, `create_artifact`) as a bearer-token-authenticated MCP server at `:3200`. Enable with `docker compose --profile mcp up`. 23 new unit tests (13 consumer + 10 provider).
- **Track B — Compliance overlays.** Workspaces opt in to any of 5 regulated frameworks (SOC 2 Type II, HIPAA Covered Entity, PCI DSS 4, EU AI Act High-Risk, ISO 42001). Migration `0013_compliance_frameworks.sql` + `compliance_attestations` table. Gateway routes: `GET/POST/DELETE /api/compliance/frameworks`, `POST /api/compliance/attest`, `GET /api/compliance/attestations`. Web dashboard `/compliance` lets founders toggle frameworks and generate HELM-signed attestation bundles in one click.
- **Track C — Sandbox abstraction.** New `@helm-pilot/sandbox` package with a `SandboxProvider` interface, an `E2bSandboxProvider` (optional peer dep `@e2b/code-interpreter`), and a fail-closed `NoopSandboxProvider` default. `createSandbox()` factory honors `E2B_API_KEY`. Build mode can now safely execute generated code inside a sandbox before committing.
- **Track D — Observability (Langfuse + Braintrust).** `@helm-pilot/shared/observability/langfuse` shadows OTel agent + tool spans into Langfuse when `LANGFUSE_*` env vars are set. `@helm-pilot/shared/eval/braintrust` wraps inference calls in Braintrust experiments when `BRAINTRUST_*` is set. Both are optional dynamic imports — no-op shim when unconfigured.
- **Track E — Skills abstraction (`SKILL.md` loader).** `@helm-pilot/shared/skills` parses repo-bundled + user-override skill folders. SubagentLoop matches skills against the natural-language input and prepends matched bodies to the child's system prompt (capped at 3). 6 bundled skills shipped under `packs/skills/`.
- **Track F — helm-oss endpoint integration.** `HelmClient` now wraps 10 helm-oss endpoints. Web dashboard surfaces `/governance/budget` (live HELM spend ceilings + alerts + proof-graph merkle root) and `/governance/cost` (per-subagent USD attribution + per-bucket allocation gauges).
- **Track G — Threat scanning.** `@helm-pilot/shared/sanitizers/scrapling` strips zero-width characters, bidirectional overrides (Trojan Source), UTF-8 BOM, and NFKC-normalizes homoglyphs from every scrapling fetch. `packages/shared/src/__tests__/owasp-llm-top10.test.ts` exercises 10 OWASP threat classes (LLM01-LLM10). New `.github/workflows/security.yml` runs sanitizer + OWASP + MCP transport + provider-auth tests on every PR + daily 03:17 UTC cron + gitleaks scan over full git history.
- **Track H — Anthropic prompt caching.** `cache_control: {type:"ephemeral"}` injected on stable system-prompt + operator-goal + tool-list prefixes when running against Claude Sonnet 4. New Prometheus metrics `helm_pilot_llm_cache_hit_total` + `helm_pilot_llm_cache_savings_usd_total` and a Grafana panel.
- **Track L — Live conduct streaming.** New in-memory `ConductEventStream` hub publishes 8 event types (iteration boundaries, action verdicts, subagent spawns, task verdict). Gateway exposes `GET /api/events/conduct/:taskId` SSE. Web `/governance/live/[taskId]` page renders live agent reasoning via native EventSource. 5 new unit tests.

### Changed

- HELM Pilot version bumped to **1.1.0**.

### Deferred to Phase 15

- A2A protocol (Track J) — Linux-Foundation cross-agent interop.
- Connector breadth (Track I) — Slack, Notion, Linear class upgrade, Calendar, Stripe, HubSpot.
- Vision / multimodal (Track K) — image + PDF ingestion to memory.
- L2 conformance certification (Track M).
- Full retention auto-purge cron job for compliance frameworks (data persistence already complete).
- Per-tool obligation creation hook on PHI reads.

## [1.0.0] — Phase 13 — 2026-04-19

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

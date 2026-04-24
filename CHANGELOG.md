# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — Phase 16 (maturity) — 2026-04-24

Ships all four Phase 16 tracks: long-running autonomous execution,
cost attribution, skills marketplace client, pluggable inference. Plus
v1.2.2 polish deferrals (docker-compose A2A block, .env.example Ollama
section) folded in.

### Added

- **Track N — Long-running autonomous execution (8-hour target).**
  Migration `0014_long_running_checkpoints.sql` adds `task_runs.checkpoint_state jsonb` + `task_runs.last_checkpoint_at timestamptz` + `task_runs.watchdog_alerted_at timestamptz` + partial index `task_runs_running_checkpoint_idx`. New `services/orchestrator/src/checkpoint.ts` exports `writeCheckpoint` / `loadCheckpoint` / `findStalledRuns` / `markWatchdogAlerted` — all fail-soft. AgentLoop snapshots actions + runUsage + runCost every 10 iterations (100-action trailing window keeps row size bounded). Crashed orchestrator can rehydrate at boot.
- **Track O — Cost attribution dashboard.** `infra/monitoring/grafana/dashboards/cost-attribution.json` — total 7-day USD spend, cache savings, linear monthly burn forecast, cache hit rate, time-series per workspace + per subagent, per-provider bar gauge, top-10 subagents table.
- **Track P — Skills marketplace client.** `scripts/install-skill.ts` + `npm run skills:install -- <name>`. Fetches `<HELM_SKILLS_REGISTRY_URL>/<name>.tar.gz` + `.sha256`, verifies digest, extracts to `~/.helm-pilot/skills/<name>/`, writes `.install.json`. Uses system `tar` (no new npm dep).
- **Track Q — Ollama inference provider.** `@helm-pilot/shared/llm/OllamaProvider`. POSTs `/api/chat`; maps `eval_count`/`prompt_eval_count` → `LlmUsage`. Implements full `LlmProvider` interface including `completeStructured`. `createLlmProvider()` branches on `OLLAMA_BASE_URL` + `OLLAMA_MODEL` when no cloud key is set. Matches Microsoft Agent Framework v1.0's self-hosted-inference parity.

### Changed

- HELM Pilot version 1.2.1 → **1.3.0**.
- `LlmConfig` interface gains `ollamaBaseUrl?` + `ollamaModel?` (backward compatible).
- `.env.example` adds Ollama + skills-registry sections.
- `infra/docker/docker-compose.yml` `helm-pilot` service gains commented-out A2A + Ollama env blocks so operators can enable them inline.
- Root `package.json` scripts: `certify:subagent`, `skills:install`.

### Deferred

- A2A streaming + push notifications — Track J v2.
- DB-backed A2A task persistence — v1.3.1.
- `subagents_certifications` persistent table — awaits real certification cadence.
- README front-door rewrite — v1.3.1 polish.

## [1.2.1] — Phase 15 remediation — 2026-04-24

Closes the functional + security gaps identified after v1.2.0. No breaking
changes; purely additive hardening + real dispatch where v1.2.0 shipped stubs.

### Fixed

- **A2A server now dispatches into the governed orchestrator.** `POST /a2a`
  `tasks/send` previously echoed a canned placeholder. It now persists a
  `tasks` row, calls `Orchestrator.runConduct()`, and maps
  `AgentRunResult.status` → A2A `TaskState` (`completed` / `input-required` /
  `failed`). Requires `PILOT_A2A_WORKSPACE_ID` env to be set; refuses
  dispatch otherwise. Claude Code, Microsoft Agent Framework, and Gemini CLI
  peers that discover Pilot via `/.well-known/agent-card.json` now receive
  real conduct results.
- **L1 conformance validation runs on every evidence-pack write.** Wired into
  `Conductor.writeSpawnEvidencePack()` (SUBAGENT_SPAWN packs) and
  `AgentLoop.persistAction()` (LLM_INFERENCE mirror). Error-level findings
  are logged via pino; warnings expected until upstream HELM signatures flip
  on.

### Added

- **`scripts/certify-subagent.ts`** + `npm run certify:subagent -- <name>`
  CLI. Read-only audit that queries `evidence_packs` by subagent principal
  suffix, runs `validateL1Batch` + `validateL2`, prints pass/fail summary,
  exits 0 on clean / 1 on any error finding. Suitable for CI + ad-hoc.
- **`services/orchestrator/src/sanitize-output.ts`** — `sanitizeToolOutput`
  runs every untrusted tool's result through `sanitizeScrapingOutput` (zero-
  width / bidi / NFKC). 20-tool trusted-whitelist bypasses (Pilot-native +
  DB-backed). Applied inside `ToolRegistry.execute()` before return.
  Tainted results carry a `_sanitizerWarnings` field so HELM sees tainted-
  input provenance in the DAG viewer.
- **Gateway A2A integration tests** — 9 tests covering agent-card discovery,
  bearer-auth failure modes, `tasks/send` happy path, `tasks/get` not-found,
  malformed JSON, unknown method, missing workspace env.
- **Stripe + Calendar + HubSpot unit tests** — 12 tests (was 0 in v1.2.0).
- **6 sanitize-output tests** covering trusted whitelist bypass, bidi taint,
  nested walk, short-identifier preservation, non-string pass-through,
  empty result.
- **`.env.example`** — new A2A + pdf-parse sections with operator-ready
  placeholders (`PILOT_A2A_TOKEN`, `PILOT_A2A_WORKSPACE_ID`,
  `PILOT_A2A_PUBLIC_URL`, `PILOT_A2A_ORGANIZATION`, pdf-parse install note).

### Changed

- HELM Pilot version 1.2.0 → **1.2.1**.

### Deferred to v1.2.2

- README + `infra/docker/docker-compose.yml` A2A env block.
- Subagent-iteration events surfacing to parent SSE stream.

## [1.2.0] — Phase 15 — 2026-04-20

### Added

- **Track I — Connector breadth (6 new / upgraded).** Slack (`slack_post`, `slack_list_channels`, `slack_search`), Notion (`notion_search`, `notion_create_page`, `notion_get_page`), Linear (class wired into ToolRegistry: `linear_create_issue`, `linear_list_issues`, `linear_list_teams`, `linear_update_issue`), Stripe read-only (`stripe_list_customers`, `stripe_recent_charges`, `stripe_balance`), Google Calendar (`calendar_list_events`, `calendar_create_event`), HubSpot (`hubspot_list_contacts`, `hubspot_create_contact`, `hubspot_list_deals`). 5 new default connectors (total: 13).
- **Track K — Vision + PDF ingestion.** `@helm-pilot/shared/multimodal` with `parsePdf` / `parsePdfBase64` (dynamic import of optional `pdf-parse`) and `analyzeImage` (direct Anthropic Messages API with `image` content block, no SDK dep). New `parse_pdf` + `analyze_image` tools. 10 new tests, `MultimodalError` with `not_installed | invalid_input | parse_failed | vision_failed` codes.
- **Track J — Agent2Agent (A2A) protocol.** Linux-Foundation cross-agent lingua franca. `@helm-pilot/shared/a2a` ships `A2AClient` (over JSON-RPC 2.0, bearer auth, 30s timeout) and `buildPilotAgentCard()` (5 declared skills). Gateway exposes `GET /.well-known/agent-card.json` + `POST /a2a` with an in-memory Task store and `PILOT_A2A_TOKEN` bearer gating. Pilot is now addressable from Microsoft Agent Framework, Gemini CLI, and any A2A 0.3 client.
- **Track M — L1/L2 conformance validators.** `@helm-pilot/shared/conformance` provides `validateL1` (required fields, verdict enum, decisionHash hex format, receivedAt validity, optional signature requirement) and `validateL2` (L1 prerequisite + unique decisionId + orphan parent detection + 3-color DFS cycle detection + monotone timestamp). 14 unit tests. Publishes the hook for subagent certification against the helm-oss harness.

### Changed

- HELM Pilot version 1.1.0 → **1.2.0**.
- Built-in orchestrator tools: 27 → **47** (+20 across Tracks I + K).
- `@helm-pilot/shared` subpath exports: 27 → **30** (`./multimodal`, `./a2a`, `./conformance`).
- Default registered connectors: 8 → **13**.

### Deferred to Phase 16

- A2A server route: replace v1 in-memory echo with SubagentRegistry dispatch (planned 1.2.1 patch).
- Streaming + push notifications on A2A (protocol supports; Pilot currently advertises `streaming:false`).
- Per-connector unit tests for Stripe / Calendar / HubSpot (currently covered by shared fetch mocks in Slack/Notion patterns).
- Long-running autonomous execution (Track N), cost attribution UI (Track O), skills marketplace (Track P), pluggable inference providers (Track Q).

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

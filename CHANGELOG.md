# Changelog

All notable public changes to Pilot are documented here. Entries focus on self-hosting, APIs, governance, founder workflows, connectors, security, and documentation impact.

## [1.3.0] - 2026-04-24

### Added

- Long-running autonomous execution checkpoint support for task runs, including checkpoint state and stalled-run detection.
- Cost attribution dashboard material for spend, cache savings, monthly burn projection, cache hit rate, and per-workspace or per-operator views.
- Skills marketplace client for installing verified skill archives into a local Pilot skill directory.
- Ollama provider support for local/self-hosted inference when no cloud provider key is configured.

### Changed

- Pilot version updated to `1.3.0`.
- LLM configuration supports self-hosted Ollama endpoint and model settings.
- Environment examples include self-hosted inference and skills registry configuration.

## [1.2.1] - 2026-04-24

### Fixed

- A2A task dispatch now routes into the governed orchestrator instead of returning canned responses.
- Evidence-pack writes run L1 conformance validation.
- Tool output sanitization now runs before untrusted tool results return to the model context.

### Added

- Subagent certification CLI for validating evidence packs.
- A2A gateway tests, connector unit tests, and sanitizer tests.
- Operator-ready environment examples for A2A and optional PDF parsing.

## [1.2.0] - 2026-04-20

### Added

- Connector breadth across Slack, Notion, Linear, Stripe read-only, Google Calendar, and HubSpot.
- Vision and PDF ingestion helpers with `parse_pdf` and `analyze_image` tools.
- Agent2Agent discovery and JSON-RPC endpoint with bearer authentication.
- L1/L2 conformance validators for receipt and evidence-pack checking.

### Changed

- Built-in orchestrator tools expanded from 27 to 47.
- Default registered connectors expanded from 8 to 13.

## [1.1.0] - 2026-04-19

### Added

- MCP consumer and provider support, including a Pilot MCP server for DB-backed tools.
- Compliance framework overlays, attestations, and governance UI hooks.
- Sandbox abstraction for generated-code execution checks.
- Optional Langfuse and Braintrust observability hooks.
- Skill loader for `SKILL.md` based operator behavior.
- HELM endpoint integration, budget/cost surfaces, and proof graph support.
- Threat scanning and sanitizer tests for untrusted scraping output.
- Anthropic prompt-caching telemetry.
- Live conduct streaming through server-sent events.

## [1.0.0] - 2026-04-19

### Added

- Connector token refresh infrastructure.
- CI/CD hardening with SBOM, provenance, vulnerability scanning, secret scanning, and restore drill workflow.
- Observability alerts, dashboards, Sentry/OpenTelemetry documentation, and cost/governance views.
- DigitalOcean production deployment path with Pilot, HELM sidecar, PostgreSQL, Caddy, and backup scheduling.
- Web dashboard mode pages, governance DAG, Telegram command routing, E2E tests, and load-test baseline.

## [0.1.0] - 2026-04-16

### Added

- HELM governance sidecar integration.
- Multi-tenant workspace isolation with encrypted secret storage.
- Scoring, semantic deduplication, clustering, decision court, build, launch, and apply workflows.
- Magic-link and Telegram authentication.
- DigitalOcean deployment configuration and Docker build.

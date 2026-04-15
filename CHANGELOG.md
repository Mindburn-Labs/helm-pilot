# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

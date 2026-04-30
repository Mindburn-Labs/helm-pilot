# AGENTS.md — HELM Pilot

Per-project guide for Codex. Inherits from `../AGENTS.md`. Read both.

## What this project is

HELM Pilot is an open-source, self-hostable autonomous founder operating system: assesses fit, discovers opportunities, evaluates co-founder candidates, coordinates digital operators, builds and launches. Single-process Node.js 22 server with PostgreSQL 17 + pgvector, backed by HELM's trust boundary.

## What this project is NOT

- NOT a HELM replacement. It runs **behind** HELM via `packages/helm-client`; every autonomous action goes through the trust boundary or does not happen.
- NOT a multi-tenant SaaS. Self-hostable single-founder deployment is the target shape.
- NOT a general scraping framework. Ingestion is Scrapling-first and session-backed.
- NOT a playground for new ORMs or runtimes — Drizzle + Node 22 + pg-boss are fixed.
- NOT a rewrite of the old `_archive/openclaw/` system — archive lives for reference only.

## Build / test / lint

```
npm ci
bash scripts/install-python-runtime.sh   # pinned Scrapling runtime
npm run db:migrate
npm run dev                               # turbo dev — all services
npm test
npm run lint
docker compose -f infra/docker/docker-compose.yml up -d postgres
```

## Canonical paths

- `apps/` — `telegram-bot` (grammY, polling+webhook), `telegram-miniapp`, `web` (Next.js 15)
- `services/gateway/` — Hono HTTP API (auth, CORS, rate limiting, SSE)
- `services/orchestrator/` — trust boundary + agent loop + pg-boss jobs
- `services/memory/` — pgvector semantic + keyword search
- `services/decision-court/` — adversarial decision gate
- `services/{founder-intel,cofounder-engine,yc-intel,product-factory,launch-engine,content-engine,finance-engine,application-engine,seo-engine}/` — domain engines
- `packages/db/` — Drizzle schema, 47 tables, 13 domains
- `packages/shared/` — Zod schemas, config, logger, LLM provider
- `packages/connectors/` — external service integrations
- `packages/helm-client/` — HELM trust-boundary client
- `packages/legacy-audit/` — migration trail from `_archive/openclaw`
- `pipelines/` — Scrapling-backed ingestion
- `infra/docker/docker-compose.yml` — local stack + self-host shape

## Architectural invariants

- MUST route every autonomous action through `packages/helm-client`; no out-of-band tool calls.
- MUST keep the orchestrator single-process. Multi-worker scale-out is not in scope.
- MUST use Scrapling for ingestion; no ad-hoc `fetch` or `puppeteer` in services.
- MUST use Drizzle for all DB access; no raw SQL outside `packages/db/migrations`.
- MUST validate every inbound and outbound payload with Zod from `packages/shared`.
- MUST NOT commit `.env` or any OAuth client secret. Use `.env.example` patterns.
- MUST NOT modify `_archive/openclaw/` or `_archive/money-engine/` — archive only.
- MUST NOT downgrade `helm-client` to bypass the trust boundary.

## Design system

Mindburn DS v1.0 — Parchment / Graphite. Canonical tokens live in `mindburn/app/styles/design-system.css`. `apps/web` consumes them via `src/app/layout.tsx` inline body style (Graphite background + bone ink + Inter Tight); `apps/telegram-miniapp/src/styles.css` sets DS fallbacks on `--tg-theme-*` for when the Mini App runs standalone (Telegram-injected theme values still win when present). Hardcoded hex outside the Ember / Sage / Amber / Ink-Blue ramps fails review. Palette changes cross-apply to `mindburn` first, then mirror here in the same PR.

## Subagents to prefer

- `repo-auditor` — any cross-cutting change, before edits.
- `docs-truth-checker` — README and `docs/` drift reconciliation.
- `wedge-product-owner` — when editing README or landing copy.
- `titan-hardcase` — for anything that changes the autonomous-action path or widens trust-boundary surface.
- `cross-impact-analyzer` — when touching `@helm/client` or any shared schema.
- `test-coverage-enforcer` — orchestrator and decision-court coverage is load-bearing.

## Skills to prefer

- `/helm-audit` — reality-check before non-trivial edits.
- `/helm-pr-preflight` — multi-agent sweep before opening a PR.
- `/helm-connector-cert` — for every new connector in `packages/connectors/`.
- `/helm-doc-truth` — after feature work, before merging doc changes.
- `/helm-wedge` — for every README or public-surface edit.

## Danger zones

- `packages/helm-client/**` — trust-boundary client. Changes affect every autonomous action.
- `services/orchestrator/**` — agent loop + pg-boss. A bug here blocks all automation.
- `services/decision-court/**` — adversarial decision logic; treat as safety-critical.
- `services/gateway/{auth,rate-limit}/**` — authentication + abuse controls.
- `packages/db/schema/**` — 47 tables; migrations compound risk across 13 domains.
- `pipelines/**` — Scrapling runners handle untrusted external input; sandbox assumptions must hold.
- `apps/telegram-bot/**` — only authenticated public ingress.
- `.env*` — OAuth secrets, LLM keys. Never commit.
- `infra/docker/docker-compose.yml` — production deployment shape for self-hosters.

## Naming

The on-disk directory is `helm-pilot/` (renamed from `HELM Pilot/` on 2026-04-18). The product is still called "HELM Pilot" in user-facing contexts: Dockerfile `LABEL org.opencontainers.image.title`, Grafana dashboard titles, Prometheus alert summaries, alertmanager Subject lines, and README copy. When editing those strings, preserve the product spelling.

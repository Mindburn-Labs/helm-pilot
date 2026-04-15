# Phase 0 — Keep / Refactor / Rebuild / Remove Decision Matrix

> Every module classified with rationale, aligned to the canonical spec (Section 28).
> Generated 2026-04-12.

---

## Classification Key

| Category | Meaning |
|----------|---------|
| **KEEP** | Use as-is or with minimal changes. Production-quality, language-compatible. |
| **REFACTOR** | Valuable pattern/logic, but needs rewrite (Python→TS, file→DB, classifieds→founder). |
| **REBUILD** | No predecessor exists. Must be built from scratch per the spec. |
| **REMOVE** | Classifieds-specific, duplicate, or superseded by new architecture. |
| **MIGRATE** | Data files that need format conversion (JSONL→Postgres rows). |

---

## 1. KEEP (Use directly)

| Module | What It Is | Why Keep | Destination |
|--------|-----------|----------|-------------|
| `gig-radar/lib/sanitize.py` | 32-pattern injection detection + HTML strip | Production-quality security layer. Language-appropriate (Python pipeline). | `pipelines/scraper/lib/sanitize.py` |
| `gig-radar/lib/rerank.py` | Cohere Rerank 4 Pro semantic ranking | Model-agnostic, provider-abstracted. Works for any ranking task. | `pipelines/intelligence/rerank.py` |
| `gig-radar/lib/browser_fetch.py` | Playwright Chromium headless browser | Generic Cloudflare bypass. No classifieds-specific logic. | `pipelines/scraper/lib/browser_fetch.py` |
| `gig-radar/lib/dedupe.py` | URL + title deduplication | Clean, reusable dedup logic. | `pipelines/scraper/lib/dedupe.py` |
| `gig-radar/fetchers/fetch_discourse.py` | Generic Discourse API fetcher | Works for any Discourse community (IndieHackers, etc.). | `pipelines/scraper/fetchers/` |
| `ccunpacked_scrape/CCUnpacked_Reference.md` | 83KB compiled Claude Code reference | Valuable Build intelligence for operator knowledge. | `services/memory/seed/ccunpacked.md` |
| `ccunpacked_scrape/output/` | 606 raw architecture docs | Granular knowledge for Build mode retrieval. | Ingest into `knowledge` DB tables |
| `openclaw/src/mcp/` | MCP server bridge (7 files) | Clean MCP integration, minimal code. | `services/gateway/mcp/` |

**Total KEEP: 8 modules** — These require no significant changes and can be dropped into the new structure.

---

## 2. REFACTOR (Valuable patterns, need transformation)

### 2.1 Trust & Policy Layer

| Module | What to Extract | Transformation Needed | Destination | Priority |
|--------|----------------|----------------------|-------------|----------|
| `money-engine/hooks/pretooluse.py` | Fail-closed trust boundary pattern. Check chain: kill_switch → blocklist → budget → posting → content. stdin/stdout JSON protocol. | Rewrite Python→TS. Replace classifieds budget/posting checks with workspace-scoped policy (budget per workspace, connector access gating, content safety). Generalize for operator-scoped approval flows. | `services/orchestrator/trust/` | P0 — Must be first thing built |
| `money-engine/state/policy.yaml` | Policy schema: budget caps, tool blocklist, content bans, site whitelist. | Generalize schema. Budget: per-workspace + per-operator. Replace site whitelist with connector grants. Keep tool blocklist pattern. Store in DB + config file. | `packages/shared/config/policy.ts` + `audit` DB tables | P0 |

### 2.2 Orchestration Layer

| Module | What to Extract | Transformation Needed | Destination | Priority |
|--------|----------------|----------------------|-------------|----------|
| `money-engine/skills/strategist/SKILL.md` | Core orchestration: read state → assess situation → dispatch workers → report. Decision tree pattern. | Replace classifieds dispatch targets with founder-mode dispatch (Discover/Decide/Build/Launch/Apply). State reads from DB, not JSONL. Merge with Hermes iteration-budget pattern. | `services/orchestrator/` agent loop definition | P0 |
| `money-engine/hooks/stop.py` | Session reflection pattern: summarize run stats, append insights to living memory, git commit. | Write to `knowledge` DB (timeline entries) instead of playbook.md. Remove git worktree commit. Keep reflection prompt engineering. | `services/orchestrator/hooks/session-teardown.ts` | P1 |
| `openclaw/src/agents/` | Agent execution loop, tool registry, ACP spawning, subagent delegation. | Extract core agent patterns. Merge with Hermes: iteration budget, ephemeral context injection, tool parallelization, approval flow. Drop OpenClaw-specific agent types. | `services/orchestrator/agent/` | P0 |
| `openclaw/src/hooks/` | PreToolUse/PostToolUse hook system with policy validation. | Merge with money-engine trust boundary. Use OpenClaw's TS hook infrastructure + money-engine's fail-closed semantics. | `services/orchestrator/hooks/` | P0 |

### 2.3 Gateway Layer

| Module | What to Extract | Transformation Needed | Destination | Priority |
|--------|----------------|----------------------|-------------|----------|
| `money-engine/bot.py` | Telegram command patterns (12 commands), owner-gating, message splitting, `tg()` helper. | Rewrite Python→TS with grammY. Replace owner-gating with workspace auth. Replace JSONL reads with DB queries. Keep command structure. | `apps/telegram-bot/` | P1 |
| `openclaw/src/gateway/` | Channel abstraction, session management, HTTP/WS server, auth middleware. | Extract Telegram + web channel support. Drop unused channels. Replace Express with Hono. Replace SQLite sessions with Postgres. | `services/gateway/` | P1 |
| `openclaw/src/channels/` | Channel plugin system with built-in implementations. | Keep Telegram + web channel. Drop all others for V1. Simplify plugin interface. | `services/gateway/channels/` | P1 |
| `openclaw/src/commands/` | Command parsing and routing infrastructure. | Extract for Telegram bot command handling. | `apps/telegram-bot/commands/` | P1 |

### 2.4 Intelligence Pipeline

| Module | What to Extract | Transformation Needed | Destination | Priority |
|--------|----------------|----------------------|-------------|----------|
| `gig-radar/run.py` | 9-stage pipeline architecture (FETCH→...→PERSIST). CLI interface. | Replace classifieds sources with startup opportunity sources. Output to Postgres instead of JSONL. Keep pipeline stage pattern. | `pipelines/scraper/run.py` | P1 |
| `gig-radar/sources.yaml` | Source definition schema: name, type, tier, URL, config per source. | Replace classifieds tier with startup sources (ProductHunt, IndieHackers, GitHub trending, HN startup threads, Reddit startup subs). Keep schema format. | `pipelines/scraper/sources.yaml` | P1 |
| `gig-radar/fetchers/fetch_all.sh` | Parallel fetcher orchestration, per-source fetcher dispatch. | Add new source fetchers. Remove classifieds-only fetchers (12 international classifieds). Keep parallel dispatch pattern. | `pipelines/scraper/fetchers/` | P1 |
| `gig-radar/lib/shortlist.py` | Heuristic scoring with multi-factor formula. | Replace `money_signal + contract_bonus` with `founder_fit + market_signal + timing + feasibility`. | `pipelines/intelligence/scoring.py` | P2 |
| `gig-radar/lib/llm_score_draft.py` | OpenRouter LLM scoring with structured prompt. | Replace arbitrage-scoring prompt with opportunity-assessment prompt. Keep provider abstraction. | `pipelines/intelligence/llm_score.py` | P2 |
| `gig-radar/lib/prefilter.py` | Kill phrase filtering, contract escape detection. | Replace classifieds kill phrases with startup-relevant negative signals. | `pipelines/scraper/lib/prefilter.py` | P2 |
| `money-engine/lib/pain_miner.py` | 3-tier embedding fallback, HDBSCAN clustering, cosine similarity grouping. | Keep embedding + clustering logic. Apply to opportunity clustering instead of pain mining. | `pipelines/intelligence/clustering.py` | P2 |

### 2.5 Supporting Infrastructure

| Module | What to Extract | Transformation Needed | Destination | Priority |
|--------|----------------|----------------------|-------------|----------|
| `money-engine/lib/oauth_handlers.py` | OAuth2 flow for Google, Stripe, Gumroad. Token management. | Rewrite Python→TS. Generalize into connector auth service. Add more providers. | `packages/connectors/auth/` | P2 |
| `money-engine/skills/closer-inbox/SKILL.md` | Inbound message matching: query → product catalog match → response. | Generalize from classifieds inbox to any inbound channel handling. | `services/launch-engine/inbound/` | P3 |
| `money-engine/skills/builder-landing/SKILL.md` | Landing page generation: index.html + fly.toml + Stripe price. | Keep as Build mode task type. Remove Fly.io-specific deploy (make deployment configurable). | `services/product-factory/tasks/landing.ts` | P2 |
| `money-engine/skills/builder-pdf/SKILL.md` | PDF artifact creation: content generation → PDF conversion → marketplace publish. | Keep as Build mode task type. Remove Gumroad-specific publish. | `services/product-factory/tasks/pdf.ts` | P2 |
| `money-engine/state/playbook.md` | Living operational memory content: Mission, Non-negotiables, Heuristics. | Seed content for knowledge layer. Parse into structured timeline entries. | `services/memory/seed/` | P2 |
| `openclaw/src/config/` | YAML config + Zod validation + hierarchical merge. | Simplify for HELM Pilot config needs. Keep Zod validation pattern. | `packages/shared/config/` | P1 |
| `openclaw/src/infra/` | Session, auth, logging, error handling utilities. | Extract auth/session patterns for gateway. Extract logging for shared package. | Split: `services/gateway/` + `packages/shared/` | P1 |
| `openclaw/src/plugins/` | Plugin loading, registry, lifecycle. | Adapt for operator skill loading. | `services/orchestrator/plugins/` | P2 |
| `openclaw/src/skills/` | Skill file loading and execution. | Adapt for HELM Pilot skill format. | `services/orchestrator/skills/` | P2 |
| `openclaw/src/tools/` | Tool definitions, execution wrappers. | Keep tool abstraction. Add HELM Pilot-specific tools. | `services/orchestrator/tools/` | P2 |
| `openclaw/src/cron/` | Scheduled job execution (croner). | Replace with pg-boss scheduled jobs. Keep scheduling pattern. | Background via pg-boss | P2 |
| `openclaw/src/storage/` | File/blob storage abstraction. | Adapt for S3-compatible + local fallback. | `packages/shared/storage/` | P2 |
| `openclaw/src/media/` | Media handling (images, files, voice). | Keep for Telegram media messages. | `services/gateway/media/` | P3 |

---

## 3. REBUILD (No predecessor — build from spec)

| System | Spec Section | What It Is | Priority | Dependencies |
|--------|-------------|-----------|----------|--------------|
| Canonical repo structure | S27 | Monorepo with apps/, services/, packages/, pipelines/, infra/, docs/ | P0 | None — foundation |
| PostgreSQL schema | S15 | 12 domains, ~40 tables, Drizzle ORM, pgvector | P0 | Repo structure |
| Founder profile assessment | S5, S10 | Intake wizard, strength/weakness inference, startup vector | P1 | DB schema, web UI |
| YC intelligence pipeline | S5 | Public YC data scraping, structuring, embedding | P1 | DB schema, Python pipeline infra |
| Co-founder engine | S11 | Role configs, complement scoring, operator creation | P1 | DB schema, founder profiles |
| Product modes (Discover/Decide/Build/Launch/Apply) | S12 | 5-mode state machine with mode-specific UI + actions | P1 | Orchestrator, web UI, DB |
| Web UI | S13 | Next.js 16 dashboard with all product modes | P2 | DB schema, API layer, services |
| Telegram Mini App | S13 | React + Telegram Web App SDK | P2 | Web components, bot auth |
| Memory / knowledge layer | S16 | GBrain-style: compiled truth + timeline, MECE registry, hybrid search | P1 | DB schema (pgvector), GBrain patterns |
| Deployment topology | S30 | Fly.io configs, Docker Compose local dev | P3 | All services stable |
| Self-hosting install flow | S32 | One-command Docker Compose → running system | P3 | All services, Docker configs |
| Application workflow | S12 (Mode E) | YC application template, narrative builder, pitch deck helper | P2 | Founder profiles, knowledge layer |
| Connector system | S26 | OAuth grants, token management, per-connector access control | P2 | DB schema, auth |
| Observability | S24 | Structured logging (pino), job history, model usage tracking | P2 | All services |
| CI/CD | — | GitHub Actions, test suites, deploy automation | P3 | All code stable |
| Automated tests | — | Vitest unit, integration (DB), E2E (Playwright) | P2 | Services built |

---

## 4. REMOVE (Not needed in target system)

| Module | Why Remove |
|--------|-----------|
| `money-engine/skills/marketer-classifieds/SKILL.md` | Classifieds ad posting. Launch-engine has different distribution model. |
| `money-engine/skills/accountant/SKILL.md` | Classifieds P&L tracking. Replaced by workspace financial state in DB. |
| `money-engine/state/personas.yaml` | Persona fleet (5 EU identities for classifieds posting). Replaced by operator model. |
| `money-engine/state/pnl.jsonl` | Empty. No data to preserve. |
| `money-engine/state/distribution.jsonl` | Empty. No data to preserve. |
| `money-engine/state/posting_queue.jsonl` | Classifieds posting queue. Not applicable. |
| `money-engine/run-strategist.sh` | Shell bootstrap. Replaced by service startup in new architecture. |
| `gig-radar/lib/classifieds.py` | HTML parser for 12 international classifieds. Not needed. |
| `gig-radar/lib/telegram_send.py` | Direct Telegram API calls. Replaced by grammY bot. |
| `ccunpacked_scrape/scraper.py` | One-time scraping tool. Data already collected. |
| `ccunpacked_scrape/parse.py` | One-time parsing tool. Data already parsed. |
| `ccunpacked_scrape/clean_book.py` | One-time cleaning tool. Data already cleaned. |
| `openclaw/src/billing/` | Stripe billing. No billing for self-hosted V1. |
| `openclaw/src/analytics/` | Usage analytics. Replaced by simpler observability. |
| `openclaw/src/notifications/` | Push notifications. Telegram handles this. |
| `openclaw/src/admin/` | Admin panel. Web UI settings replaces this. |
| `openclaw/src/marketplace/` | Plugin marketplace. Not applicable for V1. |
| `openclaw/src/federation/` | Multi-instance federation. Single-instance for V1. |
| `openclaw/src/email/` | Email sending. Connectors handle external comms. |
| `openclaw/src/webhooks/` | Inbound webhooks. Gateway handles inbound. |
| `openclaw/src/queue/` | Redis-backed BullMQ. Replaced by pg-boss. |
| `openclaw/src/cache/` | Redis caching. No Redis for V1. |
| `openclaw/src/search/` | Meilisearch/Typesense indexing. Replaced by pgvector + tsvector. |
| ~20 other openclaw subsystems | Rate limiting internals, migrations, i18n, templates, etc. |

---

## 5. MIGRATE (Data conversion needed)

| Source | Format | Records | Target | Migration Strategy |
|--------|--------|---------|--------|--------------------|
| `state/leads.jsonl` | JSONL | 369 rows | `opportunity.opportunities` table | Parse JSONL → INSERT. Map fields: source, url, title, description, ai_friendly_ok. |
| `state/pain.jsonl` | JSONL | 14 rows | `opportunity.opportunity_scores` table | Parse JSONL → INSERT. Map: cluster, score, keywords, size, urgency. |
| `state/experiments.jsonl` | JSONL | 10 rows | `tasking.tasks` + `tasking.task_artifacts` | Parse JSONL → INSERT. Map: experiment type → task type, status, artifact refs. |
| `state/playbook.md` | Markdown | 1 file | `knowledge.pages` + `knowledge.timeline_entries` | Parse sections → page entries. Heuristics → timeline entries with timestamps. |
| `~/.gig-radar/seen.json` | JSON | Variable | `opportunity.seen_urls` or dedupe in opportunity table | Simple key→row migration. |
| `ccunpacked_scrape/output/` | HTML/TXT | 606 files | `knowledge.pages` + `knowledge.content_chunks` | Parse each file → page + chunks. Generate embeddings for vector search. |

---

## 6. Priority Execution Order

### P0 — Foundation (must be first)
1. Canonical repo structure (monorepo skeleton)
2. PostgreSQL schema (Drizzle, all 12 domains)
3. Trust boundary (pretooluse.py → TS middleware)
4. Orchestrator core (strategist pattern + Hermes patterns + OpenClaw agent loop)

### P1 — Core Services
5. Gateway (OpenClaw extraction + Telegram channel)
6. Telegram bot (grammY rewrite)
7. Memory/knowledge layer (GBrain patterns)
8. Founder profile service
9. YC intelligence pipeline
10. Co-founder engine
11. Product modes state machine

### P2 — Full Product
12. Scraping pipeline (gig-radar refactor)
13. Product factory (builder skills → build tasks)
14. Launch engine
15. Web UI
16. Telegram Mini App
17. Application workflow
18. Connector system
19. Data migrations

### P3 — Ship
20. Deployment (Fly.io + Docker Compose)
21. Self-hosting flow
22. CI/CD
23. Documentation
24. Launch gates

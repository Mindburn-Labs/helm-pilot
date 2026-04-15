# Phase 0 — Module Inventory

> Exhaustive inventory of every module in HELM Pilot, categorized for the production refactor.
> Generated 2026-04-12.

---

## 1. money-engine/ (Python — Autonomous Product Studio)

| Path | Lang | Size | Purpose | Category | Target Destination | Effort |
|------|------|------|---------|----------|--------------------|--------|
| `bot.py` | Python | 16KB / 467 lines | Telegram long-polling bot. 12 commands, owner-gated (chat_id 795975551). Reads JSONL state files. `tg()` helper wraps urllib, auto-splits >4096 chars. | REFACTOR | `apps/telegram-bot/` (rewrite in TS/grammY, keep command patterns) | High |
| `run-strategist.sh` | Bash | 2.7KB / 81 lines | Bootstrap script. Launches Claude Code with `--permission-mode bypassPermissions`, `--max-budget-usd 10`, injects SKILL.md as system prompt. | REMOVE | Replaced by `services/orchestrator/` service startup | Low |
| `hooks/pretooluse.py` | Python | 8.5KB / 254 lines | **THE trust boundary.** Runs on every tool call. Check order: kill_switch → tool_blocklist → budget → classified_posting → content_bans. Fail-closed: missing policy.yaml blocks everything. I/O: stdin JSON → stdout JSON. | REFACTOR | `services/orchestrator/` trust middleware (port logic to TS, generalize beyond classifieds) | High |
| `hooks/stop.py` | Python | 7.5KB / 225 lines | Auto-Dream substitute. Runs at session end. Reads tail of pnl.jsonl + experiments.jsonl, summarizes stats, appends to playbook.md, commits to git worktree. | REFACTOR | `services/orchestrator/` session teardown hook → write to `knowledge` DB tables instead of playbook.md | Medium |
| `skills/strategist/SKILL.md` | Markdown | 7.4KB | Core orchestration skill. Reads state, dispatches workers (scout, builder, marketer, closer, accountant), reports to Telegram. Decision tree for cycle planning. | REFACTOR | `services/orchestrator/` agent loop definition. Replace classifieds dispatch with founder-mode dispatch. | High |
| `skills/scout-classifieds/SKILL.md` | Markdown | 3.0KB | Runs gig-radar, normalizes + dedupes, stamps `ai_friendly_ok`. | REFACTOR | `pipelines/scraper/` orchestration. Replace classifieds focus with opportunity sources. | Medium |
| `skills/pain-miner/SKILL.md` | Markdown | 2.9KB | Embeds leads, clusters with HDBSCAN, ranks by composite score. | REFACTOR | `services/founder-intel/` opportunity clustering. Same pattern, different data. | Medium |
| `skills/builder-landing/SKILL.md` | Markdown | 5.8KB | Creates index.html + fly.toml, Stripe price, deploys to Fly.io. | REFACTOR | `services/product-factory/` build task type: landing page. | Medium |
| `skills/builder-pdf/SKILL.md` | Markdown | 6.4KB | Writes content.md, converts to PDF, publishes to Gumroad. | REFACTOR | `services/product-factory/` build task type: PDF artifact. | Medium |
| `skills/marketer-classifieds/SKILL.md` | Markdown | 4.0KB | Generates ad variants, posts to whitelisted sites. | REMOVE | Classifieds-specific. Launch-engine will have different distribution. | Low |
| `skills/closer-inbox/SKILL.md` | Markdown | 4.5KB | Polls Gmail + DMs, matches inbound → product, replies. | REFACTOR | `services/launch-engine/` inbound handling. Pattern reusable. | Medium |
| `skills/accountant/SKILL.md` | Markdown | 6.4KB | Polls Stripe/PayPal/Gumroad/Coinbase, normalizes to EUR. | REMOVE | Replaced by workspace-level financial tracking in DB. | Low |
| `lib/pain_miner.py` | Python | 14KB / 391 lines | 3-tier embedding fallback: OpenRouter → local sentence-transformers → keyword. Clustering: HDBSCAN → cosine greedy → keyword pseudo-cluster. | REFACTOR | `pipelines/intelligence/` clustering module. Embedding logic reusable. | Medium |
| `lib/oauth_handlers.py` | Python | 10KB / 322 lines | OAuth for Google (Gmail), Stripe Connect, Gumroad. Tokens in `state/credentials/<service>.json`. | REFACTOR | `packages/connectors/` auth service. OAuth patterns reusable, needs TS rewrite. | Medium |
| `state/policy.yaml` | YAML | 2.6KB | Budget caps (daily 500 EUR, per-experiment 100, per-deal 200, emergency 1500). Posting whitelist (12 sites). Content bans. Tool blocklist. | REFACTOR | `packages/shared/` policy config + `audit` DB tables. Generalize beyond classifieds. | Medium |
| `state/playbook.md` | Markdown | 5.9KB | Living memory: Mission, Non-negotiables, Allocation, Heuristics. Updated by stop hook. | REFACTOR | `services/memory/` knowledge layer. Seed content for operational memory. | Low |
| `state/personas.yaml` | YAML | 2.2KB | 5 EU personas (p_anna_de, p_jan_nl, p_tomek_pl, p_marco_it, p_lucia_es) with backstory, skills, voice. | REMOVE | Persona fleet replaced by operator model. | Low |
| `state/leads.jsonl` | JSONL | 299KB / 369 rows | Raw leads with `ai_friendly_ok` stamp, source, URL, description. | MIGRATE | `opportunity` DB tables. Data migration script needed. | Medium |
| `state/pain.jsonl` | JSONL | 11KB / 14 rows | Clustered pain signals. Score: `size * (1+urgency) * (1+min(€_signal,500)/100) * (1+freshness)`. | MIGRATE | `opportunity` DB tables (opportunity_scores). | Low |
| `state/experiments.jsonl` | JSONL | 3.8KB / 10 rows | Product launch/kill/build events. | MIGRATE | `tasking` DB tables (task_runs, task_artifacts). | Low |
| `state/pnl.jsonl` | JSONL | 0B | Empty P&L ledger. | REMOVE | No data to migrate. | None |
| `state/distribution.jsonl` | JSONL | 0B | Empty distribution log. | REMOVE | No data to migrate. | None |
| `state/posting_queue.jsonl` | JSONL | 3.8KB | Queued classifieds postings. | REMOVE | Classifieds-specific. | None |

---

## 2. gig-radar/ (Python — Lead/Opportunity Pipeline)

| Path | Lang | Size | Purpose | Category | Target Destination | Effort |
|------|------|------|---------|----------|--------------------|--------|
| `run.py` | Python | 298 lines | 9-stage pipeline orchestrator: FETCH → SANITIZE → DEDUPE → PREFILTER → SHORTLIST → LLM SCORE → RERANK → SEND → PERSIST. CLI: --limit, --shortlist, --min-score, --dry-run, --cron. | REFACTOR | `pipelines/scraper/run.py` — keep pipeline architecture, swap classifieds sources for startup opportunity sources. | High |
| `sources.yaml` | YAML | 402 lines | 25+ active sources across 8 tiers (Reddit, HN, Bounties, Vibe Coder, Specialized, Classifieds, Browser-Fetched, Email). 40+ investigated/dead sources documented. | REFACTOR | `pipelines/scraper/sources.yaml` — replace classifieds tier with startup sources (ProductHunt, IndieHackers, GitHub trending, etc.). Keep source schema. | Medium |
| `fetchers/fetch_all.sh` | Bash | 443 lines | Orchestrates 25+ parallel fetchers. Types: curl+jq (Reddit API/Algolia), RSS/XML, Discourse API, inline Python regex, Playwright Chromium. | REFACTOR | `pipelines/scraper/fetchers/` — keep fetcher architecture, add new source fetchers, remove classifieds-only ones. | High |
| `fetchers/fetch_email.py` | Python | ~150 lines | Gmail IMAP fetcher for email-based leads. | REFACTOR | Keep for email-based opportunity alerts. | Low |
| `fetchers/fetch_discourse.py` | Python | ~120 lines | Generic Discourse forum API fetcher. | KEEP | Reusable for any Discourse-based community. | Low |
| `lib/sanitize.py` | Python | 94 lines | HTML strip + 32-pattern injection detection (XSS, SQL, shell, path traversal). | KEEP | `pipelines/scraper/lib/sanitize.py` — production-quality, reuse as-is. | None |
| `lib/prefilter.py` | Python | 145 lines | Red skills, hard/soft kill phrases, contract escape clauses. | REFACTOR | `pipelines/scraper/lib/prefilter.py` — replace classifieds kill phrases with startup-relevant filters. | Low |
| `lib/shortlist.py` | Python | 116 lines | Heuristic scoring: `money_signal + contract_bonus + recency + detail × source_quality_multiplier`. | REFACTOR | `pipelines/intelligence/scoring.py` — replace money_signal with founder-fit scoring dimensions. | Medium |
| `lib/llm_score_draft.py` | Python | 328 lines | OpenRouter LLM scoring + pitch generation. Arbitrage-mode prompt engineering. | REFACTOR | `pipelines/intelligence/llm_score.py` — replace arbitrage prompts with opportunity-assessment prompts. | Medium |
| `lib/rerank.py` | Python | 179 lines | Cohere Rerank 4 Pro semantic ranking. | KEEP | `pipelines/intelligence/rerank.py` — model-agnostic reranking, fully reusable. | None |
| `lib/classifieds.py` | Python | 343 lines | Stdlib HTML parser for 12 international classifieds sites. | REMOVE | Classifieds-specific parsing. Not needed. | None |
| `lib/browser_fetch.py` | Python | 252 lines | Playwright Chromium for Cloudflare-protected sites. Headless browser automation. | KEEP | `pipelines/scraper/lib/browser_fetch.py` — generic browser fetching, fully reusable. | None |
| `lib/telegram_send.py` | Python | 120 lines | Telegram Bot API message formatting + sending. | REMOVE | Replaced by grammY bot in `apps/telegram-bot/`. | None |
| `lib/dedupe.py` | Python | ~80 lines | URL + title deduplication with 30-day rolling cache. | KEEP | `pipelines/scraper/lib/dedupe.py` — reusable deduplication logic. | None |
| `~/.gig-radar/seen.json` | JSON | Variable | 30-day rolling dedupe cache (external state). | MIGRATE | Move to `opportunity` DB table (seen_urls or similar). | Low |

---

## 3. openclaw/ (TypeScript — Channel Gateway Fork, 59 Subsystems)

### 3.1 Core Subsystems (KEEP/REFACTOR for MVP)

| Path | Lang | Files | Purpose | Category | Target Destination | Effort |
|------|------|-------|---------|----------|--------------------|--------|
| `src/gateway/` | TS | 290+ | HTTP/WebSocket server, session management, channel dispatch, auth middleware, rate limiting. | REFACTOR | `services/gateway/` — extract channel abstraction + session routing. Drop unnecessary protocols. | High |
| `src/agents/` | TS | 400+ | Agent execution, tool registry, ACP spawning, subagent delegation. | REFACTOR | `services/orchestrator/` — extract agent loop patterns. Merge with Hermes patterns. | High |
| `src/channels/` | TS | 500+ | Channel plugin abstraction, built-in channel implementations (Telegram, web, etc.). | REFACTOR | `services/gateway/channels/` — keep Telegram + web channel, drop others for V1. | High |
| `src/config/` | TS | 200+ | YAML config loading, Zod schema validation, hierarchical config merge. | REFACTOR | `packages/shared/config/` — keep config pattern, simplify for HELM Pilot. | Medium |
| `src/infra/` | TS | 150+ | Session, auth, database, logging, error handling utilities. | REFACTOR | Split across `services/gateway/` (auth/session) and `packages/shared/` (logging/errors). | Medium |
| `src/hooks/` | TS | 60+ | PreToolUse / PostToolUse hook system. Validates tool calls against policies. | REFACTOR | `services/orchestrator/hooks/` — merge with money-engine trust boundary pattern. | Medium |
| `src/mcp/` | TS | 7 | MCP server bridge for channels. | KEEP | `services/gateway/mcp/` — keep for MCP integration. | Low |
| `src/cron/` | TS | 40+ | Scheduled job execution (croner library). | REFACTOR | Replace with pg-boss scheduled jobs for self-hosting simplicity. | Medium |

### 3.2 Supporting Subsystems (Selective extraction)

| Path | Lang | Files | Purpose | Category | Target Destination | Effort |
|------|------|-------|---------|----------|--------------------|--------|
| `src/plugins/` | TS | 80+ | Plugin loading, registry, lifecycle management. | REFACTOR | `services/orchestrator/plugins/` — extract plugin pattern for operator skills. | Medium |
| `src/skills/` | TS | 50+ | Skill file loading and execution. | REFACTOR | `services/orchestrator/skills/` — adapt for operator skill definitions. | Medium |
| `src/tools/` | TS | 100+ | Tool definitions and execution wrappers. | REFACTOR | `services/orchestrator/tools/` — keep tool abstraction, add HELM Pilot-specific tools. | Medium |
| `src/media/` | TS | 30+ | Media handling (images, files, voice). | KEEP | `services/gateway/media/` — needed for Telegram media messages. | Low |
| `src/commands/` | TS | 70+ | Command parsing and routing. | REFACTOR | `apps/telegram-bot/commands/` — extract Telegram command patterns. | Medium |
| `src/storage/` | TS | 20+ | File/blob storage abstraction. | REFACTOR | `packages/shared/storage/` — adapt for S3-compatible + local fallback. | Low |

### 3.3 Subsystems to Drop (Not needed for HELM Pilot V1)

| Path | Lang | Files | Purpose | Category | Rationale |
|------|------|-------|---------|----------|-----------|
| `src/billing/` | TS | 15+ | Stripe billing integration. | REMOVE | Self-hosted product, no billing for V1. |
| `src/analytics/` | TS | 20+ | Usage analytics and tracking. | REMOVE | Replace with simpler observability (pino logs + DB). |
| `src/notifications/` | TS | 25+ | Push notification system. | REMOVE | Telegram bot handles notifications directly. |
| `src/admin/` | TS | 40+ | Admin panel API. | REMOVE | Web UI settings page replaces this. |
| `src/marketplace/` | TS | 30+ | Plugin marketplace. | REMOVE | No marketplace for V1. |
| `src/federation/` | TS | 20+ | Multi-instance federation. | REMOVE | Single-instance self-hosting for V1. |
| `src/email/` | TS | 15+ | Email sending. | REMOVE | Not needed; connectors handle external comms. |
| `src/webhooks/` | TS | 25+ | Inbound webhook processing. | REMOVE | Gateway handles inbound; simplify for V1. |
| `src/queue/` | TS | 20+ | Redis-backed job queue (BullMQ). | REMOVE | Replaced by pg-boss (no Redis dependency). |
| `src/cache/` | TS | 15+ | Redis caching layer. | REMOVE | No Redis for V1; Postgres + in-memory where needed. |
| `src/search/` | TS | 25+ | Search indexing (likely Meilisearch/Typesense). | REMOVE | Replaced by pgvector + tsvector hybrid search. |
| ~20 other subsystems | TS | Various | Rate limiting internals, migrations, i18n, templates, etc. | REMOVE | Not needed or rebuilt from scratch. |

### 3.4 OpenClaw Dependencies (from package.json)

Key dependencies to carry forward:
- `@anthropic-ai/sdk` — LLM provider (keep)
- `@modelcontextprotocol/sdk` — MCP integration (keep)
- `hono` — HTTP framework (keep, use for API layer)
- `zod` — Schema validation (keep)
- `croner` → replaced by `pg-boss`
- `express` → replaced by `hono`
- `better-sqlite3` / `sqlite-vec` → replaced by PostgreSQL + pgvector
- `playwright-core` → move to Python pipelines

---

## 4. ccunpacked_scrape/ (Python — Build Intelligence)

| Path | Lang | Size | Purpose | Category | Target Destination | Effort |
|------|------|------|---------|----------|--------------------|--------|
| `scraper.py` | Python | ~200 lines | Playwright automation scraping ccunpacked.dev. | REMOVE | One-time scraping tool, data already collected. | None |
| `parse.py` | Python | ~150 lines | HTML → Markdown conversion for scraped pages. | REMOVE | Data already parsed. | None |
| `clean_book.py` | Python | ~100 lines | Post-processing to remove UI noise from parsed content. | REMOVE | Data already cleaned. | None |
| `CCUnpacked_Reference.md` | Markdown | 83KB | Compiled Claude Code architecture reference book. | KEEP | `services/memory/seed/` — seed knowledge for Build mode (Claude Code patterns). | Low |
| `output/` | HTML/TXT | 606 files / ~216MB | Raw scraped pages: agent_loop (33), architecture (105), commands (285), tools (156), hidden_features (24). | KEEP | `services/memory/seed/` — ingest as `concept` pages in knowledge layer. | Medium |

---

## 5. Root-Level Files

| Path | Purpose | Category | Notes |
|------|---------|----------|-------|
| `.claude/` | Claude Code project config | KEEP | Workspace config, plans, memory |
| No Dockerfile | — | REBUILD | Need Docker Compose for local dev |
| No package.json | — | REBUILD | Need root monorepo config |
| No tsconfig.json | — | REBUILD | Need root TS config |
| No .env / .env.example | — | REBUILD | Need environment config |
| No CI/CD | — | REBUILD | Need GitHub Actions workflows |
| No tests | — | REBUILD | No automated tests exist anywhere |

---

## Summary Statistics

| Directory | Total Files | Lines (est.) | Language | KEEP | REFACTOR | REBUILD | REMOVE | MIGRATE |
|-----------|-------------|-------------|----------|------|----------|---------|--------|---------|
| money-engine/ | ~25 | ~3,500 | Python/Markdown/YAML | 0 | 13 | 0 | 7 | 3 |
| gig-radar/ | ~18 | ~2,500 | Python/Bash/YAML | 5 | 6 | 0 | 2 | 1 |
| openclaw/ | ~2,000+ | ~500,000 | TypeScript | 2 | 12 | 0 | ~45 subsystems | 0 |
| ccunpacked_scrape/ | ~610 | ~220,000 | Python/HTML/Markdown | 2 | 0 | 0 | 3 | 0 |
| Root | 1 | — | — | 1 | 0 | 5 | 0 | 0 |

**Bottom line:** ~15-20% of OpenClaw is donor material. gig-radar pipeline architecture is highly reusable with source/prompt swaps. money-engine patterns (trust boundary, skill dispatch, session reflection) are valuable but need TS rewrite. ccunpacked is pure knowledge content. Everything else is either classifieds-specific (remove) or doesn't exist yet (rebuild).

# Phase 0 — Dependency Graph

> Inter-module dependency map for HELM Pilot. Documents what calls what, what shares state, and what breaks if removed.
> Generated 2026-04-12.

---

## 1. High-Level Module Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                     HELM Pilot System                        │
│                                                              │
│  ┌──────────────┐    spawns     ┌──────────────────────┐    │
│  │ run-          │──────────────▶│ Claude Code Agent     │    │
│  │ strategist.sh │              │ (with SKILL.md        │    │
│  └──────────────┘              │  as system prompt)    │    │
│                                 └──────┬───────────────┘    │
│                                        │                     │
│                        ┌───────────────┼───────────────┐     │
│                        │ hooks/        │               │     │
│                        ▼               ▼               ▼     │
│                 ┌──────────┐  ┌──────────────┐  ┌─────────┐ │
│                 │pretooluse│  │ skills/*.md   │  │ stop.py │ │
│                 │.py       │  │ (8 skills)    │  │         │ │
│                 └────┬─────┘  └──────┬────────┘  └────┬────┘ │
│                      │               │                │      │
│         reads        │    dispatches │      reads     │      │
│                      ▼               ▼                ▼      │
│              ┌───────────────────────────────────────────┐   │
│              │           state/ (file system)            │   │
│              │  policy.yaml │ playbook.md │ *.jsonl      │   │
│              │  personas.yaml │ credentials/             │   │
│              └───────────────────┬───────────────────────┘   │
│                                  │                            │
│                    reads/writes  │                            │
│                                  ▼                            │
│  ┌──────────┐           ┌──────────────┐    ┌─────────────┐ │
│  │ bot.py   │◄──reads───│  *.jsonl      │    │ lib/        │ │
│  │(Telegram)│           │  state files  │    │ pain_miner  │ │
│  └──────────┘           └──────────────┘    │ oauth_hdlrs │ │
│                                              └─────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              gig-radar/ (external pipeline)           │   │
│  │  run.py → fetch_all.sh → sanitize → prefilter →      │   │
│  │  shortlist → llm_score → rerank → telegram_send →    │   │
│  │  persist → state/leads.jsonl                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              openclaw/ (standalone fork)               │   │
│  │  No runtime dependency on money-engine or gig-radar.  │   │
│  │  Donor for patterns only.                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              ccunpacked_scrape/ (static data)         │   │
│  │  No runtime dependencies. Read-only knowledge store.  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Detailed Dependency Chains

### 2.1 Entry Point Chain

```
run-strategist.sh
  └─▶ claude (Claude Code CLI)
       ├─▶ SKILL.md (strategist) loaded as system prompt
       ├─▶ hooks/pretooluse.py (runs on EVERY tool call)
       │    └─▶ reads state/policy.yaml (budget, blocklist, content bans)
       │    └─▶ reads state/kill_switch (if exists → block all)
       └─▶ hooks/stop.py (runs on session end)
            └─▶ reads state/pnl.jsonl (tail)
            └─▶ reads state/experiments.jsonl (tail)
            └─▶ writes state/playbook.md (appends reflection)
            └─▶ git commit (worktree)
```

### 2.2 Strategist Dispatch Chain

The strategist skill reads state, then dispatches sub-skills:

```
strategist/SKILL.md
  ├─▶ reads state/playbook.md (operational memory)
  ├─▶ reads state/experiments.jsonl (active experiments)
  ├─▶ reads state/pnl.jsonl (financial state)
  ├─▶ reads state/leads.jsonl (pipeline)
  ├─▶ reads state/pain.jsonl (clusters)
  │
  ├─▶ dispatches scout-classifieds/SKILL.md
  │    └─▶ invokes gig-radar/run.py (shell exec)
  │         └─▶ writes state/leads.jsonl
  │
  ├─▶ dispatches pain-miner/SKILL.md
  │    └─▶ uses lib/pain_miner.py
  │    └─▶ reads state/leads.jsonl
  │    └─▶ writes state/pain.jsonl
  │
  ├─▶ dispatches builder-landing/SKILL.md
  │    └─▶ reads state/pain.jsonl (picks opportunity)
  │    └─▶ writes state/experiments.jsonl
  │    └─▶ external: Fly.io deploy, Stripe API
  │
  ├─▶ dispatches builder-pdf/SKILL.md
  │    └─▶ reads state/pain.jsonl
  │    └─▶ writes state/experiments.jsonl
  │    └─▶ external: Gumroad API
  │
  ├─▶ dispatches marketer-classifieds/SKILL.md
  │    └─▶ reads state/experiments.jsonl (active products)
  │    └─▶ reads state/personas.yaml (posting personas)
  │    └─▶ writes state/posting_queue.jsonl
  │    └─▶ external: classifieds site APIs
  │
  ├─▶ dispatches closer-inbox/SKILL.md
  │    └─▶ uses lib/oauth_handlers.py (Gmail OAuth)
  │    └─▶ reads state/experiments.jsonl (product catalog)
  │    └─▶ external: Gmail API
  │
  └─▶ dispatches accountant/SKILL.md
       └─▶ uses lib/oauth_handlers.py (Stripe, PayPal, Gumroad, Coinbase)
       └─▶ writes state/pnl.jsonl
```

### 2.3 gig-radar Internal Pipeline

```
run.py (orchestrator)
  └─▶ fetchers/fetch_all.sh
       ├─▶ curl+jq fetchers (Reddit, GitHub, Algolia, RSS)
       ├─▶ fetch_discourse.py (Discourse API)
       ├─▶ fetch_email.py (Gmail IMAP)
       └─▶ lib/browser_fetch.py (Playwright for Cloudflare sites)
            └─▶ output: raw JSONL per source
  └─▶ lib/sanitize.py (HTML strip + injection detection)
  └─▶ lib/dedupe.py (URL dedup against ~/.gig-radar/seen.json)
  └─▶ lib/prefilter.py (kill phrase filtering)
  └─▶ lib/shortlist.py (heuristic scoring)
  └─▶ lib/llm_score_draft.py (OpenRouter LLM scoring)
  └─▶ lib/rerank.py (Cohere Rerank semantic ranking)
  └─▶ lib/telegram_send.py (send to Telegram)
  └─▶ persist → money-engine/state/leads.jsonl
```

### 2.4 bot.py Dependencies

```
bot.py (read-only consumer)
  ├─▶ reads state/kill_switch
  ├─▶ reads state/experiments.jsonl
  ├─▶ reads state/leads.jsonl
  ├─▶ reads state/pain.jsonl
  ├─▶ reads state/pnl.jsonl
  ├─▶ reads state/personas.yaml
  └─▶ external: Telegram Bot API (urllib)
  
  NOTE: bot.py NEVER writes state. It's a pure read-only view.
```

---

## 3. Shared State Map

### 3.1 File-Based State (Current)

| State File | Written By | Read By | Contention Risk |
|------------|-----------|---------|-----------------|
| `state/policy.yaml` | Manual edit only | pretooluse.py | None (static config) |
| `state/playbook.md` | stop.py, strategist | strategist, stop.py | Low (append-only) |
| `state/kill_switch` | Manual/bot `/ke` command | pretooluse.py, bot.py | None (boolean flag) |
| `state/leads.jsonl` | gig-radar (via scout skill) | strategist, pain-miner, bot.py | Medium (concurrent append) |
| `state/pain.jsonl` | pain-miner skill | strategist, builder skills, bot.py | Low (full rewrite each time) |
| `state/experiments.jsonl` | builder skills, marketer | strategist, closer, accountant, bot.py | Medium (concurrent append) |
| `state/pnl.jsonl` | accountant skill | strategist, stop.py, bot.py | Low (append-only) |
| `state/personas.yaml` | Manual edit only | marketer skill, bot.py | None (static config) |
| `state/posting_queue.jsonl` | marketer skill | marketer skill | Low (single writer) |
| `state/credentials/*.json` | oauth_handlers.py | oauth_handlers.py | None (per-service files) |
| `~/.gig-radar/seen.json` | gig-radar/run.py | gig-radar/run.py | None (single process) |

### 3.2 External Service Dependencies

| Service | Used By | Auth Method | Purpose |
|---------|---------|-------------|---------|
| Telegram Bot API | bot.py, telegram_send.py | Bot token (env var) | Commands + notifications |
| OpenRouter | llm_score_draft.py, pain_miner.py | API key (env var) | LLM scoring, embeddings |
| Cohere | rerank.py | API key (env var) | Semantic reranking |
| Gmail/Google | oauth_handlers.py, closer, fetch_email | OAuth2 (credentials/*.json) | Inbox monitoring |
| Stripe | oauth_handlers.py, builder-landing | OAuth2 / API key | Payments, product creation |
| Gumroad | oauth_handlers.py, builder-pdf | OAuth2 / API key | Digital product sales |
| Fly.io | builder-landing skill | CLI (fly auth) | Landing page deployment |
| Coinbase | accountant skill | API key | Crypto payment tracking |
| PayPal | accountant skill | API key | Payment tracking |

---

## 4. Break-If-Removed Analysis

| Module | If Removed... | Impact | Severity |
|--------|--------------|--------|----------|
| `state/policy.yaml` | pretooluse.py fails closed (blocks everything) | **System halt** | CRITICAL |
| `hooks/pretooluse.py` | No trust boundary, Claude Code has unrestricted tool access | **Security breach** | CRITICAL |
| `run-strategist.sh` | No entry point to start the system | **System won't start** | CRITICAL |
| `strategist/SKILL.md` | Agent has no instructions, cannot orchestrate | **System non-functional** | CRITICAL |
| `state/playbook.md` | Strategist loses operational memory | **Degraded decisions** | HIGH |
| `state/leads.jsonl` | No lead pipeline data, scout must rebuild | **Temporary data loss** | MEDIUM |
| `gig-radar/` | No lead generation at all | **Pipeline broken** | HIGH |
| `bot.py` | No Telegram interface (system still runs headless) | **No user visibility** | MEDIUM |
| `hooks/stop.py` | No session reflection, playbook stops growing | **Memory degradation** | LOW |
| `lib/pain_miner.py` | Pain clustering fails, strategist can still use raw leads | **Degraded analysis** | LOW |
| `lib/oauth_handlers.py` | OAuth flows broken for Gmail/Stripe/Gumroad | **Connector failure** | MEDIUM |
| `openclaw/` | No impact on running system (not integrated) | **None at runtime** | NONE |
| `ccunpacked_scrape/` | No impact on running system (static data) | **None at runtime** | NONE |
| `state/personas.yaml` | Marketer can't post with personas | **Marketing broken** | LOW (removing anyway) |

---

## 5. Cross-Module Data Flow (End-to-End)

```
[External Sources]              [User]
     │                            │
     ▼                            ▼
  gig-radar/                   bot.py ◄──── Telegram
  fetch_all.sh                  (read-only view)
     │                            
     ▼                            
  sanitize → dedupe →             
  prefilter → shortlist →         
  llm_score → rerank              
     │                            
     ▼                            
  leads.jsonl ◄──────────────── strategist reads
     │                            │
     ▼                            ▼
  pain_miner.py              dispatches skills
     │                       ┌────┴────────┐
     ▼                       ▼             ▼
  pain.jsonl             builders      marketers
     │                       │             │
     ▼                       ▼             ▼
  builders read         experiments   posting_queue
                        .jsonl        .jsonl
                             │
                             ▼
                        accountant
                             │
                             ▼
                        pnl.jsonl
                             │
                             ▼
                        stop.py reads → playbook.md
```

---

## 6. Implications for Refactor

### Critical Path Dependencies
1. **Trust boundary (pretooluse.py + policy.yaml)** must be the first thing rebuilt — everything depends on it
2. **State layer (JSONL files → Postgres)** is the backbone — migrating state unlocks everything else
3. **Strategist loop → Orchestrator** is the core behavior — must preserve dispatch pattern while changing targets

### Clean Separation Points
- **gig-radar** is cleanly separated from money-engine (communicates only via leads.jsonl file)
- **openclaw** has zero runtime coupling (pure pattern donor)
- **ccunpacked_scrape** has zero runtime coupling (pure knowledge)
- **bot.py** is read-only — can be swapped independently

### Tight Coupling Points
- **Skills ↔ state/*.jsonl** — every skill reads/writes specific JSONL files; migrating to Postgres changes every skill
- **pretooluse.py ↔ policy.yaml** — format-coupled; policy schema change breaks trust boundary
- **stop.py ↔ playbook.md + JSONL** — session reflection depends on specific file formats
- **strategist ↔ all other skills** — orchestration depends on skill file locations and naming

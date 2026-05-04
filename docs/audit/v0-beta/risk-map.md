# Phase 0 — Risk Map

> Migration risks, severity assessment, and mitigation strategies for the Pilot production refactor.
> Generated 2026-04-12.

---

## Risk Severity Key

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Blocks the entire refactor or causes data loss. Must be addressed first. |
| **HIGH** | Significant effort or architectural risk. Can derail timeline. |
| **MEDIUM** | Manageable with planning. Adds effort but doesn't block. |
| **LOW** | Minor inconvenience. Can be handled as encountered. |

---

## 1. Architecture Risks

### 1.1 OpenClaw Fork Divergence — HIGH

**Risk:** OpenClaw has 59 subsystems and ~500K LOC. Extracting the ~15-20% we need while discarding the rest creates an unclear boundary. If we take too much, we inherit maintenance burden. If we take too little, we re-implement patterns that already exist.

**Specific concerns:**
- Gateway/channels/agents are deeply intertwined — extracting gateway without pulling in half the agent system
- Config system has deep tendrils into every subsystem
- Session management touches gateway, channels, agents, and infra simultaneously
- SQLite dependencies baked into multiple subsystems (need Postgres swap)

**Mitigation:**
1. Do NOT fork/copy the OpenClaw repo. Start fresh with the target structure.
2. Extract specific patterns file-by-file: copy the logic, not the dependency graph.
3. Identify the 20-30 specific files worth extracting (gateway session handling, channel abstraction interface, agent loop core, hook dispatch, MCP bridge).
4. Treat OpenClaw as "reference implementation" — read it, don't import it.
5. Accept that ~70% of gateway/channel/agent code will be rewritten to fit our simpler architecture.

### 1.2 Hermes Agent Pattern Integration — MEDIUM

**Risk:** Hermes Agent (Python) has sophisticated runtime patterns (iteration budgets, ephemeral context injection, intelligent tool parallelization, credential rotation, graceful provider degradation). These patterns need to be understood and re-implemented in TypeScript, not just copied.

**Specific concerns:**
- Iteration budget system needs careful TS implementation to avoid infinite agent loops
- Tool parallelization with path-scoped safety is complex to get right
- Provider fallback chains with credential rotation under load
- Hermes uses Python's asyncio — TS async/await has different ergonomics

**Mitigation:**
1. Study Hermes source thoroughly before implementing orchestrator.
2. Implement iteration budget first (simplest, highest value — prevents runaway agents).
3. Start with sequential tool execution, add parallelization as a second pass.
4. Provider abstraction is already a solved pattern in Titan (shared AIProvider) — reuse that pattern.
5. Accept simpler versions of credential rotation and degradation for V1.

### 1.3 GBrain Knowledge Layer Complexity — MEDIUM

**Risk:** GBrain's compiled truth + timeline model with MECE entity registry and hybrid search (keyword + vector + RRF) is sophisticated. Implementing it fully is a significant undertaking.

**Specific concerns:**
- PGLite for local dev + Postgres for production = two code paths to maintain
- pgvector HNSW index tuning for our data profile
- Reciprocal Rank Fusion implementation and tuning
- Entity graph (links table) can become a performance bottleneck with many entities
- Content chunking strategy affects retrieval quality

**Mitigation:**
1. Start with Postgres-only (no PGLite for V1). Local dev uses Docker Compose Postgres.
2. Implement keyword search (tsvector) first — it works without embeddings.
3. Add vector search (pgvector) as second pass once embedding pipeline works.
4. RRF is a simple formula — implement it after both search backends work.
5. Start with fixed-size chunking, refine later.
6. Keep entity graph simple: pages + links + tags. No complex graph queries for V1.

---

## 2. Data Migration Risks

### 2.1 JSONL → PostgreSQL Migration — MEDIUM

**Risk:** 5 state files (leads.jsonl, pain.jsonl, experiments.jsonl, playbook.md, posting_queue.jsonl) contain the system's operational history. Losing this data means losing institutional knowledge.

**Specific concerns:**
- JSONL files have no schema enforcement — rows may have inconsistent fields
- leads.jsonl (369 rows) may have duplicate or malformed entries
- experiments.jsonl has free-form status values
- playbook.md is unstructured prose — hard to parse into structured records

**Quantified exposure:**
- leads.jsonl: 299KB / 369 rows — moderate volume, manageable
- pain.jsonl: 11KB / 14 rows — trivial
- experiments.jsonl: 3.8KB / 10 rows — trivial
- playbook.md: 5.9KB — manual parsing
- pnl.jsonl: 0B — nothing to migrate

**Mitigation:**
1. Write a one-time Python migration script that validates each row before INSERT.
2. Log every skipped/malformed row for manual review.
3. Keep original JSONL files in externalized historical storage after migration.
4. For playbook.md: manually extract key sections into seed knowledge entries.
5. Run migration in a transaction — all or nothing.

### 2.2 ccunpacked Knowledge Ingestion — LOW

**Risk:** 606 HTML/TXT files (~216MB) need to be ingested into the knowledge layer with proper chunking and embedding.

**Mitigation:**
1. Use existing parse.py output (already converted to markdown).
2. Batch ingestion with progress tracking.
3. Generate embeddings asynchronously (background job).
4. This is additive — failure doesn't break core functionality.

### 2.3 External State (seen.json) — LOW

**Risk:** gig-radar's dedupe cache at `~/.gig-radar/seen.json` lives outside the repo. Could be lost or forgotten.

**Mitigation:**
1. Migrate to a `seen_urls` column or table in the opportunity schema.
2. If lost, only risk is re-fetching previously seen leads (minor duplication).

---

## 3. Language/Stack Risks

### 3.1 Python → TypeScript Rewrite — HIGH

**Risk:** Core system components (bot.py, pretooluse.py, stop.py, oauth_handlers.py) are Python. The target stack is TypeScript-first. Every Python module being refactored needs a complete rewrite.

**Specific concerns:**
- Trust boundary (pretooluse.py) is security-critical — bugs in rewrite could create vulnerabilities
- OAuth flow (oauth_handlers.py) has subtle timing/refresh logic
- Bot command handler patterns differ between urllib and grammY
- Python's stdin/stdout JSON protocol for hooks needs a TS equivalent

**Mitigation:**
1. Write comprehensive tests for the new TS implementations BEFORE deleting Python originals.
2. For pretooluse.py: port the exact check chain with unit tests for every branch.
3. For OAuth: use proven TS OAuth libraries (e.g., `arctic` or `oslo/oauth2`) instead of hand-rolling.
4. For bot.py: grammY has built-in patterns for everything bot.py does manually.
5. Keep Python originals as reference until TS replacements are verified.

### 3.2 Python Pipeline Integration Bridge — MEDIUM

**Risk:** Scraping/intelligence pipelines stay Python, but the rest of the system is TypeScript. Cross-language communication adds complexity.

**Specific concerns:**
- How does the TS orchestrator invoke Python pipelines?
- How does Python pipeline output reach the Postgres DB?
- Shared schema validation across languages
- Error propagation across the language boundary

**Mitigation:**
1. Python pipelines write directly to Postgres (shared DB, not IPC).
2. Orchestrator triggers pipelines via pg-boss jobs (language-agnostic: just a DB row).
3. Define shared schemas in `packages/shared/` (Zod) and mirror critical ones in Python (Pydantic).
4. Pipeline status/errors tracked via pg-boss job status + audit_log table.
5. No direct Python↔TS socket/pipe communication for V1.

---

## 4. Scope Risks

### 4.1 Feature Creep from 38-Section Spec — CRITICAL

**Risk:** The canonical spec describes a massive system (5 product modes, 12 DB domains, ~40 tables, 8 services, 3 apps, 3 Python pipelines, deployment, self-hosting, CI/CD). Attempting to build everything at once will result in nothing shipping.

**Mitigation:**
1. **Strict phase gating.** Each phase must be verified and approved before the next begins.
2. **MVP-first for each mode.** Discover mode first (it has the fewest dependencies). Build mode last (most complex).
3. **One surface at a time.** Telegram bot first → web UI second → Mini App third.
4. **Stub what you can't build yet.** Database tables can exist before the service that uses them is built.
5. **Cut scope aggressively for V1:**
   - Mode E (Apply) can be a static template, not a full application workflow
   - Co-founder engine can start with hardcoded role configs
   - YC intelligence can start with manual data import, not automated scraping
   - Self-hosting docs > self-hosting install script

### 4.2 No Existing Tests — HIGH

**Risk:** The current system has zero automated tests. The refactor will change everything. Without tests, there's no safety net to catch regressions.

**Mitigation:**
1. Write tests for the new system from the start (not retroactively for the old one).
2. Trust boundary (policy enforcement) gets tests first — it's the security perimeter.
3. DB operations get integration tests (real Postgres, not mocks).
4. Pipeline stages get unit tests with fixture data.
5. E2E tests for critical flows only (Telegram /start → founder intake → first opportunity).
6. Don't block progress on coverage targets — test critical paths, not everything.

### 4.3 Undefined External Integrations — MEDIUM

**Risk:** The spec mentions connectors (GitHub, Linear, Slack, Gmail, etc.) but the current system only has Gmail + Stripe + Gumroad OAuth. New connectors have no implementation reference.

**Mitigation:**
1. Define connector interface contract in `packages/connectors/` first.
2. Implement Gmail connector first (existing OAuth reference + most useful for founder workflows).
3. GitHub connector second (useful for Build mode).
4. All others are P3 — stub the interface, implement when needed.
5. Use OAuth libraries, not hand-rolled flows.

---

## 5. Operational Risks

### 5.1 Development Velocity — MEDIUM

**Risk:** Single developer (Ivan) building a system with ~8 services, ~3 apps, ~3 pipelines, ~40 DB tables. Even with AI assistance, the scope is large.

**Mitigation:**
1. AI-assisted development for boilerplate (DB schemas, API routes, UI scaffolding).
2. Strict prioritization: get one complete vertical slice working before broadening.
3. Vertical slice = Telegram `/start` → founder intake → 1 opportunity → 1 operator → 1 build task → 1 artifact.
4. Ship incrementally — each phase should produce something usable.

### 5.2 Deployment Complexity — MEDIUM

**Risk:** Multiple services (gateway, orchestrator, 6 domain services) + apps (bot, miniapp, web) + pipelines (Python). Deploying and orchestrating all of these is operationally complex.

**Mitigation:**
1. **V1: Single-process deployment.** All TS services run in one Node.js process (direct function calls, not network calls). Split into separate processes later if needed.
2. Docker Compose for local dev with Postgres + the single service.
3. Python pipelines are separate containers (triggered by pg-boss, not always-on).
4. DigitalOcean: one Docker Compose stack for the TS service, Postgres, HELM, and Python-capable pipeline runtime.
5. Keep deployment simple enough that `docker-compose up` starts everything.

### 5.3 Secret/Credential Management — LOW

**Risk:** Current system stores OAuth tokens in `state/credentials/*.json` (unencrypted, in-repo). Migration needs to handle this securely.

**Mitigation:**
1. **Never commit credentials.** `.gitignore` the credentials directory.
2. Move to environment variables for API keys.
3. OAuth tokens stored encrypted in Postgres `connector_tokens` table.
4. Docker secrets for production.
5. `.env.example` with all required variables documented.

---

## 6. Risk Priority Matrix

| Risk | Severity | Likelihood | Impact | Mitigation Effort | Priority |
|------|----------|-----------|--------|--------------------|----------|
| Feature creep (4.1) | CRITICAL | Very High | Project never ships | Medium (discipline) | **Address immediately** |
| OpenClaw fork divergence (1.1) | HIGH | High | Wasted effort, maintenance burden | Medium | **Phase 1** |
| Python → TS rewrite (3.1) | HIGH | High | Security bugs, delayed timeline | High | **Phase 1-3** |
| No existing tests (4.2) | HIGH | Certain | Silent regressions | Medium (ongoing) | **Every phase** |
| Hermes integration (1.2) | MEDIUM | Medium | Suboptimal orchestrator | Medium | **Phase 3** |
| GBrain knowledge layer (1.3) | MEDIUM | Medium | Retrieval quality issues | Medium | **Phase 2** |
| JSONL migration (2.1) | MEDIUM | Low | Data loss (small dataset) | Low | **Phase 2** |
| Python bridge (3.2) | MEDIUM | Medium | Integration complexity | Low | **Phase 3** |
| Dev velocity (5.1) | MEDIUM | High | Slow progress | Medium (ongoing) | **Every phase** |
| Deployment complexity (5.2) | MEDIUM | Medium | Ops burden | Medium | **Phase 5** |
| Undefined connectors (4.3) | MEDIUM | Low | Missing integrations | Low | **Phase 5** |
| Knowledge ingestion (2.2) | LOW | Low | Missing build intelligence | Low | **Phase 2** |
| Seen.json migration (2.3) | LOW | Low | Minor duplicates | Low | **Phase 2** |
| Secret management (5.3) | LOW | Low | Credential exposure | Low | **Phase 1** |

---

## 7. Go / No-Go Criteria for Phase 1

Before starting Phase 1 (Architecture Freeze), confirm:

- [x] All 4 audit documents completed and reviewed
- [ ] Tech stack decision finalized (TypeScript-first, Python pipelines) — **decided in plan**
- [ ] Scope for V1 explicitly cut (what's in, what's deferred)
- [ ] Deployment model confirmed (single-process V1 vs microservices)
- [ ] Database hosting decided (local Postgres for dev, DigitalOcean Compose Postgres for prod)
- [ ] Feature creep guardrails agreed (phase gates, vertical slice first)

---

## 8. Critical Success Factors

1. **Trust boundary first.** If the policy engine is wrong, everything else is unsafe.
2. **One vertical slice before broadening.** `/start` → intake → opportunity → operator → task → artifact, end-to-end.
3. **Postgres from day one.** No JSONL, no SQLite, no "we'll migrate later."
4. **Test critical paths.** Policy enforcement, DB operations, agent loop termination.
5. **Single-process V1.** Don't introduce network boundaries until you need them.
6. **Keep Python where it's strong.** Scraping, NLP, embeddings. Don't force TypeScript onto these.
7. **Ship something usable each phase.** Phase 2 delivers searchable YC data. Phase 3 delivers a working agent loop. Phase 4 delivers a Telegram bot you can talk to.

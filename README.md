# HELM Pilot

Open-source, self-hostable autonomous founder operating system. HELM Pilot helps founders assess fit, discover opportunities, evaluate real co-founder candidates, coordinate digital operators, build, launch, and apply, all behind a governed trust boundary.

## Architecture

Single-process Node.js server (V1) with PostgreSQL 17 + pgvector.

```
apps/
  telegram-bot/       Telegram bot (grammY, polling + webhook modes)
  telegram-miniapp/   Telegram Mini App (web UI)
  web/                Next.js 15 web dashboard

services/
  gateway/            Hono HTTP API (auth, CORS, rate limiting, SSE)
  orchestrator/       Trust boundary + agent loop + pg-boss jobs
  memory/             Knowledge layer (pgvector semantic + keyword search)
  founder-intel/      LLM-powered founder profile extraction
  cofounder-engine/   Operator role matching + team composition
  yc-intel/           YC company/batch/advice search
  product-factory/    Product spec generation from plans
  launch-engine/      Deploy artifacts + launch tracking

packages/
  db/                 Drizzle ORM schema (47 tables, 13 domains)
  shared/             Zod schemas, config, logger, LLM provider
  connectors/         External service integrations
  ui/                 Shared UI components
```

## Prerequisites

- Node.js >= 22
- Docker & Docker Compose (for PostgreSQL)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An LLM API key (OpenRouter recommended)
- `APP_URL` set to the public gateway URL you will use for OAuth callbacks

## Quickstart

```bash
# Clone
git clone https://github.com/Mindburn-Labs/helm-pilot.git
cd helm-pilot

# Configure
cp .env.example .env
# Edit .env — set `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `APP_URL`,
# `TELEGRAM_BOT_TOKEN`, and an LLM provider key at minimum

# Start PostgreSQL
docker compose -f infra/docker/docker-compose.yml up -d postgres

# Install dependencies
npm ci

# Run database migrations
npm run db:migrate

# Start dev server (all services)
npm run dev
```

The gateway starts on `http://localhost:3100` and the web app on `http://localhost:3000`. The Telegram bot connects via long polling in dev mode.

## Self-Hosting with Docker Compose

```bash
cp .env.example .env
# Edit .env with your production values

docker compose -f infra/docker/docker-compose.yml up -d
```

This starts PostgreSQL, the gateway on port `3100`, and the web app on port `3000`. The compose file now points the browser at `http://localhost:3100`, not an internal Docker hostname.

## Deploy to Fly.io

HELM Pilot deploys as **two apps**: the governance sidecar (`helm-pilot-helm`, running helm-oss) and the main Pilot service (`helm-pilot`). See [`infra/fly/README.md`](infra/fly/README.md) for the full runbook — deploy order, internal 6PN DNS wiring, upgrade/rollback, and cost. Short version:

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Create both apps + shared Postgres (one-time)
fly apps create helm-pilot-helm
fly apps create helm-pilot
fly postgres create --name helm-pilot-db --region ams
fly postgres attach helm-pilot-db --app helm-pilot       --database-name helm_pilot
fly postgres attach helm-pilot-db --app helm-pilot-helm  --database-name helm_governance

# Secrets
fly secrets set --app helm-pilot-helm \
  EVIDENCE_SIGNING_KEY=$(openssl rand -hex 32) \
  HELM_UPSTREAM_URL=https://openrouter.ai/api/v1 \
  OPENROUTER_API_KEY=your-key
fly secrets set --app helm-pilot \
  SESSION_SECRET=$(openssl rand -hex 32) \
  ENCRYPTION_KEY=$(openssl rand -hex 32) \
  TELEGRAM_BOT_TOKEN=your-token \
  TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Deploy sidecar first, then Pilot
fly deploy --config infra/fly/helm.fly.toml
fly deploy --config infra/fly/pilot.fly.toml

# Set Telegram webhook (one-time)
bash infra/scripts/set-telegram-webhook.sh
```

## Development

```bash
npm run dev          # Start all services (Turbo)
npm run build        # Build all workspaces
npm run typecheck    # TypeScript check all workspaces
npm test             # Run all tests (Vitest)
npm run db:generate  # Regenerate Drizzle migrations
npm run db:migrate   # Apply migrations
npm run db:studio    # Open Drizzle Studio (DB browser)
npm run format       # Prettier format
```

## API

All API routes (except `/health` and `/api/auth/*`) require authentication via:
- `Authorization: Bearer <session-token>` (from Telegram login), or
- `X-API-Key: <api-key>` (generated via `POST /api/auth/apikey`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (DB + pg-boss status) |
| POST | `/api/auth/telegram` | Authenticate via Telegram Web App |
| POST | `/api/auth/apikey` | Generate API key |
| DELETE | `/api/auth/session` | Logout |
| GET | `/api/status` | Workspace status summary for web + Mini App |
| GET | `/api/founder/profile` | Get founder profile |
| POST | `/api/founder/profile` | Upsert founder profile |
| POST | `/api/founder/analyze` | Analyze founder from text |
| GET | `/api/founder/candidates` | List real co-founder candidates |
| POST | `/api/founder/candidates/:id/score` | Score a co-founder candidate |
| GET | `/api/opportunities` | List opportunities |
| POST | `/api/opportunities/:id/score` | Queue opportunity scoring |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks/:id/run` | Run a task through the orchestrator |
| GET | `/api/operators` | List operators |
| GET | `/api/knowledge/search` | Search knowledge base |
| GET | `/api/connectors` | List connector definitions or workspace connector status |
| GET | `/api/connectors/:name/oauth/initiate` | Start OAuth flow for a connector |
| GET | `/api/yc/companies` | Search YC companies |
| GET | `/api/product/plans` | List product plans |
| GET | `/api/launch/artifacts` | List launch artifacts |
| GET | `/api/events/tasks` | SSE stream for task updates |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `APP_URL` | Yes | `http://localhost:3100` | Public gateway base URL used for OAuth callbacks |
| `TELEGRAM_BOT_TOKEN` | No | - | Telegram bot token (enables bot) |
| `TELEGRAM_WEBHOOK_SECRET` | No | - | Webhook HMAC secret (production) |
| `OPENROUTER_API_KEY` | Yes | - | LLM provider API key |
| `SESSION_SECRET` | Yes | - | Session token signing secret |
| `ENCRYPTION_KEY` | Yes | - | Connector token encryption key |
| `PORT` | No | 3100 | HTTP server port |
| `NODE_ENV` | No | development | Environment (development/production) |
| `LOG_LEVEL` | No | info | Pino log level |
| `ALLOWED_ORIGINS` | No | - | CORS allowed origins (comma-separated) |

See `.env.example` for the full list including optional providers and connectors.

## License

MIT

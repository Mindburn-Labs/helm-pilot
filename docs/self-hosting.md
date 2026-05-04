# Self-Hosting Pilot

Pilot is designed to run on your own infrastructure. This guide covers setup from zero to running.

## Prerequisites

- **Docker** 24+ and **Docker Compose** v2
- **Python** 3.10+ with `venv` and `pip` available for local pipeline execution
- A domain name (optional, for production)
- A Telegram bot token (for bot/mini-app features)
- For production: a HELM sidecar with an upstream LLM key configured on the sidecar
- For local direct-provider development: OpenRouter, Anthropic, OpenAI, or Ollama

## Quick Start (Clean Install)

We provide an interactive setup script for first-time deployments.

```bash
git clone https://github.com/mindburn-labs/pilot.git
cd pilot

# Run the interactive setup script
bash scripts/setup.sh
```

The script will check prerequisites, generate necessary secrets, start the database, run migrations, and test the API.

The gateway runs on port **3100**, the web UI on **3000**.

## Python / Scrapling Runtime

Pilot uses a local Python runtime for Scrapling-backed ingestion, YC sync, and operator-triggered fetch/extract work.

For local installs:

```bash
bash scripts/install-python-runtime.sh
./.venv-pipelines/bin/python scripts/verify-python-runtime.py
```

This creates `./.venv-pipelines`, installs the pinned pipeline dependencies from `pipelines/requirements.txt`, and installs Chromium for both Playwright and Patchright. Set `PYTHON_BIN=./.venv-pipelines/bin/python` in `.env` so the orchestrator uses that runtime.

## Environment Variables

For a complete list of required and optional environment variables, see the [Environment Reference](env-reference.md).

The setup script will generate the critical security tokens for you. Production deployments should set `HELM_GOVERNANCE_URL` and `HELM_FAIL_CLOSED=1`; direct provider keys are only needed when running Pilot without HELM.

## Development Setup (without Docker)

```bash
# Install dependencies
npm install

# Install the pinned Python pipeline runtime
bash scripts/install-python-runtime.sh

# Start PostgreSQL (or use Docker for just the DB)
docker compose -f infra/docker/docker-compose.yml up -d postgres

# Set DATABASE_URL
export DATABASE_URL=postgresql://helm:helm@localhost:5432/pilot

# Run migrations
npm run db:push

# Start all services in development
npm run dev
```

Verify the full runtime before using private YC flows:

```bash
PYTHON_BIN=./.venv-pipelines/bin/python ./scripts/launch-gate.sh
```

## Telegram Bot Setup

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Set the bot token in `.env` as `TELEGRAM_BOT_TOKEN`
3. Set up the webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://your-domain.com/api/telegram/webhook", "secret_token": "your-secret", "allowed_updates": ["message", "callback_query", "managed_bot"]}'
   ```
4. Set `TELEGRAM_WEBHOOK_SECRET` to match the `secret_token` above

### Founder-Owned Launch/Support Bot

Pilot can provision one founder-owned child bot through Telegram Managed Bots.

1. Open the main bot in BotFather's Mini App and enable **Bot Management Mode**.
2. Ensure `APP_URL` is the public HTTPS gateway URL.
3. Optionally set `TELEGRAM_MANAGER_BOT_USERNAME` to the main bot username without `@`.
4. From the main bot, run `/launchbot`, or use the Launch page / Mini App settings to create the native Telegram setup link.

Child bot tokens are encrypted in `tenant_secrets`. Child webhook secrets are stored only as hashes, and outbound support replies cross the HELM governance path before being sent.

## Telegram Mini App

1. Via BotFather, create a Web App for your bot
2. Set the URL to `https://your-domain.com/app/`
3. The mini app is served as static files from the gateway

## YC Session Capture

The `yc` connector uses founder-authorized session capture instead of OAuth.

1. Open **Settings** in the web app.
2. Grant the `yc` connector to your workspace.
3. Paste an exported browser storage-state JSON for your authorized YC session into the connector session box.
4. Click **Save Session**, then **Validate Session**.
5. Once validation succeeds, private YC matching syncs can run from the Discover surface or through background jobs.

All YC session snapshots are encrypted at rest using `ENCRYPTION_KEY`.

## Custom Domain (Non-DigitalOcean)

For non-DigitalOcean deployments, put a reverse proxy (Caddy, nginx, or Cloudflare Tunnel) in front:

```
# Caddyfile example
your-domain.com {
    reverse_proxy localhost:3100
}

app.your-domain.com {
    reverse_proxy localhost:3000
}
```

## DigitalOcean Deployment

Pilot ships on DigitalOcean as a Docker Compose stack on one Droplet. The HELM sidecar stays private on the Docker network, Pilot talks to `http://helm:8080`, and production remains fail-closed with `HELM_FAIL_CLOSED=1`.

```bash
cp infra/digitalocean/env.production.shared.example .env.production.shared
cp infra/digitalocean/env.production.helm.example .env.production.helm
cp infra/digitalocean/env.production.pilot.example .env.production.pilot
# Fill domain, database, pinned images, Pilot secrets, email,
# DO Spaces backup settings, evidence signing, and sidecar provider key.

export DO_SSH_KEYS=<digitalocean-ssh-key-id-or-fingerprint>
export DO_REGION=fra1
export DO_SIZE=s-2vcpu-4gb

bash infra/digitalocean/deploy.sh doctor
bash infra/digitalocean/deploy.sh create
export DO_DROPLET_IP=<new-droplet-ip>
bash infra/digitalocean/deploy.sh preload-helm
bash infra/digitalocean/deploy.sh deploy
```

See [infra/digitalocean/README.md](../infra/digitalocean/README.md) for the full runbook.

## Database

Pilot uses PostgreSQL 17 with pgvector for knowledge base search. The schema is managed by Drizzle ORM.

```bash
# Push schema to database
npm run db:push

# Generate a migration
npm run db:generate

# Open Drizzle Studio (DB browser)
npm run db:studio
```

## pgAdmin (Optional)

For local database inspection, start the dev-only Docker stack's debug profile:

```bash
docker compose -f infra/docker/docker-compose.yml --profile debug up -d
```

pgAdmin will be available at http://localhost:5050 (admin@pilot.local / admin).

## Backup & Restore

Use the included backup tooling to manage your PostgreSQL data.

```bash
# Create, encrypt, and upload a backup when S3_* and BACKUP_ENCRYPTION_PASSPHRASE are set
bash scripts/backup.sh create-and-upload

# List available backups
bash scripts/backup.sh list

# Verify a backup
bash scripts/backup.sh verify backups/pilot_YYYY...sql.gz.gpg

# Restore from a backup
bash scripts/backup.sh restore backups/pilot_YYYY...sql.gz.gpg
```

Production uploads must be encrypted. The deploy doctor requires DO Spaces settings and `BACKUP_ENCRYPTION_PASSPHRASE`.

In addition to the database backup, preserve local storage when using the default filesystem backend:

```bash
tar -czf pilot_storage_$(date +%Y%m%d_%H%M%S).tar.gz data/storage
```

That archive contains:

- raw crawl captures
- Scrapling adaptive selector databases
- crawl checkpoint directories

YC session snapshots live in the database (`connector_sessions`) and are therefore covered by PostgreSQL backups.

## Updating

```bash
git pull
docker compose -f infra/docker/docker-compose.yml build
docker compose -f infra/docker/docker-compose.yml up -d
# Run any new migrations
docker compose -f infra/docker/docker-compose.yml exec pilot npx drizzle-kit push
```

## Troubleshooting

**Health check fails:** Check `DATABASE_URL` is correct and PostgreSQL is reachable.

**Agent loop doesn't execute:** In production, check `/health` for `checks.helm: ok` and verify the HELM sidecar has its upstream provider key. In direct-provider development, set `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OLLAMA_BASE_URL` plus `OLLAMA_MODEL`.

**YC private sync fails:** Re-run `scripts/verify-python-runtime.py`, confirm the `yc` connector shows `Validated`, and save a fresh YC session snapshot if needed.

**Scrapling browser fetches fail locally:** Re-run `bash scripts/install-python-runtime.sh` and check that `PLAYWRIGHT_BROWSERS_PATH` and `PATCHRIGHT_BROWSERS_PATH` point to existing browser caches.

**Telegram commands don't work:** Verify the webhook is set and `TELEGRAM_BOT_TOKEN` matches.

**CORS errors in web UI:** Set `ALLOWED_ORIGINS` to include your web app URL.

# Self-Hosting HELM Pilot

HELM Pilot is designed to run on your own infrastructure. This guide covers setup from zero to running.

## Prerequisites

- **Docker** 24+ and **Docker Compose** v2
- A domain name (optional, for production)
- A Telegram bot token (for bot/mini-app features)
- An LLM API key (OpenRouter or Anthropic)

## Quick Start (Clean Install)

We provide an interactive setup script for first-time deployments.

```bash
git clone https://github.com/mindburn-labs/helm-pilot.git
cd helm-pilot

# Run the interactive setup script
bash scripts/setup.sh
```

The script will check prerequisites, generate necessary secrets, start the database, run migrations, and test the API.

The gateway runs on port **3100**, the web UI on **3000**.

## Environment Variables

For a complete list of required and optional environment variables, see the [Environment Reference](env-reference.md).

The setup script will generate the critical security tokens for you.

*One of `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` is required for the agent loop.

## Development Setup (without Docker)

```bash
# Install dependencies
npm install

# Start PostgreSQL (or use Docker for just the DB)
docker compose -f infra/docker/docker-compose.yml up -d postgres

# Set DATABASE_URL
export DATABASE_URL=postgresql://helm:helm@localhost:5432/helm_pilot

# Run migrations
npm run db:push

# Start all services in development
npm run dev
```

## Telegram Bot Setup

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Set the bot token in `.env` as `TELEGRAM_BOT_TOKEN`
3. Set up the webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://your-domain.com/api/telegram/webhook", "secret_token": "your-secret"}'
   ```
4. Set `TELEGRAM_WEBHOOK_SECRET` to match the `secret_token` above

## Telegram Mini App

1. Via BotFather, create a Web App for your bot
2. Set the URL to `https://your-domain.com/app/`
3. The mini app is served as static files from the gateway

## Custom Domain (Production)

For production, put a reverse proxy (Caddy, nginx, or Cloudflare Tunnel) in front:

```
# Caddyfile example
your-domain.com {
    reverse_proxy localhost:3100
}

app.your-domain.com {
    reverse_proxy localhost:3000
}
```

## Fly.io Deployment

HELM Pilot ships with a `fly.toml` for Fly.io:

```bash
fly launch
fly secrets set DATABASE_URL=... OPENROUTER_API_KEY=... TELEGRAM_BOT_TOKEN=...
fly deploy
```

## Database

HELM Pilot uses PostgreSQL 17 with pgvector for knowledge base search. The schema is managed by Drizzle ORM.

```bash
# Push schema to database
npm run db:push

# Generate a migration
npm run db:generate

# Open Drizzle Studio (DB browser)
npm run db:studio
```

## pgAdmin (Optional)

For database inspection, start the debug profile:

```bash
docker compose -f infra/docker/docker-compose.yml --profile debug up -d
```

pgAdmin will be available at http://localhost:5050 (admin@helm-pilot.local / admin).

## Backup & Restore

Use the included backup tooling to manage your PostgreSQL data.

```bash
# Create a backup
bash scripts/backup.sh create

# List available backups
bash scripts/backup.sh list

# Verify a backup
bash scripts/backup.sh verify backups/helm_pilot_YYYY...sql.gz

# Restore from a backup
bash scripts/backup.sh restore backups/helm_pilot_YYYY...sql.gz
```

For configured S3 uploads, use `bash scripts/backup.sh upload <file>`.

## Updating

```bash
git pull
docker compose -f infra/docker/docker-compose.yml build
docker compose -f infra/docker/docker-compose.yml up -d
# Run any new migrations
docker compose -f infra/docker/docker-compose.yml exec helm-pilot npx drizzle-kit push
```

## Troubleshooting

**Health check fails:** Check `DATABASE_URL` is correct and PostgreSQL is reachable.

**Agent loop doesn't execute:** Ensure `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` is set.

**Telegram commands don't work:** Verify the webhook is set and `TELEGRAM_BOT_TOKEN` matches.

**CORS errors in web UI:** Set `ALLOWED_ORIGINS` to include your web app URL.

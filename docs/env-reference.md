# Environment Variables Reference

Complete reference for all HELM Pilot configuration variables.

## Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string with pgvector | `postgresql://helm:helm@localhost:5432/helm_pilot` |
| `SESSION_SECRET` | 64-char hex secret for session token signing. Generate: `openssl rand -hex 32` | `a1b2c3...` |
| `OPENROUTER_API_KEY` | OpenRouter API key (or use `ANTHROPIC_API_KEY` instead) | `sk-or-v1-...` |

## Telegram

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | No | — | Bot token from [@BotFather](https://t.me/BotFather). Enables the Telegram bot. |
| `TELEGRAM_WEBHOOK_SECRET` | Prod | — | HMAC secret for webhook validation. Generate: `openssl rand -hex 32` |
| `TELEGRAM_OWNER_CHAT_ID` | No | — | Telegram chat ID of the bot owner. Enables admin commands and proactive notifications. |

> **Finding your chat ID:** Send `/start` to [@userinfobot](https://t.me/userinfobot) on Telegram.

## LLM Providers

At least one LLM provider key is required for the agent loop to function.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes* | OpenRouter key — routes to multiple models (recommended) |
| `ANTHROPIC_API_KEY` | Alt* | Direct Anthropic API key (fallback) |
| `OPENAI_API_KEY` | No | Direct OpenAI API key (additional fallback) |
| `LLM_MODEL` | No | Override default model. Default: `anthropic/claude-sonnet-4-20250514` via OpenRouter |
| `LLM_TEMPERATURE` | No | LLM temperature. Default: `0.7` |

\* One of `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` is required.

## Connectors (OAuth)

These enable real OAuth flows for external services. Without them, connectors operate in manual-token mode.

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | No | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth App client secret |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (for Gmail + Drive) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | Google OAuth redirect URI. Default: `{APP_URL}/api/connectors/gmail/oauth/callback` |
| `ENABLED_CONNECTORS` | No | Comma-separated list of connectors to strictly validate at startup (e.g., `github,gmail,gdrive`). Missing credentials for enabled connectors cause `fatal error → exit 1` in production. |

### Setting up GitHub OAuth

1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set Authorization callback URL to `https://your-domain.com/api/connectors/github/oauth/callback`
4. Copy Client ID and Client Secret to `.env`

### Setting up Google OAuth (Gmail + Drive)

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URIs:
   - `https://your-domain.com/api/connectors/gmail/oauth/callback`
   - `https://your-domain.com/api/connectors/gdrive/oauth/callback`
4. Enable the Gmail API and Google Drive API in the API Library
5. Copy Client ID and Client Secret to `.env`

## Connectors (Session Auth)

The YC connector uses founder-authorized browser session capture instead of OAuth.

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_URL` | Yes | Base URL used to return from the guided YC session-capture flow. |
| `ENCRYPTION_KEY` | Yes | Encrypts stored browser storage-state snapshots in `connector_sessions`. |

YC session state is stored separately from OAuth tokens. It powers authenticated reads and syncs for YC cofounder matching and other private YC workflows.

## Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes | `change-me-in-production` | Session token HMAC signing secret. **Must change in production.** |
| `ENCRYPTION_KEY` | Prod | dev fallback | AES-256-GCM key for encrypting connector tokens at rest. Generate: `openssl rand -hex 32` |
| `DAILY_BUDGET_MAX` | No | `500` | Maximum daily spend (EUR) across all tasks before kill switch |
| `PER_TASK_BUDGET_MAX` | No | `100` | Maximum spend per individual task |

> ⚠️ **Production requirement:** Both `SESSION_SECRET` and `ENCRYPTION_KEY` must be set to unique, random values.

## Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment. Set to `production` for production. |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`, `fatal`) |
| `ALLOWED_ORIGINS` | No | `*` (dev) | Comma-separated CORS allowed origins. Set to your domain in production. |
| `APP_URL` | No | `http://localhost:3100` | Public-facing URL of the app (used for OAuth redirect URIs) |
| `RUN_MIGRATIONS_ON_STARTUP` | No | `true` | When `true` (default), gateway runs pending Drizzle migrations on boot. Set `false` to manage migrations manually. |
| `PYTHON_BIN` | No | `python3` | Python executable used by the orchestrator for Scrapling-backed pipelines. For local installs, prefer `./.venv-pipelines/bin/python`. |
| `PLAYWRIGHT_BROWSERS_PATH` | No | repo-local cache or `/ms-playwright` in Docker | Browser binary cache used by dynamic Scrapling fetchers. |
| `PATCHRIGHT_BROWSERS_PATH` | No | repo-local cache or `/ms-patchright` in Docker | Browser binary cache used by stealth Scrapling sessions. |

## Email (Transactional)

Required in production to send magic-link login codes. In development, the `noop` provider logs the code and returns it in the HTTP response.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_PROVIDER` | No | `noop` | `resend` \| `smtp` \| `noop`. Use `noop` only in development. |
| `EMAIL_FROM` | No | `HELM Pilot <onboarding@helm-pilot.dev>` | Sender address |
| `RESEND_API_KEY` | If `resend` | — | API key from [resend.com](https://resend.com) |
| `SMTP_HOST` | If `smtp` | — | SMTP server hostname |
| `SMTP_PORT` | If `smtp` | `587` | SMTP port (587 STARTTLS, 465 TLS) |
| `SMTP_USER` | No | — | SMTP auth username |
| `SMTP_PASS` | No | — | SMTP auth password |
| `SMTP_SECURE` | No | auto | `true` for port 465, else STARTTLS |

> ⚠️ **Production requirement:** `EMAIL_PROVIDER` must be `resend` or `smtp`. The `noop` provider is dev-only; users cannot log in.

## Object Storage

For storing artifacts, launch assets, and raw ingestion captures. Falls back to local filesystem if not configured.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STORAGE_PROVIDER` | No | `local` | `local` or `s3` |
| `STORAGE_PATH` | No | `./data/storage` | Local storage directory (when using `local` provider) |
| `S3_ENDPOINT` | No | — | S3-compatible endpoint URL |
| `S3_BUCKET` | No | — | S3 bucket name |
| `S3_ACCESS_KEY` | No | — | S3 access key |
| `S3_SECRET_KEY` | No | — | S3 secret key |
| `S3_REGION` | No | `us-east-1` | S3 region |

When using local storage, HELM Pilot also persists:
- Scrapling adaptive selector databases under `STORAGE_PATH/adaptive`
- raw crawl captures under `STORAGE_PATH/raw`
- crawl checkpoints under `STORAGE_PATH/crawls`

## Error Reporting (Optional)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | No | — | Sentry DSN for error reporting. When unset, errors only hit local logs. |
| `RELEASE_VERSION` | No | — | Release tag for Sentry (e.g., git SHA). Helps correlate errors to deploys. |

## Search & Ranking

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COHERE_API_KEY` | No | — | Cohere API key for reranking search results. Improves opportunity and knowledge ranking. |

## Fly.io (Production)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FLY_APP_NAME` | No | — | Fly.io app name (set automatically by Fly runtime) |

> When using Fly Postgres, append `?sslmode=require` to `DATABASE_URL`.

## Backup

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKUP_DIR` | No | `./backups` | Local backup directory for `scripts/backup.sh` |

Backups can be uploaded to S3 using the `S3_*` variables above.

# Security Hardening Guide

Production-grade security configuration for HELM Pilot.

## Secrets Management

### Required Secrets

Every production deployment **must** generate unique values for:

```bash
# Generate all secrets at once
export SESSION_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

| Secret | Purpose | Risk if compromised |
|--------|---------|---------------------|
| `SESSION_SECRET` | HMAC signing for session tokens and OAuth state | Session forgery, CSRF bypass |
| `ENCRYPTION_KEY` | AES-256-GCM encryption of connector OAuth tokens | Token theft for GitHub/Gmail/Drive |
| `TELEGRAM_WEBHOOK_SECRET` | HMAC validation of incoming Telegram webhooks | Spoofed bot commands |

> ⚠️ **Never** use the default dev values in production. The `launch-gate.sh` script will flag this.

### Secret Rotation

Rotating secrets requires careful coordination:

1. **SESSION_SECRET rotation:** All active sessions become invalid. Users must re-authenticate.
2. **ENCRYPTION_KEY rotation:** Use the rotation tool (below) to re-encrypt tokens without losing them.
3. **TELEGRAM_WEBHOOK_SECRET rotation:** Update the webhook via Telegram API after changing.

#### ENCRYPTION_KEY Rotation Procedure

```bash
# 1. Generate the new key
NEW_KEY=$(openssl rand -hex 32)

# 2. Dry run to see how many rows will rotate
ENCRYPTION_KEY_OLD=$CURRENT_ENCRYPTION_KEY \
ENCRYPTION_KEY_NEW=$NEW_KEY \
DATABASE_URL=$PROD_DATABASE_URL \
  tsx scripts/rotate-encryption-key.ts --dry-run

# 3. Run the rotation (writes to DB)
ENCRYPTION_KEY_OLD=$CURRENT_ENCRYPTION_KEY \
ENCRYPTION_KEY_NEW=$NEW_KEY \
DATABASE_URL=$PROD_DATABASE_URL \
  tsx scripts/rotate-encryption-key.ts

# 4. Swap the env var in production (Fly.io example)
fly secrets set ENCRYPTION_KEY=$NEW_KEY --app helm-pilot

# 5. Verify — a subsequent agent run that uses a connector token should succeed
```

The rotation is idempotent per row; failed rows are logged and skipped so the rest continue.

## Prompt Injection Defense

The agent loop treats all user-controlled and tool-output content as **untrusted data**, not instructions. Strategy:

1. **Tagged context blocks.** User input (task context, operator goal, role, tool outputs) is JSON-encoded and wrapped in `<context tag="...">...</context>` tags. The LLM sees explicit framing, not raw prose.
2. **System-level instruction.** The plan prompt begins with a `SECURITY NOTICE` that tells the model content inside `<context>` blocks is untrusted.
3. **Tool allowlist.** The tool registry presents only the tools available for the current mode; requests for any other tool are rejected by the trust boundary.
4. **Trust boundary checks.** Before executing any tool call, the `TrustBoundary` evaluates kill switches, blocklists, budget, connector scope, and approval requirements. Fail-closed.

**Known gaps:**

- LLMs can still be convinced to misuse *allowed* tools in unexpected ways. Defense-in-depth: approval-gated sensitive tools (email send, financial actions, external posts).
- The model may leak short strings from context into its reply. Do not place credentials, other users' data, or raw secrets into agent-visible context.

**Testing:** See `services/orchestrator/src/__tests__/agent-loop.test.ts` for injection-resistance assertions.

## Data Deletion (GDPR Right to Erasure)

Authenticated users can delete their account via:

```http
DELETE /api/users/me
Authorization: Bearer <session-token>
```

Behaviour:

- The user row is deleted. FK cascades clean up `sessions`, `api_keys`, and `workspace_members`.
- Founder profile rows are `set_null`'d (FK policy).
- Any workspace where the user was the **sole member** is also deleted, cascading to its `tasks`, `operators`, `audit_log`, etc.
- Workspaces with other members are left intact; the user is just unlinked.

Admins may execute the same deletion on behalf of a user via a direct DB query; follow the same sequence.

## Authentication

### Session Tokens

- 30-day expiry, stored in database
- Transmitted via `Authorization: Bearer <token>` header
- Session can be revoked via `DELETE /api/auth/session`

### API Keys

- 365-day expiry, stored as SHA-256 hash (never plaintext)
- Transmitted via `X-API-Key: <key>` header
- One-time display on creation (hash is not reversible)

### Rate Limiting

Built-in rate limiting by endpoint category:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/auth/*` | 5 req | 1 min |
| `/api/connectors/*/grant` | 10 req | 1 min |
| `/api/connectors/*/token` | 10 req | 1 min |
| `/api/tasks` | 30 req | 1 min |
| `/api/*` (general) | 100 req | 1 min |

For production, consider adding an external rate limiter (Cloudflare, nginx) for DDoS protection.

## OAuth Security

### CSRF Protection

OAuth flows use HMAC-signed state parameters:
- State = `{connectorId}:{workspaceId}:{nonce}:{hmac}`
- HMAC computed with `SESSION_SECRET`
- States expire after 10 minutes
- Each state is single-use (deleted after callback)

### Redirect URI Validation

- Redirect URIs are registered per-provider at startup
- Only exact-match redirect URIs are accepted
- Production URIs must use HTTPS

### Token Storage

- OAuth access and refresh tokens are encrypted at rest using AES-256-GCM
- Key derivation: `scrypt(ENCRYPTION_KEY, 'helm-pilot-salt', 32)`
- IV is randomly generated per encryption operation
- Auth tag is stored alongside ciphertext for integrity verification

## Network Security

### HTTPS / TLS

HELM Pilot does not terminate TLS directly. Use a reverse proxy:

**Caddy (recommended — automatic HTTPS):**
```
your-domain.com {
    reverse_proxy localhost:3100
}
```

**nginx:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Cloudflare Tunnel (zero-config):**
```bash
cloudflared tunnel --url http://localhost:3100
```

### CORS

In production, explicitly set `ALLOWED_ORIGINS`:
```
ALLOWED_ORIGINS=https://your-domain.com,https://app.your-domain.com
```

The wildcard (`*`) is only allowed in development mode.

### Security Headers

HELM Pilot applies these headers automatically via Hono's `secureHeaders()`:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 0` (modern CSP preferred)
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security` (when behind HTTPS proxy)

## Trust Boundary

The orchestrator enforces a multi-layer trust boundary on every agent action:

```
Kill Switch → Policy Validation → Tool Blocklist → Budget → Connector Allowlist → Content Bans → Approval Gate
```

### Configuration

Set via workspace settings (`/api/workspace/settings`):

```json
{
  "policyConfig": {
    "killSwitch": false,
    "failClosed": true,
    "toolBlocklist": ["github_create_repo"],
    "contentBans": ["password", "secret"],
    "connectorAllowlist": ["github"],
    "requireApprovalFor": ["gmail_send", "github_create_repo"]
  },
  "budgetConfig": {
    "dailyTotalMax": 500,
    "perTaskMax": 100,
    "perOperatorMax": 200,
    "emergencyKill": 1000,
    "currency": "EUR"
  }
}
```

### Fail-Closed Behavior

If `failClosed` is `true` (default), any policy validation failure blocks all actions. This means:
- Missing or malformed budget config → all actions denied
- Budget values out of range → all actions denied
- Invalid `perTaskMax > dailyTotalMax` → all actions denied

## Database Security

### Connection Security

For production PostgreSQL:
```
DATABASE_URL=postgresql://helm:STRONG_PASSWORD@db-host:5432/helm_pilot?sslmode=require
```

### Backup Encryption

Backups created by `scripts/backup.sh` are compressed but **not encrypted**. For sensitive deployments:

```bash
# Encrypt backup with GPG
bash scripts/backup.sh create
gpg --symmetric --cipher-algo AES256 backups/helm_pilot_*.sql.gz

# Decrypt before restore
gpg --decrypt backup.sql.gz.gpg > backup.sql.gz
bash scripts/backup.sh restore backup.sql.gz
```

## Audit Trail

All mutating API requests are logged to the `audit_events` table:
- User ID, workspace ID, action, resource, timestamp
- Request body (sanitized — tokens/secrets redacted)
- Response status code

Query audit logs via `GET /api/audit?workspaceId=...`.

## Checklist

Before going to production, verify:

- [ ] `SESSION_SECRET` is a unique random value (not `change-me-in-production`)
- [ ] `ENCRYPTION_KEY` is set (not using dev fallback)
- [ ] `TELEGRAM_WEBHOOK_SECRET` is set for webhook mode
- [ ] `ALLOWED_ORIGINS` is set to specific domains (not `*`)
- [ ] `NODE_ENV=production` is set
- [ ] PostgreSQL uses SSL (`?sslmode=require`)
- [ ] HTTPS is terminated via reverse proxy
- [ ] Database password is strong and unique
- [ ] Backups are configured and tested
- [ ] `launch-gate.sh` passes all checks

# Fly.io deployment

HELM Pilot ships on Fly.io as **two apps**: the governance sidecar (`helm-pilot-helm`) and the main Pilot service (`helm-pilot`). They share a Postgres cluster (separate database per app) and talk over Fly's 6PN private network — no public traffic between them.

```
           ┌────────────────────────────────┐
           │   External users               │
           │   (Telegram, web, API keys)    │
           └──────────────┬─────────────────┘
                          │ HTTPS
                          ▼
          ┌────────────────────────────────┐
          │   helm-pilot     (3100)        │
          │   gateway + orchestrator + bot │
          └──────────────┬─────────────────┘
                         │  6PN:  helm-pilot-helm.internal:8080
                         ▼
          ┌────────────────────────────────┐
          │   helm-pilot-helm   (8080)     │
          │   helm-oss Guardian + proxy    │
          └──────────────┬─────────────────┘
                         │
                         ▼
          ┌────────────────────────────────┐
          │   OpenRouter / Anthropic /     │
          │   upstream LLM                 │
          └────────────────────────────────┘
```

## One-time setup

```bash
# 1. Create both apps
fly apps create helm-pilot-helm
fly apps create helm-pilot

# 2. Provision a shared Postgres cluster
fly postgres create --name helm-pilot-db --region ams --vm-size shared-cpu-1x --volume-size 10

# 3. Attach separate databases to each app
fly postgres attach helm-pilot-db --app helm-pilot          --database-name helm_pilot
fly postgres attach helm-pilot-db --app helm-pilot-helm     --database-name helm_governance
# (the attach command writes DATABASE_URL into each app's secrets)

# 4. Set HELM sidecar secrets
fly secrets set --app helm-pilot-helm \
  EVIDENCE_SIGNING_KEY="$(openssl rand -hex 32)" \
  HELM_UPSTREAM_URL="https://openrouter.ai/api/v1" \
  OPENROUTER_API_KEY="sk-or-..."          # HELM forwards with this key

# 5. Set HELM Pilot secrets (minimum)
fly secrets set --app helm-pilot \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  TELEGRAM_BOT_TOKEN="..." \
  TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)"
# Note: OPENROUTER_API_KEY lives on the sidecar ONLY. Pilot never carries an
# LLM provider key when HELM is fronting inference — that's the whole point.
```

## Deploy

**Deploy order matters.** Pilot runs fail-closed: if HELM is unreachable at
startup, /health reports degraded and every LLM call is denied. Deploy HELM
first, wait for green health, then deploy Pilot.

```bash
# 1. HELM sidecar
fly deploy --config infra/fly/helm.fly.toml
fly status --app helm-pilot-helm               # wait for 'running'

# 2. Smoke-check the sidecar (internal DNS only reachable from inside the org)
fly ssh console --app helm-pilot -C "wget -qO- http://helm-pilot-helm.internal:8081/healthz"
#   → should print {"status":"ok","version":"0.3.0"}

# 3. Pilot
fly deploy --config infra/fly/pilot.fly.toml
fly status --app helm-pilot                    # wait for 'running'

# 4. Set Telegram webhook (one-time per deploy of a new domain)
TELEGRAM_BOT_TOKEN=... APP_URL=https://helm-pilot.fly.dev bash infra/scripts/set-telegram-webhook.sh
```

## Upgrading HELM

Because Pilot fails closed on HELM unreachability, upgrades need a staged
approach. `min_machines_running = 1` in helm.fly.toml holds at least one
instance during rolling deploys, so short upgrades don't trigger Pilot's
circuit breaker.

```bash
# Pin a tested HELM version and roll
fly deploy --config infra/fly/helm.fly.toml --image ghcr.io/mindburn-labs/helm-oss:0.3.1
fly status --app helm-pilot-helm
```

If HELM starts denying unexpectedly after an upgrade, check
`GET /api/governance/status` on Pilot — the latest health snapshot is cached
in `helm_health_snapshots`.

## Rollback

HELM sidecar:
```bash
fly releases --app helm-pilot-helm
fly deploy --config infra/fly/helm.fly.toml --image <previous-digest>
```

Pilot:
```bash
fly releases --app helm-pilot
fly deploy --config infra/fly/pilot.fly.toml --image <previous-digest>
```

Rolling back Pilot while keeping HELM constant is safe. Rolling back HELM may
invalidate evidence pack signatures issued under a newer policy bundle version;
operators should download the evidence via `GET /api/governance/receipts` and
re-verify offline if the upstream policy version changes.

## Building without the `helm-oss` source tree

The default `infra/fly/helm.fly.toml` builds from `../../../helm-oss` (sibling
repo). CI/CD pipelines that don't clone helm-oss alongside Pilot should drop
the `[build]` block and pin a published image:

```toml
[build]
  image = "ghcr.io/mindburn-labs/helm-oss:0.3.0"
```

## Monitoring

- Pilot metrics: `https://helm-pilot.fly.dev/metrics` (Prometheus format)
- HELM metrics: exposed internally at `http://helm-pilot-helm.internal:8080/metrics`
- Log tail: `fly logs --app helm-pilot` / `fly logs --app helm-pilot-helm`
- Alertmanager rules: shipped with Phase 9 (see `docs/runbook.md`)

## Cost

At rest (both apps scale to zero on idle): ~$0/mo.
Sustained traffic for a solo-founder workspace: ~$15–25/mo (shared-cpu-1x HELM,
shared-cpu-2x Pilot, 10GB Postgres, minor LLM cost passed through upstream).

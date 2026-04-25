# DigitalOcean Deployment

HELM Pilot now uses DigitalOcean Droplets plus Docker Compose as the production deployment path. The topology is one Droplet running:

- PostgreSQL 17 with pgvector
- HELM governance sidecar
- Pilot gateway
- Next.js web app
- Caddy TLS reverse proxy
- optional scheduled backup runner

This keeps the HELM sidecar private on the Docker network and keeps production fail-closed with `HELM_FAIL_CLOSED=1`.

## Prerequisites

- `doctl` authenticated with `doctl auth init`
- an SSH key registered in DigitalOcean
- a DNS `A` record for your production domain pointed at the Droplet IP
- a published HELM sidecar image in `HELM_IMAGE`

DigitalOcean's `doctl compute droplet create` supports `--user-data-file`, which this runbook uses for `cloud-init` bootstrapping. The provision script enables DigitalOcean monitoring and backups at Droplet creation time.

## Configure

```bash
cp infra/digitalocean/env.production.example .env.production
openssl rand -hex 32 # use for SESSION_SECRET
openssl rand -hex 32 # use for ENCRYPTION_KEY
openssl rand -hex 32 # use for POSTGRES_PASSWORD
openssl rand -hex 32 # use for TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 32 # use for EVIDENCE_SIGNING_KEY
```

Edit `.env.production` and set at minimum:

- `DOMAIN`
- `APP_URL`
- `ALLOWED_ORIGINS`
- `POSTGRES_PASSWORD`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `HELM_IMAGE`
- `HELM_UPSTREAM_URL`
- one upstream LLM provider key for the HELM sidecar

Do not set direct Pilot LLM keys for production fallback. Provider keys live on the HELM sidecar and Pilot talks to `http://helm:8080` only.

## Create And Deploy

```bash
export DO_SSH_KEYS=<digitalocean-ssh-key-id-or-fingerprint>
export DO_REGION=nyc3
export DO_SIZE=s-2vcpu-4gb
export ENV_FILE=.env.production

bash infra/digitalocean/deploy.sh create
```

The script creates the Droplet with `cloud-init`, waits for Docker to be ready, copies this checkout to `/opt/helm-pilot/current`, writes `.env`, and runs:

```bash
docker compose -f infra/digitalocean/docker-compose.yml up -d --build
```

For an existing Droplet:

```bash
export DO_DROPLET_IP=<ip>
export ENV_FILE=.env.production
bash infra/digitalocean/deploy.sh deploy
```

## Verify

```bash
curl -fsS https://$DOMAIN/health | jq
curl -fsS https://$DOMAIN/metrics | head
HELM_FAIL_CLOSED=1 BASE_URL=https://$DOMAIN bash scripts/smoke-production-governance.sh
```

`/health` must report `checks.helm: "ok"` before launch. If it does not, check the sidecar first:

```bash
ssh root@$DO_DROPLET_IP
cd /opt/helm-pilot/current
docker compose -f infra/digitalocean/docker-compose.yml logs --tail=200 helm
docker compose -f infra/digitalocean/docker-compose.yml exec helm wget -qO- http://localhost:8081/healthz
```

## Operations

```bash
# Status
bash infra/digitalocean/deploy.sh status

# Logs
ssh root@$DO_DROPLET_IP 'cd /opt/helm-pilot/current && docker compose -f infra/digitalocean/docker-compose.yml logs -f --tail=200 helm-pilot'

# Restart
ssh root@$DO_DROPLET_IP 'cd /opt/helm-pilot/current && docker compose -f infra/digitalocean/docker-compose.yml restart helm-pilot'

# Backup
ssh root@$DO_DROPLET_IP 'cd /opt/helm-pilot/current && docker compose -f infra/digitalocean/docker-compose.yml exec helm-pilot bash /app/scripts/backup.sh create'
```

Enable daily backups by adding the profile when starting the stack:

```bash
docker compose -f infra/digitalocean/docker-compose.yml --profile backup up -d
```

## Rollback

The deployment script keeps persistent data in Docker volumes and replaces only the uploaded application files. To roll back from your workstation:

```bash
git log --oneline -20
git checkout <known-good-sha>
ENV_FILE=.env.production DO_DROPLET_IP=<ip> bash infra/digitalocean/deploy.sh deploy
```

Run the production smoke test after the rollback.

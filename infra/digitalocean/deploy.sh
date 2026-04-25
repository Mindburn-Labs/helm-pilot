#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ACTION="${1:-deploy}"
ACTION_ARG="${2:-}"
DROPLET_NAME="${DO_DROPLET_NAME:-helm-pilot-prod}"
DO_REGION="${DO_REGION:-fra1}"
DO_SIZE="${DO_SIZE:-s-2vcpu-4gb}"
DO_IMAGE="${DO_IMAGE:-ubuntu-24-04-x64}"
DO_SSH_KEYS="${DO_SSH_KEYS:-}"
DO_TAGS="${DO_TAGS:-helm-pilot,production}"
REMOTE_USER="${DO_REMOTE_USER:-root}"
REMOTE_BASE_DIR="${DO_REMOTE_BASE_DIR:-/opt/helm-pilot}"
REMOTE_DIR="${DO_REMOTE_DIR:-$REMOTE_BASE_DIR/current}"
REMOTE_RELEASES_DIR="${DO_REMOTE_RELEASES_DIR:-$REMOTE_BASE_DIR/releases}"
RELEASE_ID="${DEPLOY_RELEASE_ID:-$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
ENV_DIR="${ENV_DIR:-.}"
ENV_SHARED_FILE="${ENV_SHARED_FILE:-$ENV_DIR/.env.production.shared}"
ENV_HELM_FILE="${ENV_HELM_FILE:-$ENV_DIR/.env.production.helm}"
ENV_PILOT_FILE="${ENV_PILOT_FILE:-$ENV_DIR/.env.production.pilot}"
COMPOSE=(docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml)

usage() {
  cat <<'USAGE'
Usage:
  ENV_DIR=. DO_SSH_KEYS=<fingerprint-or-id> bash infra/digitalocean/deploy.sh create
  ENV_DIR=. DO_DROPLET_IP=<ip> bash infra/digitalocean/deploy.sh deploy
  DO_DROPLET_IP=<ip> bash infra/digitalocean/deploy.sh rollback [release-id-or-path]
  ENV_DIR=. bash infra/digitalocean/deploy.sh doctor
  DO_DROPLET_IP=<ip> bash infra/digitalocean/deploy.sh status
  DO_DROPLET_IP=<ip> bash infra/digitalocean/deploy.sh smoke

Required env files:
  .env.production.shared  shared non-provider configuration
  .env.production.helm    HELM sidecar provider keys and evidence settings
  .env.production.pilot   Pilot secrets and email settings, no direct LLM keys

Legacy ENV_FILE is intentionally unsupported because one shared env leaks
sidecar provider keys into Pilot.
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

env_value() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n1 || true)"
  printf '%s' "${line#*=}"
}

require_file() {
  [[ -f "$1" ]] || die "required env file not found: $1"
}

require_value() {
  local file="$1"
  local key="$2"
  local value
  value="$(env_value "$file" "$key")"
  [[ -n "$value" ]] || die "$key must be set in $file"
  case "$value" in
    change-me*|changeme*|example|example.com|helm|password)
      die "$key in $file still looks like a placeholder"
      ;;
  esac
}

forbid_value() {
  local file="$1"
  local key="$2"
  local value
  value="$(env_value "$file" "$key")"
  [[ -z "$value" ]] || die "$key must not be set in $file; provider keys belong in .env.production.helm"
}

validate_env_files() {
  [[ -z "${ENV_FILE:-}" ]] || die "ENV_FILE is no longer supported; use split .env.production.{shared,helm,pilot} files"

  require_file "$ENV_SHARED_FILE"
  require_file "$ENV_HELM_FILE"
  require_file "$ENV_PILOT_FILE"

  require_value "$ENV_SHARED_FILE" DOMAIN
  require_value "$ENV_SHARED_FILE" APP_URL
  require_value "$ENV_SHARED_FILE" ALLOWED_ORIGINS
  require_value "$ENV_SHARED_FILE" POSTGRES_PASSWORD
  require_value "$ENV_SHARED_FILE" POSTGRES_DB
  require_value "$ENV_SHARED_FILE" HELM_POSTGRES_DB
  require_value "$ENV_SHARED_FILE" HELM_IMAGE

  [[ "$(env_value "$ENV_SHARED_FILE" APP_URL)" == https://* ]] || die "APP_URL must be HTTPS"
  [[ "$(env_value "$ENV_SHARED_FILE" ALLOWED_ORIGINS)" != "*" ]] || die "ALLOWED_ORIGINS cannot be '*' in production"

  require_value "$ENV_HELM_FILE" HELM_UPSTREAM_URL
  require_value "$ENV_HELM_FILE" EVIDENCE_SIGNING_KEY
  if [[ -z "$(env_value "$ENV_HELM_FILE" OPENROUTER_API_KEY)$(env_value "$ENV_HELM_FILE" ANTHROPIC_API_KEY)$(env_value "$ENV_HELM_FILE" OPENAI_API_KEY)" ]]; then
    die "set at least one upstream provider key in $ENV_HELM_FILE"
  fi

  require_value "$ENV_PILOT_FILE" SESSION_SECRET
  require_value "$ENV_PILOT_FILE" ENCRYPTION_KEY
  require_value "$ENV_PILOT_FILE" TELEGRAM_WEBHOOK_SECRET
  [[ "$(env_value "$ENV_PILOT_FILE" HELM_FAIL_CLOSED)" == "1" ]] || die "HELM_FAIL_CLOSED=1 is required in $ENV_PILOT_FILE"
  forbid_value "$ENV_PILOT_FILE" OPENROUTER_API_KEY
  forbid_value "$ENV_PILOT_FILE" ANTHROPIC_API_KEY
  forbid_value "$ENV_PILOT_FILE" OPENAI_API_KEY
  forbid_value "$ENV_PILOT_FILE" VOYAGE_API_KEY
  require_value "$ENV_SHARED_FILE" S3_ENDPOINT
  require_value "$ENV_SHARED_FILE" S3_BUCKET
  require_value "$ENV_PILOT_FILE" S3_ACCESS_KEY
  require_value "$ENV_PILOT_FILE" S3_SECRET_KEY
  require_value "$ENV_PILOT_FILE" BACKUP_ENCRYPTION_PASSPHRASE

  local email_provider
  email_provider="$(env_value "$ENV_PILOT_FILE" EMAIL_PROVIDER)"
  case "$email_provider" in
    resend)
      require_value "$ENV_PILOT_FILE" RESEND_API_KEY
      ;;
    smtp)
      require_value "$ENV_PILOT_FILE" SMTP_HOST
      require_value "$ENV_PILOT_FILE" SMTP_USER
      require_value "$ENV_PILOT_FILE" SMTP_PASS
      ;;
    *)
      die "EMAIL_PROVIDER must be resend or smtp in production"
      ;;
  esac
  require_value "$ENV_PILOT_FILE" EMAIL_FROM
}

compose_doctor() {
  validate_env_files
  require_cmd docker
  cp "$ENV_SHARED_FILE" .env.production.shared
  cp "$ENV_HELM_FILE" .env.production.helm
  cp "$ENV_PILOT_FILE" .env.production.pilot
  "${COMPOSE[@]}" config >/dev/null
  echo "DigitalOcean production doctor passed."
}

droplet_ip() {
  if [[ -n "${DO_DROPLET_IP:-}" ]]; then
    printf '%s\n' "$DO_DROPLET_IP"
    return
  fi
  require_cmd doctl
  doctl compute droplet get "$DROPLET_NAME" --format PublicIPv4 --no-header 2>/dev/null | tr -d '[:space:]'
}

wait_for_cloud_init() {
  local ip="$1"
  echo "Waiting for cloud-init on $ip ..."
  for _ in {1..60}; do
    if ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" 'test -f /opt/helm-pilot/cloud-init-ready' >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  die "cloud-init did not finish in time; inspect /var/log/cloud-init-output.log on $ip"
}

create_droplet() {
  validate_env_files
  require_cmd doctl
  [[ -n "$DO_SSH_KEYS" ]] || die "DO_SSH_KEYS is required for droplet creation"

  if ip="$(droplet_ip)" && [[ -n "$ip" ]]; then
    echo "Droplet $DROPLET_NAME already exists at $ip"
    wait_for_cloud_init "$ip"
    deploy_to "$ip"
    return
  fi

  echo "Creating DigitalOcean Droplet $DROPLET_NAME in $DO_REGION ..."
  ip="$(
    doctl compute droplet create "$DROPLET_NAME" \
      --region "$DO_REGION" \
      --size "$DO_SIZE" \
      --image "$DO_IMAGE" \
      --ssh-keys "$DO_SSH_KEYS" \
      --enable-monitoring \
      --enable-backups \
      --tag-names "$DO_TAGS" \
      --user-data-file "$ROOT_DIR/infra/digitalocean/cloud-init.yml" \
      --wait \
      --format PublicIPv4 \
      --no-header
  )"
  ip="$(printf '%s' "$ip" | tr -d '[:space:]')"
  [[ -n "$ip" ]] || die "DigitalOcean did not return a public IPv4"
  echo "Droplet created: $ip"
  wait_for_cloud_init "$ip"
  deploy_to "$ip"
}

deploy_to() {
  local ip="$1"
  local release_dir="$REMOTE_RELEASES_DIR/$RELEASE_ID"
  validate_env_files
  require_cmd rsync
  require_cmd ssh

  echo "Deploying checkout to $REMOTE_USER@$ip:$release_dir ..."
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" "mkdir -p '$REMOTE_RELEASES_DIR' '$release_dir'"
  rsync -az --delete \
    --exclude '.git' \
    --exclude '.turbo' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.next' \
    --exclude 'coverage' \
    --exclude 'backups' \
    --exclude 'data' \
    --exclude '.venv-pipelines' \
    --exclude '.env*' \
    ./ "$REMOTE_USER@$ip:$release_dir/"

  scp "${SSH_OPTS[@]}" "$ENV_SHARED_FILE" "$REMOTE_USER@$ip:$release_dir/.env.production.shared"
  scp "${SSH_OPTS[@]}" "$ENV_HELM_FILE" "$REMOTE_USER@$ip:$release_dir/.env.production.helm"
  scp "${SSH_OPTS[@]}" "$ENV_PILOT_FILE" "$REMOTE_USER@$ip:$release_dir/.env.production.pilot"

  echo "Starting HELM Pilot on DigitalOcean ..."
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" "
    set -euo pipefail
    cd '$release_dir'
    find packages services apps -type d \( -name dist -o -name .next \) -prune -exec rm -rf {} +
    docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml config >/dev/null
    docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml up -d --build
    ln -sfnT '$release_dir' '$REMOTE_DIR'
    ls -1dt '$REMOTE_RELEASES_DIR'/* 2>/dev/null | tail -n +4 | xargs -r rm -rf
    docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml ps
  "

  echo "Deployed. Verify with:"
  echo "  HELM_FAIL_CLOSED=1 API_URL=https://$(env_value "$ENV_SHARED_FILE" DOMAIN) bash scripts/smoke-production-governance.sh"
}

status_remote() {
  local ip
  ip="$(droplet_ip)"
  [[ -n "$ip" ]] || die "set DO_DROPLET_IP or create a droplet named $DROPLET_NAME"
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" "cd '$REMOTE_DIR' && docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml ps"
}

rollback_remote() {
  local ip target
  ip="$(droplet_ip)"
  [[ -n "$ip" ]] || die "set DO_DROPLET_IP or create a droplet named $DROPLET_NAME"
  target="$ACTION_ARG"

  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" \
    "REMOTE_DIR='$REMOTE_DIR' REMOTE_RELEASES_DIR='$REMOTE_RELEASES_DIR' TARGET_RELEASE='$target' bash -s" <<'REMOTE'
set -euo pipefail
target="$TARGET_RELEASE"
if [[ -z "$target" ]]; then
  current="$(readlink -f "$REMOTE_DIR" 2>/dev/null || true)"
  while IFS= read -r candidate; do
    if [[ "$candidate" != "$current" ]]; then
      target="$candidate"
      break
    fi
  done < <(ls -1dt "$REMOTE_RELEASES_DIR"/* 2>/dev/null || true)
else
  case "$target" in
    /*) ;;
    *) target="$REMOTE_RELEASES_DIR/$target" ;;
  esac
fi
[[ -n "$target" && -d "$target" ]] || {
  echo "No rollback release found under $REMOTE_RELEASES_DIR" >&2
  exit 1
}
cd "$target"
docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml config >/dev/null
docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml up -d --build
ln -sfnT "$target" "$REMOTE_DIR"
docker compose -p helm-pilot --env-file .env.production.shared -f infra/digitalocean/docker-compose.yml ps
echo "Rolled back to $target"
REMOTE
}

smoke_remote() {
  local ip domain
  validate_env_files
  ip="$(droplet_ip)"
  [[ -n "$ip" ]] || die "set DO_DROPLET_IP or create a droplet named $DROPLET_NAME"
  domain="$(env_value "$ENV_SHARED_FILE" DOMAIN)"
  HELM_FAIL_CLOSED=1 API_URL="https://$domain" bash scripts/smoke-production-governance.sh
}

case "$ACTION" in
  doctor) compose_doctor ;;
  create) create_droplet ;;
  deploy)
    ip="$(droplet_ip)"
    [[ -n "$ip" ]] || die "set DO_DROPLET_IP or create a droplet named $DROPLET_NAME"
    wait_for_cloud_init "$ip"
    deploy_to "$ip"
    ;;
  status) status_remote ;;
  rollback) rollback_remote ;;
  smoke) smoke_remote ;;
  -h|--help|help) usage ;;
  *) usage; die "unknown action: $ACTION" ;;
esac

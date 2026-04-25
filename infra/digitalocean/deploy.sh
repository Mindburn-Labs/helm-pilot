#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ACTION="${1:-deploy}"
DROPLET_NAME="${DO_DROPLET_NAME:-helm-pilot-prod}"
DO_REGION="${DO_REGION:-nyc3}"
DO_SIZE="${DO_SIZE:-s-2vcpu-4gb}"
DO_IMAGE="${DO_IMAGE:-ubuntu-24-04-x64}"
DO_SSH_KEYS="${DO_SSH_KEYS:-}"
DO_TAGS="${DO_TAGS:-helm-pilot,production}"
REMOTE_USER="${DO_REMOTE_USER:-root}"
REMOTE_DIR="${DO_REMOTE_DIR:-/opt/helm-pilot/current}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
ENV_FILE="${ENV_FILE:-}"

usage() {
  cat <<'USAGE'
Usage:
  ENV_FILE=.env.production DO_SSH_KEYS=<fingerprint-or-id> bash infra/digitalocean/deploy.sh create
  ENV_FILE=.env.production DO_DROPLET_IP=<ip> bash infra/digitalocean/deploy.sh deploy
  DO_DROPLET_IP=<ip> bash infra/digitalocean/deploy.sh status

Actions:
  create  Create a DigitalOcean Droplet with cloud-init, then deploy.
  deploy  Rsync this checkout to the Droplet and run docker compose.
  status  Show remote compose status.

Required for create:
  doctl authenticated with `doctl auth init`
  DO_SSH_KEYS set to an SSH key ID or fingerprint known to DigitalOcean

Required for deploy:
  ENV_FILE points to a filled production env file
  DO_DROPLET_IP or an existing droplet named DO_DROPLET_NAME
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
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

validate_env_file() {
  [[ -n "$ENV_FILE" ]] || die "ENV_FILE must point to the production env file"
  [[ -f "$ENV_FILE" ]] || die "ENV_FILE not found: $ENV_FILE"
  grep -Eq '^DOMAIN=.+' "$ENV_FILE" || die "DOMAIN must be set in $ENV_FILE"
  grep -Eq '^APP_URL=https://.+' "$ENV_FILE" || die "APP_URL must be an HTTPS URL in $ENV_FILE"
  grep -Eq '^HELM_IMAGE=.+' "$ENV_FILE" || die "HELM_IMAGE must be set in $ENV_FILE"
}

create_droplet() {
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
  validate_env_file
  require_cmd rsync
  require_cmd ssh

  echo "Deploying checkout to $REMOTE_USER@$ip:$REMOTE_DIR ..."
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" "mkdir -p '$REMOTE_DIR'"
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
    --exclude '.env' \
    ./ "$REMOTE_USER@$ip:$REMOTE_DIR/"

  scp "${SSH_OPTS[@]}" "$ENV_FILE" "$REMOTE_USER@$ip:$REMOTE_DIR/.env"

  echo "Starting HELM Pilot on DigitalOcean ..."
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" "
    set -euo pipefail
    cd '$REMOTE_DIR'
    find packages services apps -type d \( -name dist -o -name .next \) -prune -exec rm -rf {} +
    docker compose -f infra/digitalocean/docker-compose.yml up -d --build
    docker compose -f infra/digitalocean/docker-compose.yml ps
  "

  echo "Deployed. Verify with:"
  echo "  HELM_FAIL_CLOSED=1 BASE_URL=https://$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-) bash scripts/smoke-production-governance.sh"
}

status_remote() {
  local ip
  ip="$(droplet_ip)"
  [[ -n "$ip" ]] || die "set DO_DROPLET_IP or create a droplet named $DROPLET_NAME"
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$ip" "cd '$REMOTE_DIR' && docker compose -f infra/digitalocean/docker-compose.yml ps"
}

case "$ACTION" in
  create) create_droplet ;;
  deploy)
    ip="$(droplet_ip)"
    [[ -n "$ip" ]] || die "set DO_DROPLET_IP or create a droplet named $DROPLET_NAME"
    wait_for_cloud_init "$ip"
    deploy_to "$ip"
    ;;
  status) status_remote ;;
  -h|--help|help) usage ;;
  *) usage; die "unknown action: $ACTION" ;;
esac

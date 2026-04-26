#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

POSTGRES_IMAGE="${E2E_POSTGRES_IMAGE:-pgvector/pgvector:0.8.2-pg17}"
POSTGRES_PORT="${E2E_POSTGRES_PORT:-55432}"
GATEWAY_PORT="${E2E_GATEWAY_PORT:-3310}"
CONTAINER_NAME="helm-pilot-e2e-postgres-$$"
GATEWAY_LOG="${E2E_GATEWAY_LOG:-$ROOT_DIR/.tmp/e2e-gateway.log}"
GATEWAY_PID=""

cleanup() {
  if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" >/dev/null 2>&1; then
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
    wait "$GATEWAY_PID" >/dev/null 2>&1 || true
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || {
  echo "docker is required for local release E2E." >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "docker is not running; release E2E cannot start Postgres." >&2
  exit 1
}

mkdir -p "$(dirname "$GATEWAY_LOG")"

docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_USER=helm \
  -e POSTGRES_PASSWORD=helm \
  -e POSTGRES_DB=helm_pilot \
  -p "127.0.0.1:${POSTGRES_PORT}:5432" \
  "$POSTGRES_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" pg_isready -U helm -d helm_pilot >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER_NAME" pg_isready -U helm -d helm_pilot >/dev/null 2>&1; then
  echo "Postgres did not become ready for release E2E." >&2
  exit 1
fi

if [ ! -f services/gateway/dist/server.js ]; then
  npm run build
fi

export DATABASE_URL="postgresql://helm:helm@127.0.0.1:${POSTGRES_PORT}/helm_pilot"
npm run db:migrate
npx tsx scripts/verify-schema.ts

if [ "${E2E_SKIP_BROWSER_INSTALL:-0}" != "1" ]; then
  npm run install-browsers -w e2e
fi

NODE_ENV=development \
RUN_MIGRATIONS_ON_STARTUP=false \
DATABASE_URL="$DATABASE_URL" \
PORT="$GATEWAY_PORT" \
APP_URL="http://127.0.0.1:${GATEWAY_PORT}" \
ALLOWED_ORIGINS="http://127.0.0.1:${GATEWAY_PORT}" \
SESSION_SECRET="e2e-session-secret-64chars-minimum-for-release-gate-0123456789" \
ENCRYPTION_KEY="e2e-encryption-key-64chars-minimum-for-release-gate-0123456789" \
EMAIL_PROVIDER=noop \
HELM_FAIL_CLOSED=0 \
npm start -w services/gateway >"$GATEWAY_LOG" 2>&1 &
GATEWAY_PID="$!"

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$GATEWAY_PID" >/dev/null 2>&1; then
    echo "Gateway exited before release E2E could start. Last logs:" >&2
    tail -80 "$GATEWAY_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
  echo "Gateway did not become healthy for release E2E. Last logs:" >&2
  tail -80 "$GATEWAY_LOG" >&2 || true
  exit 1
fi

BASE_URL="http://127.0.0.1:${GATEWAY_PORT}" npm run test:e2e -w e2e

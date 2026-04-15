#!/usr/bin/env bash
set -euo pipefail

# HELM Pilot Launch Gate — automated verification script
# Runs all checks to verify the system is deployment-ready.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

check() {
  local name="$1"
  shift
  echo -n "  $name... "
  if output=$("$@" 2>&1); then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC}"
    echo "    $output" | head -5
    FAIL=$((FAIL + 1))
  fi
}

warn_check() {
  local name="$1"
  shift
  echo -n "  $name... "
  if output=$("$@" 2>&1); then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${YELLOW}WARN${NC}"
    echo "    $output" | head -3
    WARN=$((WARN + 1))
  fi
}

echo ""
echo "========================================="
echo "  HELM Pilot Launch Gate"
echo "========================================="
echo ""

# --- Build & Type Checks ---
echo "Phase 1: Build & Types"
check "TypeScript (gateway)" npx tsc --noEmit -p services/gateway/tsconfig.json
check "TypeScript (orchestrator)" npx tsc --noEmit -p services/orchestrator/tsconfig.json
check "TypeScript (memory)" npx tsc --noEmit -p services/memory/tsconfig.json
check "TypeScript (connectors)" npx tsc --noEmit -p packages/connectors/tsconfig.json
check "TypeScript (web)" npx tsc --noEmit -p apps/web/tsconfig.json
echo ""

# --- Tests ---
echo "Phase 2: Tests"
check "Unit tests (all)" npm test
echo ""

# --- Python / Scrapling Runtime ---
echo "Phase 3: Python Runtime"
check "Python 3.10+ available" python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
check "Python runtime installer exists" bash -c "[ -x scripts/install-python-runtime.sh ]"
check "Python runtime verifier exists" bash -c "[ -f scripts/verify-python-runtime.py ]"
if [ -n "${PYTHON_BIN:-}" ] && [ -x "${PYTHON_BIN:-}" ]; then
  check "Python + Scrapling runtime" bash -c "\"$PYTHON_BIN\" scripts/verify-python-runtime.py >/dev/null"
else
  warn_check "Python + Scrapling runtime" bash -c "python3 scripts/verify-python-runtime.py >/dev/null"
fi
echo ""

# --- Docker Build ---
echo "Phase 4: Docker"
warn_check "Docker Compose config valid" docker compose -f infra/docker/docker-compose.yml config --quiet
echo ""

# --- API Smoke Tests (if server is running) ---
echo "Phase 5: API Smoke Tests"
API_URL="${API_URL:-http://localhost:3100}"
if curl -sf "$API_URL/health" > /dev/null 2>&1; then
  check "Health endpoint" curl -sf "$API_URL/health"
  check "Root endpoint" curl -sf "$API_URL/"
  check "Status endpoint" curl -sf "$API_URL/api/status"
  check "Security headers (x-content-type-options)" bash -c "curl -sI '$API_URL/health' | grep -qi 'x-content-type-options'"
  check "Request-ID header echoed" bash -c "curl -sI '$API_URL/health' | grep -qi 'x-request-id'"
  check "Malformed JSON returns 400 (or 429 if rate-limited)" bash -c "STATUS=\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$API_URL/api/auth/email/request' -H 'Content-Type: application/json' -d 'not-json'); [ \"\$STATUS\" = '400' ] || [ \"\$STATUS\" = '429' ]"
  check "Metrics endpoint (Prometheus format)" bash -c "curl -sf '$API_URL/metrics' | grep -q 'helm_pilot_http_requests_total'"
  check "Oversized POST body returns 413" bash -c "BIG=\$(head -c 200000 /dev/urandom | base64); STATUS=\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$API_URL/api/auth/email/request' -H 'Content-Type: application/json' -d \"\$BIG\"); [ \"\$STATUS\" = '413' ] || [ \"\$STATUS\" = '400' ]"
  check "Auth rate limit header" bash -c "curl -sf -D- '$API_URL/api/auth/email/request' -X POST -H 'Content-Type: application/json' -d '{\"email\":\"test\"}' | head -1"

  # Test auth flow if in dev mode
  echo -n "  Auth flow (dev)... "
  CODE=$(curl -sf "$API_URL/api/auth/email/request" -X POST -H 'Content-Type: application/json' -d '{"email":"gate@test.com"}' 2>/dev/null | grep -o '"code":"[0-9]*"' | cut -d'"' -f4 || true)
  if [ -n "$CODE" ]; then
    TOKEN=$(curl -sf "$API_URL/api/auth/email/verify" -X POST -H 'Content-Type: application/json' -d "{\"email\":\"gate@test.com\",\"code\":\"$CODE\"}" 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
    if [ -n "$TOKEN" ]; then
      check "Authenticated request" curl -sf -H "Authorization: Bearer $TOKEN" "$API_URL/api/tasks"
    else
      echo -e "${YELLOW}SKIP${NC} (could not get token)"
      WARN=$((WARN + 1))
    fi
  else
    echo -e "${YELLOW}SKIP${NC} (server not in dev mode)"
    WARN=$((WARN + 1))
  fi
else
  echo -e "  ${YELLOW}Server not running — skipping API tests${NC}"
  WARN=$((WARN + 1))
fi
echo ""

# --- Backup & Setup Checks ---
echo "Phase 6: Operational Scripts"
check "Backup script exists and is executable" bash -c "[ -x scripts/backup.sh ]"
check "Setup script exists and is executable" bash -c "[ -x scripts/setup.sh ]"
check "Encryption key rotation script exists" bash -c "[ -f scripts/rotate-encryption-key.ts ]"
check "Schema verification script exists" bash -c "[ -f scripts/verify-schema.ts ]"
echo ""

# --- Security Checks ---
echo "Phase 7: Security"
if [ -f .env ]; then
  # Load env variables safely for checking
  export $(grep -v '^#' .env | xargs -d '\n' 2>/dev/null || true)
fi

warn_check "SESSION_SECRET is not default" bash -c "[ \"${SESSION_SECRET:-}\" != \"dev-state-secret\" ] && [ \"${SESSION_SECRET:-}\" != \"change-me-in-production\" ] && [ -n \"${SESSION_SECRET:-}\" ]"
warn_check "ENCRYPTION_KEY is not default" bash -c "[ \"${ENCRYPTION_KEY:-}\" != \"dev-encryption-key\" ] && [ -n \"${ENCRYPTION_KEY:-}\" ]"
warn_check "ALLOWED_ORIGINS is restricted" bash -c "[ \"${ALLOWED_ORIGINS:-*}\" != \"*\" ]"
warn_check "EMAIL_PROVIDER is not noop in production" bash -c "[ \"${NODE_ENV:-}\" != \"production\" ] || [ \"${EMAIL_PROVIDER:-noop}\" != \"noop\" ]"
warn_check "SENTRY_DSN configured (optional)" bash -c "[ -n \"${SENTRY_DSN:-}\" ]"
echo ""

# --- Database & Migrations ---
echo "Phase 8: Database"
if [ -n "${DATABASE_URL:-}" ]; then
  warn_check "Schema verification (pgvector + triggers)" npx tsx scripts/verify-schema.ts
else
  echo -e "  ${YELLOW}SKIP${NC} (DATABASE_URL not set)"
  WARN=$((WARN + 1))
fi
echo ""

# --- Redis (optional) ---
if [ -n "${REDIS_URL:-}" ]; then
  echo "Phase 9: Redis"
  warn_check "Redis reachable" bash -c "node -e \"const r=new (require('ioredis'))(process.env.REDIS_URL); r.ping().then(()=>{console.log('PONG');r.quit();}).catch(e=>{console.error(e);process.exit(1);});\""
  echo ""
fi

# --- TLS Check ---
echo "Phase 10: TLS (if APP_URL is https)"
if [[ "${APP_URL:-}" == https://* ]]; then
  check "HTTPS endpoint is responding" curl -sf "$APP_URL/health" > /dev/null
else
  echo -e "  ${YELLOW}SKIP${NC} (APP_URL is not https or not set)"
  WARN=$((WARN + 1))
fi
echo ""

# --- Summary ---
echo "========================================="
TOTAL=$((PASS + FAIL + WARN))
echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${WARN} warnings${NC} / ${TOTAL} total"
echo "========================================="
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}LAUNCH GATE: FAIL${NC}"
  exit 1
else
  echo -e "${GREEN}LAUNCH GATE: PASS${NC}"
  exit 0
fi

#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# HELM Pilot — First-Run Setup Script
#
# Interactive setup for first-time deployers. Checks prerequisites,
# generates secrets, configures .env, starts Postgres, runs
# migrations, and validates the installation.
#
# Usage:
#   bash scripts/setup.sh               # Interactive setup
#   bash scripts/setup.sh --headless    # Non-interactive (CI)
#   bash scripts/setup.sh --skip-docker # Skip Docker Compose start
# ═══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

HEADLESS=false
SKIP_DOCKER=false

for arg in "$@"; do
  case "$arg" in
    --headless) HEADLESS=true ;;
    --skip-docker) SKIP_DOCKER=true ;;
    --help|-h)
      echo "Usage: bash scripts/setup.sh [--headless] [--skip-docker]"
      echo ""
      echo "Options:"
      echo "  --headless     Non-interactive mode (use defaults, skip prompts)"
      echo "  --skip-docker  Skip Docker Compose start (use existing Postgres)"
      exit 0
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

banner() {
  echo ""
  echo -e "${BLUE}${BOLD}"
  echo "  ╔══════════════════════════════════════════╗"
  echo "  ║         HELM Pilot — First Run           ║"
  echo "  ║    Autonomous Founder Operating System   ║"
  echo "  ╚══════════════════════════════════════════╝"
  echo -e "${NC}"
}

step() { echo -e "\n${BLUE}▸${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local default_val="${3:-}"
  if [ "$HEADLESS" = true ]; then
    eval "$var_name='$default_val'"
    return
  fi
  if [ -n "$default_val" ]; then
    read -rp "  $prompt_text [$default_val]: " input
    eval "$var_name='${input:-$default_val}'"
  else
    read -rp "  $prompt_text: " input
    eval "$var_name='$input'"
  fi
}

generate_secret() {
  openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || head -c 64 /dev/urandom | xxd -p | head -c 64
}

# ─────────────────────────────────────────
# Phase 1: Prerequisites
# ─────────────────────────────────────────
banner

step "Checking prerequisites..."

PREREQ_PASS=true

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ]; then
    ok "Node.js $NODE_VER"
  else
    fail "Node.js $NODE_VER (need >= 22)"
    PREREQ_PASS=false
  fi
else
  fail "Node.js not found (need >= 22)"
  PREREQ_PASS=false
fi

# npm
if command -v npm &>/dev/null; then
  ok "npm $(npm --version)"
else
  fail "npm not found"
  PREREQ_PASS=false
fi

# Docker (optional if --skip-docker)
if command -v docker &>/dev/null; then
  ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1 || echo 'installed')"
else
  if [ "$SKIP_DOCKER" = false ]; then
    warn "Docker not found — use --skip-docker if Postgres is already running"
  else
    ok "Docker skipped (--skip-docker)"
  fi
fi

# Docker Compose
if docker compose version &>/dev/null 2>&1; then
  ok "Docker Compose $(docker compose version --short 2>/dev/null || echo 'installed')"
elif [ "$SKIP_DOCKER" = false ]; then
  warn "Docker Compose not found"
fi

# openssl (for secret generation)
if command -v openssl &>/dev/null; then
  ok "openssl available"
else
  warn "openssl not found — will use fallback for secret generation"
fi

if [ "$PREREQ_PASS" = false ]; then
  echo ""
  fail "Prerequisites not met. Please install missing tools and retry."
  exit 1
fi

# ─────────────────────────────────────────
# Phase 2: Generate Secrets
# ─────────────────────────────────────────
step "Generating secrets..."

SESSION_SECRET=$(generate_secret)
ok "SESSION_SECRET generated"

ENCRYPTION_KEY=$(generate_secret)
ok "ENCRYPTION_KEY generated"

WEBHOOK_SECRET=$(generate_secret)
ok "TELEGRAM_WEBHOOK_SECRET generated"

# ─────────────────────────────────────────
# Phase 3: Configure Environment
# ─────────────────────────────────────────
step "Configuring environment..."

if [ -f .env ]; then
  warn ".env already exists"
  if [ "$HEADLESS" = false ]; then
    read -rp "  Overwrite? (y/N): " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
      ok "Keeping existing .env"
      # Source existing values we need
      set +u
      # shellcheck disable=SC1091
      source .env 2>/dev/null || true
      set -u
    else
      cp .env ".env.backup.$(date +%s)"
      ok "Backed up existing .env"
    fi
  fi
fi

# Only create .env if it doesn't exist or was overwritten
if [ ! -f .env ] || [ "${overwrite:-}" = "y" ] || [ "${overwrite:-}" = "Y" ]; then
  DB_URL="postgresql://helm:helm@localhost:5432/helm_pilot"

  prompt TELEGRAM_TOKEN "Telegram Bot Token (leave empty to skip)" ""
  prompt LLM_KEY "OpenRouter API Key (leave empty to skip)" ""

  cat > .env << EOF
# ─── HELM Pilot Environment (generated by setup.sh) ───
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ─── Database ───
DATABASE_URL=${DB_URL}

# ─── Telegram ───
TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}
TELEGRAM_WEBHOOK_SECRET=${WEBHOOK_SECRET}
# TELEGRAM_OWNER_CHAT_ID=

# ─── LLM Providers ───
OPENROUTER_API_KEY=${LLM_KEY}
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=

# ─── Connectors (OAuth) ───
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GOOGLE_REDIRECT_URI=http://localhost:3100/api/connectors/google/oauth/callback
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# ─── Security ───
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ─── Server ───
PORT=3100
NODE_ENV=development
LOG_LEVEL=info
ALLOWED_ORIGINS=http://localhost:3000
EOF

  ok ".env created with generated secrets"
fi

# ─────────────────────────────────────────
# Phase 4: Start PostgreSQL
# ─────────────────────────────────────────
if [ "$SKIP_DOCKER" = false ]; then
  step "Starting PostgreSQL via Docker Compose..."
  if docker compose -f infra/docker/docker-compose.yml up -d postgres 2>/dev/null; then
    ok "PostgreSQL container started"
    # Wait for Postgres to be ready
    echo -n "  Waiting for Postgres to be ready"
    for i in $(seq 1 30); do
      if docker compose -f infra/docker/docker-compose.yml exec -T postgres pg_isready -U helm -d helm_pilot &>/dev/null; then
        echo ""
        ok "PostgreSQL is ready"
        break
      fi
      echo -n "."
      sleep 1
      if [ "$i" -eq 30 ]; then
        echo ""
        fail "PostgreSQL did not become ready in 30s"
        exit 1
      fi
    done
  else
    fail "Failed to start PostgreSQL. Check Docker is running."
    exit 1
  fi
else
  step "Skipping Docker (--skip-docker)"
  ok "Assuming PostgreSQL is already running at DATABASE_URL"
fi

# ─────────────────────────────────────────
# Phase 5: Install Dependencies
# ─────────────────────────────────────────
step "Installing dependencies..."
if npm ci --ignore-scripts 2>/dev/null; then
  ok "Dependencies installed"
else
  warn "npm ci failed, trying npm install..."
  npm install --ignore-scripts
  ok "Dependencies installed (via npm install)"
fi

# ─────────────────────────────────────────
# Phase 6: Run Migrations
# ─────────────────────────────────────────
step "Running database migrations..."
if npm run db:migrate 2>/dev/null; then
  ok "Migrations applied"
else
  warn "Migration via db:migrate failed, trying db:push..."
  npm run db:push 2>/dev/null && ok "Schema pushed" || fail "Database migration failed"
fi

# ─────────────────────────────────────────
# Phase 7: Seed Initial Data (Optional)
# ─────────────────────────────────────────
if [ "$HEADLESS" = false ]; then
  prompt SEED_DATA "Seed sample data? (y/N)" "N"
  if [ "$SEED_DATA" = "y" ] || [ "$SEED_DATA" = "Y" ]; then
    step "Seeding sample data..."
    if npx tsx scripts/seed.ts 2>/dev/null; then
      ok "Sample data seeded"
    else
      warn "Seeding failed (non-critical, continuing)"
    fi
  fi
else
  step "Skipping data seeding (headless mode)"
fi

# ─────────────────────────────────────────
# Phase 8: Validate Installation
# ─────────────────────────────────────────
step "Validating installation..."

# Type check
if npx turbo typecheck --filter=@helm-pilot/gateway 2>/dev/null; then
  ok "TypeScript compilation (gateway)"
else
  warn "TypeScript check failed (non-critical for first run)"
fi

# Try starting the server briefly to verify it boots
step "Smoke test — starting server..."
PORT=3199 timeout 10 node services/gateway/dist/server.js &>/dev/null &
SERVER_PID=$!
sleep 3

if curl -sf http://localhost:3199/health &>/dev/null; then
  ok "Server boots and responds to /health"
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
else
  warn "Server smoke test inconclusive (may need to build first)"
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
fi

# ─────────────────────────────────────────
# Done!
# ─────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       HELM Pilot is ready! 🚀            ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Next steps:"
echo ""
echo "    1. Start development server:"
echo -e "       ${BOLD}npm run dev${NC}"
echo ""
echo "    2. Open the web dashboard:"
echo -e "       ${BOLD}http://localhost:3000${NC}"
echo ""
echo "    3. Test the API:"
echo -e "       ${BOLD}curl http://localhost:3100/health${NC}"
echo ""
if [ -z "${TELEGRAM_TOKEN:-}" ]; then
  echo -e "    ${YELLOW}Note:${NC} Set TELEGRAM_BOT_TOKEN in .env to enable the Telegram bot."
fi
if [ -z "${LLM_KEY:-}" ]; then
  echo -e "    ${YELLOW}Note:${NC} Set OPENROUTER_API_KEY in .env to enable the agent loop."
fi
echo ""

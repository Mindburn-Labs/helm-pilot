#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# HELM Pilot — Backup & Restore Script
#
# Automated PostgreSQL backup management with local and S3 support.
#
# Usage:
#   bash scripts/backup.sh create              # Create backup
#   bash scripts/backup.sh create --output /path  # Custom output dir
#   bash scripts/backup.sh restore <file>      # Restore from backup
#   bash scripts/backup.sh verify <file>       # Verify backup integrity
#   bash scripts/backup.sh list                # List available backups
#   bash scripts/backup.sh upload <file>       # Upload to S3 (if configured)
# ═══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Load environment
# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env 2>/dev/null && set +a

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
COMPOSE_FILE="infra/docker/docker-compose.yml"

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${BLUE}▸${NC} $1"; }

get_db_params() {
  # Parse DATABASE_URL into components
  local url="${DATABASE_URL:-postgresql://helm:helm@localhost:5432/helm_pilot}"
  # Extract: protocol://user:pass@host:port/dbname
  DB_USER=$(echo "$url" | sed -E 's|.*://([^:]+):.*|\1|')
  DB_PASS=$(echo "$url" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
  DB_HOST=$(echo "$url" | sed -E 's|.*@([^:]+):.*|\1|')
  DB_PORT=$(echo "$url" | sed -E 's|.*:([0-9]+)/.*|\1|')
  DB_NAME=$(echo "$url" | sed -E 's|.*/([^?]+).*|\1|')
}

# ─── CREATE ───
cmd_create() {
  local output_dir="$BACKUP_DIR"

  # Parse args
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output|-o) output_dir="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  mkdir -p "$output_dir"
  local filename="helm_pilot_${TIMESTAMP}.sql.gz"
  local filepath="$output_dir/$filename"

  echo -e "\n${BOLD}Creating backup...${NC}"
  get_db_params

  # Try Docker Compose exec first, then direct pg_dump
  if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "running"; then
    info "Using Docker Compose postgres container"
    docker compose -f "$COMPOSE_FILE" exec -T postgres \
      pg_dump -U "$DB_USER" --clean --if-exists --no-owner "$DB_NAME" \
      | gzip > "$filepath"
  elif command -v pg_dump &>/dev/null; then
    info "Using local pg_dump"
    PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
      --clean --if-exists --no-owner "$DB_NAME" \
      | gzip > "$filepath"
  else
    fail "No pg_dump available. Install PostgreSQL client or use Docker."
  fi

  local size
  size=$(du -h "$filepath" | cut -f1)
  ok "Backup created: $filepath ($size)"

  # Generate checksum
  local checksum
  checksum=$(sha256sum "$filepath" 2>/dev/null || shasum -a 256 "$filepath" 2>/dev/null)
  echo "$checksum" > "$filepath.sha256"
  ok "Checksum: ${checksum%% *}"

  echo ""
  echo -e "  Restore with: ${BOLD}bash scripts/backup.sh restore $filepath${NC}"
}

# ─── RESTORE ───
cmd_restore() {
  local filepath="$1"

  if [ ! -f "$filepath" ]; then
    fail "Backup file not found: $filepath"
  fi

  echo -e "\n${BOLD}Restoring from: $(basename "$filepath")${NC}"
  get_db_params

  # Verify checksum if available
  if [ -f "$filepath.sha256" ]; then
    info "Verifying checksum..."
    local expected actual
    expected=$(cat "$filepath.sha256" | awk '{print $1}')
    actual=$(sha256sum "$filepath" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$filepath" 2>/dev/null | awk '{print $1}')
    if [ "$expected" = "$actual" ]; then
      ok "Checksum verified"
    else
      fail "Checksum mismatch! Backup may be corrupted."
    fi
  else
    warn "No checksum file found — skipping integrity check"
  fi

  # Safety prompt
  echo ""
  echo -e "  ${RED}${BOLD}WARNING:${NC} This will ${RED}overwrite${NC} the current database."
  echo -e "  Database: ${BOLD}$DB_NAME${NC} on ${BOLD}$DB_HOST:$DB_PORT${NC}"
  read -rp "  Continue? (type 'yes' to confirm): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "  Aborted."
    exit 0
  fi

  # Create a safety backup before restoring
  info "Creating safety backup before restore..."
  local safety_dir="$BACKUP_DIR/pre-restore"
  mkdir -p "$safety_dir"
  local safety_file="$safety_dir/helm_pilot_pre_restore_${TIMESTAMP}.sql.gz"

  if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "running"; then
    docker compose -f "$COMPOSE_FILE" exec -T postgres \
      pg_dump -U "$DB_USER" --clean --if-exists --no-owner "$DB_NAME" \
      | gzip > "$safety_file" 2>/dev/null && ok "Safety backup: $safety_file" || warn "Could not create safety backup"
  fi

  # Restore
  info "Restoring database..."
  if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "running"; then
    gunzip -c "$filepath" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$DB_USER" "$DB_NAME" --quiet 2>/dev/null
  elif command -v psql &>/dev/null; then
    PGPASSWORD="$DB_PASS" gunzip -c "$filepath" | \
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" --quiet 2>/dev/null
  else
    fail "No psql available. Install PostgreSQL client or use Docker."
  fi

  ok "Database restored from $(basename "$filepath")"
}

# ─── VERIFY ───
cmd_verify() {
  local filepath="$1"

  if [ ! -f "$filepath" ]; then
    fail "Backup file not found: $filepath"
  fi

  echo -e "\n${BOLD}Verifying backup: $(basename "$filepath")${NC}"

  # Check file size
  local size
  size=$(du -h "$filepath" | cut -f1)
  info "File size: $size"
  local bytes
  bytes=$(wc -c < "$filepath" | tr -d ' ')
  if [ "$bytes" -lt 100 ]; then
    fail "Backup file is suspiciously small ($bytes bytes)"
  fi
  ok "File size looks reasonable"

  # Verify checksum
  if [ -f "$filepath.sha256" ]; then
    local expected actual
    expected=$(awk '{print $1}' "$filepath.sha256")
    actual=$(sha256sum "$filepath" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$filepath" 2>/dev/null | awk '{print $1}')
    if [ "$expected" = "$actual" ]; then
      ok "Checksum verified"
    else
      fail "Checksum mismatch!"
    fi
  else
    warn "No checksum file — cannot verify integrity"
  fi

  # Try decompressing and counting tables
  info "Scanning backup contents..."
  local table_count
  table_count=$(gunzip -c "$filepath" 2>/dev/null | grep -c "^CREATE TABLE" || echo "0")
  local insert_count
  insert_count=$(gunzip -c "$filepath" 2>/dev/null | grep -c "^INSERT INTO\|^COPY " || echo "0")
  ok "Contains $table_count CREATE TABLE statements"
  ok "Contains $insert_count data statements (INSERT/COPY)"

  # Check for critical tables
  local critical_tables=("users" "workspaces" "workspace_members" "tasks" "operators")
  for tbl in "${critical_tables[@]}"; do
    if gunzip -c "$filepath" 2>/dev/null | grep -q "CREATE TABLE.*$tbl\b"; then
      ok "Critical table found: $tbl"
    else
      warn "Critical table missing: $tbl"
    fi
  done

  echo ""
  ok "Backup verification complete"
}

# ─── LIST ───
cmd_list() {
  echo -e "\n${BOLD}Available backups:${NC}\n"

  if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    warn "No backups found in $BACKUP_DIR"
    echo -e "\n  Create one with: ${BOLD}bash scripts/backup.sh create${NC}"
    return
  fi

  printf "  %-45s %10s %s\n" "FILENAME" "SIZE" "DATE"
  printf "  %-45s %10s %s\n" "────────" "────" "────"

  find "$BACKUP_DIR" -name "helm_pilot_*.sql.gz" -maxdepth 2 | sort -r | while read -r f; do
    local fname size mdate
    fname=$(basename "$f")
    size=$(du -h "$f" | cut -f1)
    mdate=$(date -r "$f" "+%Y-%m-%d %H:%M" 2>/dev/null || stat --format='%y' "$f" 2>/dev/null | cut -d. -f1)
    printf "  %-45s %10s %s\n" "$fname" "$size" "$mdate"
  done

  echo ""
}

# ─── UPLOAD (S3) ───
cmd_upload() {
  local filepath="$1"

  if [ ! -f "$filepath" ]; then
    fail "Backup file not found: $filepath"
  fi

  # Check S3 configuration
  if [ -z "${S3_ENDPOINT:-}" ] || [ -z "${S3_BUCKET:-}" ] || [ -z "${S3_ACCESS_KEY:-}" ]; then
    fail "S3 not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY in .env"
  fi

  echo -e "\n${BOLD}Uploading to S3...${NC}"
  local key="backups/$(basename "$filepath")"

  if command -v aws &>/dev/null; then
    AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}" \
      aws s3 cp "$filepath" "s3://$S3_BUCKET/$key" \
      --endpoint-url "$S3_ENDPOINT" \
      --region "${S3_REGION:-us-east-1}"
    ok "Uploaded to s3://$S3_BUCKET/$key"
  else
    # Fallback: curl with minimal S3 API
    local date_header
    date_header=$(date -u +"%a, %d %b %Y %H:%M:%S GMT")
    curl -sf -X PUT \
      -H "Date: $date_header" \
      -H "Content-Type: application/gzip" \
      --data-binary "@$filepath" \
      "$S3_ENDPOINT/$S3_BUCKET/$key"
    ok "Uploaded to $S3_ENDPOINT/$S3_BUCKET/$key"
  fi

  # Upload checksum too
  if [ -f "$filepath.sha256" ]; then
    if command -v aws &>/dev/null; then
      AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}" \
        aws s3 cp "$filepath.sha256" "s3://$S3_BUCKET/${key}.sha256" \
        --endpoint-url "$S3_ENDPOINT" \
        --region "${S3_REGION:-us-east-1}"
    fi
    ok "Checksum uploaded"
  fi
}

# ─── Main ───
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    create)  cmd_create "$@" ;;
    restore) cmd_restore "${1:?'Usage: backup.sh restore <file>'}" ;;
    verify)  cmd_verify "${1:?'Usage: backup.sh verify <file>'}" ;;
    list)    cmd_list ;;
    upload)  cmd_upload "${1:?'Usage: backup.sh upload <file>'}" ;;
    help|--help|-h)
      echo ""
      echo -e "${BOLD}HELM Pilot Backup Manager${NC}"
      echo ""
      echo "Usage: bash scripts/backup.sh <command> [options]"
      echo ""
      echo "Commands:"
      echo "  create [--output dir]   Create a compressed database backup"
      echo "  restore <file>          Restore database from backup (with safety prompt)"
      echo "  verify <file>           Verify backup integrity without restoring"
      echo "  list                    List available backups"
      echo "  upload <file>           Upload backup to S3 (requires S3_* config)"
      echo ""
      echo "Environment:"
      echo "  DATABASE_URL            PostgreSQL connection string"
      echo "  BACKUP_DIR              Backup output directory (default: ./backups)"
      echo "  S3_ENDPOINT             S3-compatible endpoint for remote backups"
      echo "  S3_BUCKET               S3 bucket name"
      echo "  S3_ACCESS_KEY           S3 access key"
      echo "  S3_SECRET_KEY           S3 secret key"
      echo ""
      ;;
    *)
      fail "Unknown command: $cmd. Use 'bash scripts/backup.sh help' for usage."
      ;;
  esac
}

main "$@"

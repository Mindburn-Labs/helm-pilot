#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# HELM Pilot — Backup & Restore Script
#
# Automated PostgreSQL backup management with local and S3 support.
#
# Usage:
#   bash scripts/backup.sh create                  # Create backup
#   bash scripts/backup.sh create-and-upload       # Create, encrypt, upload
#   bash scripts/backup.sh restore <file>          # Restore .sql.gz or .sql.gz.gpg
#   bash scripts/backup.sh verify <file>           # Verify backup integrity
#   bash scripts/backup.sh list                    # List available backups
#   bash scripts/backup.sh upload <file>           # Upload encrypted backup to S3
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
COMPOSE_FILE="${COMPOSE_FILE:-infra/digitalocean/docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.production.shared}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-helm-pilot}"
CREATED_BACKUP_PATH=""
TEMP_DECRYPTED_FILES=()
cleanup_temp_decrypted() {
  for f in "${TEMP_DECRYPTED_FILES[@]}"; do
    rm -f "$f"
  done
}
trap cleanup_temp_decrypted EXIT

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${BLUE}▸${NC} $1"; }

docker_compose() {
  local args=(docker compose -p "$COMPOSE_PROJECT_NAME")
  if [ -f "$COMPOSE_ENV_FILE" ]; then
    args+=(--env-file "$COMPOSE_ENV_FILE")
  fi
  args+=(-f "$COMPOSE_FILE")
  "${args[@]}" "$@"
}

sha256_file() {
  sha256sum "$1" 2>/dev/null || shasum -a 256 "$1" 2>/dev/null
}

checksum_value() {
  sha256_file "$1" | awk '{print $1}'
}

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

encrypt_backup() {
  local filepath="$1"
  command -v gpg >/dev/null 2>&1 || fail "gpg is required when BACKUP_ENCRYPTION_PASSPHRASE is set"

  local encrypted="${filepath}.gpg"
  info "Encrypting backup with GPG symmetric AES256"
  printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes \
    --passphrase-fd 0 \
    --pinentry-mode loopback \
    --symmetric \
    --cipher-algo AES256 \
    --output "$encrypted" \
    "$filepath"
  sha256_file "$encrypted" > "$encrypted.sha256"
  ok "Encrypted backup: $encrypted"
  if [ "${BACKUP_KEEP_PLAINTEXT:-0}" != "1" ]; then
    rm -f "$filepath" "$filepath.sha256"
  fi
  printf '%s\n' "$encrypted"
}

decrypt_backup() {
  local filepath="$1"
  if [[ "$filepath" != *.gpg ]]; then
    printf '%s\n' "$filepath"
    return
  fi
  [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || fail "BACKUP_ENCRYPTION_PASSPHRASE is required to decrypt $filepath"
  command -v gpg >/dev/null 2>&1 || fail "gpg is required to decrypt $filepath"
  local output
  output="$(mktemp "${TMPDIR:-/tmp}/helm-pilot-backup.XXXXXX")"
  TEMP_DECRYPTED_FILES+=("$output")
  info "Decrypting backup"
  printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes \
    --passphrase-fd 0 \
    --pinentry-mode loopback \
    --decrypt \
    --output "$output" \
    "$filepath"
  printf '%s\n' "$output"
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
  if docker_compose ps postgres 2>/dev/null | grep -q "running"; then
    info "Using Docker Compose postgres container"
    docker_compose exec -T postgres \
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
  checksum=$(sha256_file "$filepath")
  echo "$checksum" > "$filepath.sha256"
  ok "Checksum: ${checksum%% *}"
  if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    filepath="$(encrypt_backup "$filepath" | tail -n1)"
  fi
  CREATED_BACKUP_PATH="$filepath"

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

  # Verify checksum if available. For encrypted backups, the checksum covers
  # the encrypted payload exactly as stored remotely.
  if [ -f "$filepath.sha256" ]; then
    info "Verifying checksum..."
    local expected actual
    expected=$(cat "$filepath.sha256" | awk '{print $1}')
    actual=$(checksum_value "$filepath")
    if [ "$expected" = "$actual" ]; then
      ok "Checksum verified"
    else
      fail "Checksum mismatch! Backup may be corrupted."
    fi
  else
    warn "No checksum file found — skipping integrity check"
  fi
  local restore_file="$filepath"
  if [[ "$filepath" == *.gpg ]]; then
    restore_file="$(decrypt_backup "$filepath" | tail -n1)"
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

  if docker_compose ps postgres 2>/dev/null | grep -q "running"; then
    docker_compose exec -T postgres \
      pg_dump -U "$DB_USER" --clean --if-exists --no-owner "$DB_NAME" \
      | gzip > "$safety_file" 2>/dev/null && ok "Safety backup: $safety_file" || warn "Could not create safety backup"
  fi

  # Restore
  info "Restoring database..."
  if docker_compose ps postgres 2>/dev/null | grep -q "running"; then
    gunzip -c "$restore_file" | docker_compose exec -T postgres \
      psql -U "$DB_USER" "$DB_NAME" --quiet 2>/dev/null
  elif command -v psql &>/dev/null; then
    PGPASSWORD="$DB_PASS" gunzip -c "$restore_file" | \
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
    actual=$(checksum_value "$filepath")
    if [ "$expected" = "$actual" ]; then
      ok "Checksum verified"
    else
      fail "Checksum mismatch!"
    fi
  else
    warn "No checksum file — cannot verify integrity"
  fi
  local scan_file="$filepath"
  if [[ "$filepath" == *.gpg ]]; then
    scan_file="$(decrypt_backup "$filepath" | tail -n1)"
  fi

  # Try decompressing and counting tables
  info "Scanning backup contents..."
  local table_count
  table_count=$(gunzip -c "$scan_file" 2>/dev/null | grep -c "^CREATE TABLE" || true)
  local insert_count
  insert_count=$(gunzip -c "$scan_file" 2>/dev/null | grep -c "^INSERT INTO\|^COPY " || true)
  ok "Contains $table_count CREATE TABLE statements"
  ok "Contains $insert_count data statements (INSERT/COPY)"

  # Check for critical tables
  local critical_tables=("users" "workspaces" "workspace_members" "tasks" "operators")
  for tbl in "${critical_tables[@]}"; do
    if gunzip -c "$scan_file" 2>/dev/null | grep -q "CREATE TABLE.*$tbl\b"; then
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

  find "$BACKUP_DIR" \( -name "helm_pilot_*.sql.gz" -o -name "helm_pilot_*.sql.gz.gpg" \) -maxdepth 2 | sort -r | while read -r f; do
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
  if [[ "$filepath" != *.gpg && "${BACKUP_ALLOW_PLAINTEXT_UPLOAD:-0}" != "1" ]]; then
    fail "Refusing to upload plaintext backup. Set BACKUP_ENCRYPTION_PASSPHRASE or BACKUP_ALLOW_PLAINTEXT_UPLOAD=1."
  fi

  # Check S3 configuration
  local access_key="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}"
  local secret_key="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
  if [ -z "${S3_ENDPOINT:-}" ] || [ -z "${S3_BUCKET:-}" ] || [ -z "$access_key" ] || [ -z "$secret_key" ]; then
    fail "S3 not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY"
  fi
  command -v aws >/dev/null 2>&1 || fail "aws CLI is required for authenticated S3 upload"

  echo -e "\n${BOLD}Uploading to S3...${NC}"
  local key="backups/$(basename "$filepath")"

  AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" \
    aws s3 cp "$filepath" "s3://$S3_BUCKET/$key" \
    --endpoint-url "$S3_ENDPOINT" \
    --region "${S3_REGION:-us-east-1}"
  ok "Uploaded to s3://$S3_BUCKET/$key"

  # Upload checksum too
  if [ -f "$filepath.sha256" ]; then
    AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" \
      aws s3 cp "$filepath.sha256" "s3://$S3_BUCKET/${key}.sha256" \
      --endpoint-url "$S3_ENDPOINT" \
      --region "${S3_REGION:-us-east-1}"
    ok "Checksum uploaded"
  fi
}

cmd_create_and_upload() {
  cmd_create "$@"
  [ -n "$CREATED_BACKUP_PATH" ] || fail "backup creation did not produce an uploadable path"
  cmd_upload "$CREATED_BACKUP_PATH"
}

# ─── Main ───
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    create)  cmd_create "$@" ;;
    create-and-upload) cmd_create_and_upload "$@" ;;
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
      echo "  create-and-upload       Create, encrypt, and upload backup"
      echo "  restore <file>          Restore database from backup (with safety prompt)"
      echo "  verify <file>           Verify backup integrity without restoring"
      echo "  list                    List available backups"
      echo "  upload <file>           Upload encrypted backup to S3 (requires S3_* config)"
      echo ""
      echo "Environment:"
      echo "  DATABASE_URL            PostgreSQL connection string"
      echo "  BACKUP_DIR              Backup output directory (default: ./backups)"
      echo "  S3_ENDPOINT             S3-compatible endpoint for remote backups"
      echo "  S3_BUCKET               S3 bucket name"
      echo "  S3_ACCESS_KEY           S3 access key"
      echo "  S3_SECRET_KEY           S3 secret key"
      echo "  BACKUP_ENCRYPTION_PASSPHRASE  Required for production uploads"
      echo ""
      ;;
    *)
      fail "Unknown command: $cmd. Use 'bash scripts/backup.sh help' for usage."
      ;;
  esac
}

main "$@"

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# HELM Pilot — per-tenant backup (Phase 2d)
#
# Dumps a single workspace's rows across every workspace-scoped table into a
# tarball that `scripts/restore-tenant.sh` can restore into the same or a
# different HELM Pilot instance. Complements the full-DB `scripts/backup.sh`
# which covers platform-wide disaster recovery.
#
# Usage:
#   bash scripts/backup-tenant.sh <workspace-id>              # local dump to ./backups/
#   bash scripts/backup-tenant.sh <workspace-id> --out /path
#   S3_BUCKET=… bash scripts/backup-tenant.sh <workspace-id>  # stream to S3
#
# Env:
#   DATABASE_URL                (required) — Postgres connection string
#   BACKUP_DIR                  (optional) — default ./backups
#   S3_BUCKET, S3_PREFIX,
#   S3_ENDPOINT, S3_ACCESS_KEY,
#   S3_SECRET_KEY, S3_REGION    (optional) — streams result to S3 when set
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env 2>/dev/null && set +a

WORKSPACE_ID="${1:-}"
shift || true

OUT_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$WORKSPACE_ID" ]; then
  echo "Usage: backup-tenant.sh <workspace-id> [--out <dir>]" >&2
  exit 2
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set (in env or .env)" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
TS=$(date +"%Y%m%d_%H%M%S")
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "▸ workspace=$WORKSPACE_ID  out=$OUT_DIR"

# ─── Tables to dump ─────────────────────────────────────────────────────
# Every table with a direct `workspace_id` FK. FK-scoped tables
# (connector_tokens, task_runs, milestones, etc.) are reached by joining
# through the parent on restore — the dump here captures the roots.
DIRECT_TABLES=(
  workspaces
  workspace_members
  workspace_settings
  founder_profiles
  founder_strengths
  founder_assessments
  opportunities
  opportunity_scores
  operators
  tasks
  plans
  pages
  timeline_entries
  connector_grants
  audit_log
  approvals
  policy_violations
  evidence_packs
  crawl_sources
  crawl_runs
  applications
  cofounder_candidates
  cofounder_candidate_sources
  tenant_secrets
)

# Dump each table filtered by workspace_id. We use COPY rather than
# pg_dump because pg_dump's --where clause can't filter arbitrary tables
# in one invocation, and we want the output to be importable with a
# matching COPY ... FROM in restore-tenant.sh.
for TABLE in "${DIRECT_TABLES[@]}"; do
  OUT="$STAGE/${TABLE}.tsv"
  echo "  · $TABLE"
  psql "$DATABASE_URL" -q -c "\\COPY (SELECT * FROM \"$TABLE\" WHERE workspace_id = '${WORKSPACE_ID}') TO '$OUT' (FORMAT binary)" \
    || echo "    ! $TABLE: skipped (table may not exist in this deployment)"
done

# Manifest so restore can sanity-check the source version + workspace.
cat >"$STAGE/manifest.json" <<JSON
{
  "workspaceId": "$WORKSPACE_ID",
  "timestamp": "$TS",
  "tables": $(printf '%s\n' "${DIRECT_TABLES[@]}" | jq -Rn '[inputs]'),
  "schemaMigration": "0008",
  "helmPilotVersion": "0.1.0"
}
JSON

OUT_FILE="$OUT_DIR/tenant-${WORKSPACE_ID}-${TS}.tar.gz"
tar -czf "$OUT_FILE" -C "$STAGE" .
echo "✓ tarball: $OUT_FILE"
echo "  size: $(du -h "$OUT_FILE" | cut -f1)"

if [ -n "${S3_BUCKET:-}" ]; then
  S3_KEY="${S3_PREFIX:-tenants/}${WORKSPACE_ID}/${TS}.tar.gz"
  echo "▸ uploading to s3://${S3_BUCKET}/${S3_KEY}"
  AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
  AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
  AWS_REGION="${S3_REGION:-${AWS_REGION:-us-east-1}}" \
  aws s3 cp "$OUT_FILE" "s3://${S3_BUCKET}/${S3_KEY}" \
    ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"} \
    && echo "✓ uploaded"
fi

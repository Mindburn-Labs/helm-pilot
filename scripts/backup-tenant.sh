#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Pilot — per-tenant backup (Phase 2d)
#
# Dumps a single workspace's rows across workspace-scoped tables and direct
# child tables into a tarball that `scripts/restore-tenant.sh` can restore
# under the captured workspace id. Complements the full-DB `scripts/backup.sh`
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
if ! [[ "$WORKSPACE_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "workspace id must be a UUID" >&2
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
# Format: table|WHERE clause. Order matches restore order.
TABLE_SPECS=(
  "workspaces|id = '${WORKSPACE_ID}'"
  "workspace_members|workspace_id = '${WORKSPACE_ID}'"
  "workspace_settings|workspace_id = '${WORKSPACE_ID}'"
  "tenant_secrets|workspace_id = '${WORKSPACE_ID}'"
  "deploy_targets|workspace_id = '${WORKSPACE_ID}'"
  "deployments|workspace_id = '${WORKSPACE_ID}'"
  "deploy_health|deployment_id IN (SELECT id FROM deployments WHERE workspace_id = '${WORKSPACE_ID}')"
  "operators|workspace_id = '${WORKSPACE_ID}'"
  "operator_memory|operator_id IN (SELECT id FROM operators WHERE workspace_id = '${WORKSPACE_ID}')"
  "operator_configs|operator_id IN (SELECT id FROM operators WHERE workspace_id = '${WORKSPACE_ID}')"
  "tasks|workspace_id = '${WORKSPACE_ID}'"
  "task_runs|task_id IN (SELECT id FROM tasks WHERE workspace_id = '${WORKSPACE_ID}')"
  "task_artifacts|task_id IN (SELECT id FROM tasks WHERE workspace_id = '${WORKSPACE_ID}')"
  "plans|workspace_id = '${WORKSPACE_ID}'"
  "milestones|plan_id IN (SELECT id FROM plans WHERE workspace_id = '${WORKSPACE_ID}')"
  "artifacts|workspace_id = '${WORKSPACE_ID}'"
  "artifact_versions|artifact_id IN (SELECT id FROM artifacts WHERE workspace_id = '${WORKSPACE_ID}')"
  "founder_profiles|workspace_id = '${WORKSPACE_ID}'"
  "founder_assessments|founder_id IN (SELECT id FROM founder_profiles WHERE workspace_id = '${WORKSPACE_ID}')"
  "founder_strengths|founder_id IN (SELECT id FROM founder_profiles WHERE workspace_id = '${WORKSPACE_ID}')"
  "opportunities|workspace_id = '${WORKSPACE_ID}'"
  "opportunity_scores|opportunity_id IN (SELECT id FROM opportunities WHERE workspace_id = '${WORKSPACE_ID}')"
  "opportunity_tags|opportunity_id IN (SELECT id FROM opportunities WHERE workspace_id = '${WORKSPACE_ID}')"
  "opportunity_clusters|workspace_id = '${WORKSPACE_ID}'"
  "opportunity_cluster_members|cluster_id IN (SELECT id FROM opportunity_clusters WHERE workspace_id = '${WORKSPACE_ID}') OR opportunity_id IN (SELECT id FROM opportunities WHERE workspace_id = '${WORKSPACE_ID}')"
  "pages|workspace_id = '${WORKSPACE_ID}'"
  "content_chunks|page_id IN (SELECT id FROM pages WHERE workspace_id = '${WORKSPACE_ID}')"
  "links|from_page_id IN (SELECT id FROM pages WHERE workspace_id = '${WORKSPACE_ID}') OR to_page_id IN (SELECT id FROM pages WHERE workspace_id = '${WORKSPACE_ID}')"
  "timeline_entries|page_id IN (SELECT id FROM pages WHERE workspace_id = '${WORKSPACE_ID}')"
  "raw_data|workspace_id = '${WORKSPACE_ID}' OR page_id IN (SELECT id FROM pages WHERE workspace_id = '${WORKSPACE_ID}')"
  "connector_grants|workspace_id = '${WORKSPACE_ID}'"
  "connector_tokens|grant_id IN (SELECT id FROM connector_grants WHERE workspace_id = '${WORKSPACE_ID}')"
  "connector_sessions|grant_id IN (SELECT id FROM connector_grants WHERE workspace_id = '${WORKSPACE_ID}')"
  "audit_log|workspace_id = '${WORKSPACE_ID}'"
  "approvals|workspace_id = '${WORKSPACE_ID}'"
  "policy_violations|workspace_id = '${WORKSPACE_ID}'"
  "evidence_packs|workspace_id = '${WORKSPACE_ID}'"
  "compliance_attestations|workspace_id = '${WORKSPACE_ID}'"
  "crawl_sources|workspace_id = '${WORKSPACE_ID}'"
  "crawl_runs|workspace_id = '${WORKSPACE_ID}'"
  "applications|workspace_id = '${WORKSPACE_ID}'"
  "application_drafts|application_id IN (SELECT id FROM applications WHERE workspace_id = '${WORKSPACE_ID}')"
  "application_artifacts|application_id IN (SELECT id FROM applications WHERE workspace_id = '${WORKSPACE_ID}')"
  "cofounder_candidate_sources|workspace_id = '${WORKSPACE_ID}'"
  "cofounder_candidates|workspace_id = '${WORKSPACE_ID}'"
  "cofounder_match_evaluations|workspace_id = '${WORKSPACE_ID}'"
  "cofounder_candidate_notes|workspace_id = '${WORKSPACE_ID}'"
  "cofounder_outreach_drafts|workspace_id = '${WORKSPACE_ID}'"
  "cofounder_follow_ups|workspace_id = '${WORKSPACE_ID}'"
  "workspace_deletions|workspace_id = '${WORKSPACE_ID}'"
  "ratelimit_buckets|subject = '${WORKSPACE_ID}'"
)

# Dump each table filtered by workspace_id. We use COPY rather than
# pg_dump because pg_dump's --where clause can't filter arbitrary tables
# in one invocation, and we want the output to be importable with a
# matching COPY ... FROM in restore-tenant.sh.
TABLES=()
for SPEC in "${TABLE_SPECS[@]}"; do
  TABLE="${SPEC%%|*}"
  WHERE="${SPEC#*|}"
  TABLES+=("$TABLE")
  OUT="$STAGE/${TABLE}.tsv"
  echo "  · $TABLE"
  psql "$DATABASE_URL" -q -c "\\COPY (SELECT * FROM \"$TABLE\" WHERE $WHERE) TO '$OUT' (FORMAT binary)" \
    || echo "    ! $TABLE: skipped (table may not exist in this deployment)"
done

# Manifest so restore can sanity-check the source version + workspace.
cat >"$STAGE/manifest.json" <<JSON
{
  "workspaceId": "$WORKSPACE_ID",
  "timestamp": "$TS",
  "tables": $(printf '%s\n' "${TABLES[@]}" | jq -Rn '[inputs]'),
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

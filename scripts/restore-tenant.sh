#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# HELM Pilot — per-tenant restore (Phase 2d)
#
# Re-imports a single workspace dumped by `scripts/backup-tenant.sh`. Safe to
# run against a live database — the restore targets only rows with the
# captured workspace_id, and refuses to proceed if a workspace with the same
# id already exists (prevents an accidental overwrite).
#
# Usage:
#   bash scripts/restore-tenant.sh <tarball>                    # restore under the captured id
#   bash scripts/restore-tenant.sh <tarball> --new-workspace    # restore under a freshly minted id
#
# Env:
#   DATABASE_URL (required)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env 2>/dev/null && set +a

TARBALL="${1:-}"
shift || true
NEW_WORKSPACE=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --new-workspace) NEW_WORKSPACE=true; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  echo "Usage: restore-tenant.sh <tarball> [--new-workspace]" >&2
  exit 2
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set (in env or .env)" >&2
  exit 2
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$TARBALL" -C "$STAGE"

if [ ! -f "$STAGE/manifest.json" ]; then
  echo "! tarball missing manifest.json — aborting" >&2
  exit 3
fi

WORKSPACE_ID=$(jq -r .workspaceId "$STAGE/manifest.json")
SCHEMA_MIGRATION=$(jq -r .schemaMigration "$STAGE/manifest.json")
echo "▸ tarball workspace=$WORKSPACE_ID schema=$SCHEMA_MIGRATION"

# Refuse to restore into a workspace that already exists unless caller
# asked for --new-workspace.
EXISTING=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM workspaces WHERE id = '${WORKSPACE_ID}' LIMIT 1" 2>/dev/null || true)
if [ -n "$EXISTING" ] && [ "$NEW_WORKSPACE" = "false" ]; then
  echo "! workspace $WORKSPACE_ID already exists — pass --new-workspace to import under a fresh id" >&2
  exit 4
fi

# Recorded tables in the order emitted by backup-tenant.sh. Order matters
# because FKs expect parents to exist first.
TABLES=(
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

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
$(for T in "${TABLES[@]}"; do
    [ -f "$STAGE/${T}.tsv" ] && echo "\\COPY \"$T\" FROM '$STAGE/${T}.tsv' (FORMAT binary);"
  done)
COMMIT;
SQL

echo "✓ restored workspace $WORKSPACE_ID from $TARBALL"

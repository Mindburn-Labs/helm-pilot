#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# HELM Pilot — per-tenant restore (Phase 2d)
#
# Re-imports a single workspace dumped by `scripts/backup-tenant.sh`. Safe to
# run against a live database only when the captured workspace id is absent;
# ID remapping is intentionally unsupported until every child table can be
# rewritten consistently.
#
# Usage:
#   bash scripts/restore-tenant.sh <tarball>                    # restore under the captured id
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
while [ "$#" -gt 0 ]; do
  case "$1" in
    --new-workspace)
      echo "--new-workspace is disabled; workspace ID remapping is not production-safe yet" >&2
      exit 2
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  echo "Usage: restore-tenant.sh <tarball>" >&2
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

# Refuse to restore into a workspace that already exists.
EXISTING=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM workspaces WHERE id = '${WORKSPACE_ID}' LIMIT 1" 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  echo "! workspace $WORKSPACE_ID already exists — refusing to overwrite" >&2
  exit 4
fi

# Recorded tables in the order emitted by backup-tenant.sh. Order matters
# because FKs expect parents to exist first.
TABLES=(
  workspaces
  workspace_members
  workspace_settings
  tenant_secrets
  deploy_targets
  deployments
  deploy_health
  operators
  operator_memory
  operator_configs
  tasks
  task_runs
  task_artifacts
  plans
  milestones
  artifacts
  artifact_versions
  founder_profiles
  founder_assessments
  founder_strengths
  opportunities
  opportunity_scores
  opportunity_tags
  opportunity_clusters
  opportunity_cluster_members
  pages
  content_chunks
  links
  timeline_entries
  raw_data
  connector_grants
  connector_tokens
  connector_sessions
  audit_log
  approvals
  policy_violations
  evidence_packs
  compliance_attestations
  crawl_sources
  crawl_runs
  applications
  application_drafts
  application_artifacts
  cofounder_candidate_sources
  cofounder_candidates
  cofounder_match_evaluations
  cofounder_candidate_notes
  cofounder_outreach_drafts
  cofounder_follow_ups
  workspace_deletions
  ratelimit_buckets
)

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
$(for T in "${TABLES[@]}"; do
    [ -f "$STAGE/${T}.tsv" ] && echo "\\COPY \"$T\" FROM '$STAGE/${T}.tsv' (FORMAT binary);"
  done)
COMMIT;
SQL

echo "✓ restored workspace $WORKSPACE_ID from $TARBALL"

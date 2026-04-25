#!/usr/bin/env bash
set -euo pipefail

HELM_DB="${HELM_POSTGRES_DB:-helm_governance}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v helm_db="$HELM_DB" \
  -v owner="$POSTGRES_USER" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'helm_db', :'owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'helm_db')\gexec
SQL

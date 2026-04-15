#!/usr/bin/env bash
# Rotate SESSION_SECRET.
#
# This is destructive: all active sessions become invalid and users must re-authenticate.
# Use only with clear user comms; consider a maintenance window.

set -euo pipefail

APP="${1:-helm-pilot}"

echo "==> Rotating SESSION_SECRET for Fly app: $APP"
echo ""
echo "WARNING: This will invalidate all active sessions."
echo "All users will need to log in again after rotation."
echo ""
read -p "Proceed? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

NEW_SECRET=$(openssl rand -hex 32)

echo "==> Setting new SESSION_SECRET..."
fly secrets set SESSION_SECRET="$NEW_SECRET" --app "$APP"

echo ""
echo "==> Done. New SESSION_SECRET applied. Fly will redeploy."
echo ""
echo "==> Recommended next steps:"
echo "    1. Notify users via email/Telegram that they need to re-authenticate."
echo "    2. Watch logs for auth errors: fly logs --app $APP | grep auth"
echo "    3. Update any OAuth state signing if the old secret was shared across services."

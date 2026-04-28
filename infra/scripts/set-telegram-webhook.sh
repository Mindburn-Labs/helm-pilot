#!/usr/bin/env bash
# Sets the Telegram webhook URL for the HELM Pilot bot.
# Usage: ./set-telegram-webhook.sh <APP_URL>
# Example: ./set-telegram-webhook.sh https://pilot.example.com

set -euo pipefail

APP_URL="${1:?Usage: $0 <APP_URL>}"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"
WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-}"

WEBHOOK_URL="${APP_URL}/api/telegram/webhook"

echo "Setting webhook to: ${WEBHOOK_URL}"

BODY="{\"url\":\"${WEBHOOK_URL}\",\"allowed_updates\":[\"message\",\"callback_query\",\"managed_bot\"]"
if [ -n "${WEBHOOK_SECRET}" ]; then
  BODY="${BODY},\"secret_token\":\"${WEBHOOK_SECRET}\""
fi
BODY="${BODY}}"

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "${BODY}" | jq .

echo "Done. Verify with:"
echo "  curl https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/getWebhookInfo | jq ."

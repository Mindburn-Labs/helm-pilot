#!/usr/bin/env bash
# Sets the Telegram webhook URL for the HELM Pilot bot.
# Usage: ./set-telegram-webhook.sh <APP_URL>
# Example: ./set-telegram-webhook.sh https://helm-pilot.fly.dev

set -euo pipefail

APP_URL="${1:?Usage: $0 <APP_URL>}"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"
WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-}"

WEBHOOK_URL="${APP_URL}/api/telegram/webhook"

echo "Setting webhook to: ${WEBHOOK_URL}"

PARAMS="url=${WEBHOOK_URL}"
if [ -n "${WEBHOOK_SECRET}" ]; then
  PARAMS="${PARAMS}&secret_token=${WEBHOOK_SECRET}"
fi

curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?${PARAMS}" | jq .

echo "Done. Verify with:"
echo "  curl https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/getWebhookInfo | jq ."

#!/usr/bin/env tsx
/**
 * Rotate TELEGRAM_WEBHOOK_SECRET.
 *
 * 1. Generates a new secret
 * 2. Calls Telegram's setWebhook API with the new secret
 * 3. Prints the new value to set in your secret manager (Fly, .env, etc.)
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> APP_URL=https://your-domain \
 *     tsx scripts/rotate-telegram-webhook.ts
 */
import { randomBytes } from 'node:crypto';

async function main() {
  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  const appUrl = process.env['APP_URL'];

  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN required');
    process.exit(1);
  }
  if (!appUrl) {
    console.error('APP_URL required (your public-facing HTTPS endpoint)');
    process.exit(1);
  }

  const newSecret = randomBytes(32).toString('hex');
  const webhookUrl = `${appUrl}/api/telegram/webhook`;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: newSecret,
      allowed_updates: ['message', 'callback_query'],
    }),
  });

  if (!response.ok) {
    console.error('Telegram setWebhook failed:', await response.text());
    process.exit(1);
  }

  const data = (await response.json()) as { ok: boolean; result: boolean; description?: string };
  if (!data.ok) {
    console.error('Telegram setWebhook returned error:', data.description);
    process.exit(1);
  }

  console.log('Webhook updated. New secret:');
  console.log('');
  console.log(`TELEGRAM_WEBHOOK_SECRET=${newSecret}`);
  console.log('');
  console.log('Update your secret manager and restart the service.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { Hono } from 'hono';
import { type GatewayDeps } from '../index.js';
import { ManagedTelegramBotError } from '../services/managed-telegram-bots.js';

export function managedTelegramWebhookRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.post('/:managedBotId/webhook', async (c) => {
    if (!deps.managedTelegram) return c.json({ error: 'Managed Telegram bots unavailable' }, 503);

    const managedBotId = c.req.param('managedBotId');
    const bot = await deps.managedTelegram.getBotForWebhook(managedBotId);
    if (!bot) return c.json({ error: 'Managed bot not found' }, 404);

    const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (!deps.managedTelegram.verifyWebhookSecret(bot, secret)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const update = await c.req.json().catch(() => null);
    if (!update) return c.json({ error: 'Invalid Telegram update' }, 400);

    try {
      await deps.managedTelegram.handleChildWebhook(managedBotId, update);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ManagedTelegramBotError) {
        return c.json({ error: err.message, receipt: err.receipt }, err.status as never);
      }
      throw err;
    }
  });

  return app;
}

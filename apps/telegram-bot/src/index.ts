import { Bot, session } from 'grammy';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from '@pilot/db/client';
import { workspaces, tasks, operators } from '@pilot/db/schema';
import { type BotContext, type BotDeps, type SessionData } from './types.js';

import { registerOnboarding } from './commands/onboarding.js';
import { registerOperatorChat } from './commands/operator-chat.js';
import { registerCandidates } from './commands/candidates.js';
import { registerApprovals } from './commands/approvals.js';
import { registerDiscover } from './commands/discover.js';

export function createBot(token: string, db: Db, deps?: Partial<BotDeps>) {
  const bot = new Bot<BotContext>(token);

  bot.use(
    session({
      initial: (): SessionData => ({}),
    }),
  );

  bot.use(async (ctx, next) => {
    const update = ctx.update as {
      managed_bot?: {
        user?: { id?: number };
        bot?: { id?: number; username?: string; first_name?: string };
      };
    };
    const managed = update.managed_bot;
    if (managed?.user?.id && managed.bot?.id && deps?.claimLaunchBot) {
      try {
        const result = await deps.claimLaunchBot({
          creatorTelegramId: String(managed.user.id),
          bot: {
            id: managed.bot.id,
            username: managed.bot.username,
            firstName: managed.bot.first_name,
          },
        });
        await ctx.api
          .sendMessage(
            managed.user.id,
            `Launch/support bot @${result.telegramBotUsername} is connected and ${result.status}.`,
          )
          .catch(() => {});
      } catch (err) {
        await ctx.api
          .sendMessage(
            managed.user.id,
            `Could not connect the launch/support bot: ${err instanceof Error ? err.message : 'unknown error'}`,
          )
          .catch(() => {});
      }
      return;
    }
    await next();
  });

  // Clear awaiting flags when any command is invoked
  bot.use(async (ctx, next) => {
    if (ctx.message?.text?.startsWith('/')) {
      ctx.session.awaitingProfileInput = false;
      // Do NOT clear activeOperatorContext here, let specific commands handle it
    }
    await next();
  });

  // ─── Register Module Handlers ───
  const handleProfileInput = registerOnboarding(bot, db, deps);
  const handleOperatorChat = registerOperatorChat(bot, db, deps);
  registerCandidates(bot, db);
  registerApprovals(bot, db, deps);

  // ─── Core / Global Commands ───

  bot.command('mode', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
    if (!ws) return ctx.reply('Workspace not found.');

    await ctx.reply(
      `Current mode: *${ws.currentMode.toUpperCase()}*\n\n` +
        'Available modes:\n' +
        '/discover — Find startup opportunities\n' +
        '/decide — Lock in direction\n' +
        '/build — Execute on your plan\n' +
        '/launch — Package and ship\n' +
        '/apply — Prepare applications',
      { parse_mode: 'Markdown' },
    );
  });

  // Discover has its own rich handler; other modes are simple switches for now
  for (const mode of ['decide', 'build', 'launch', 'apply'] as const) {
    bot.command(mode, async (ctx) => {
      const wsId = ctx.session.workspaceId;
      if (!wsId) return ctx.reply('Use /start first.');

      await db
        .update(workspaces)
        .set({ currentMode: mode, updatedAt: new Date() })
        .where(eq(workspaces.id, wsId));
      await ctx.reply(`Switched to *${mode.toUpperCase()}* mode.`, { parse_mode: 'Markdown' });
    });
  }

  // Phase 3c: rich /discover with cluster-first view + inline actions
  // Static import — the dynamic import was causing top-level-await errors
  // because createBot() is not async. registerDiscover is safe to call
  // synchronously since it only registers handlers.
  registerDiscover(bot, db);

  bot.command('status', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
    const taskList = await db.select().from(tasks).where(eq(tasks.workspaceId, wsId)).limit(5);
    const ops = await db.select().from(operators).where(eq(operators.workspaceId, wsId));

    await ctx.reply(
      `*Pilot Status*\n\n` +
        `Mode: ${ws?.currentMode?.toUpperCase() ?? 'UNKNOWN'}\n` +
        `Operators: ${ops.length}\n` +
        `Active tasks: ${taskList.filter((t) => t.status === 'running').length}\n`,
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('launchbot', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    const userId = ctx.session.userId;
    const telegramId = ctx.from?.id?.toString();
    if (!wsId || !userId || !telegramId) return ctx.reply('Use /start first.');
    if (!deps?.createLaunchBotProvisioning) {
      return ctx.reply('Launch/support bot provisioning is not configured on this deployment.');
    }

    try {
      const request = await deps.createLaunchBotProvisioning({
        workspaceId: wsId,
        userId,
        creatorTelegramId: telegramId,
      });
      await ctx.reply(
        `Create your founder-owned launch/support bot here:\n\n${request.creationUrl}\n\n` +
          `Suggested bot: @${request.suggestedUsername}\n` +
          `This setup link expires at ${new Date(request.expiresAt).toLocaleString()}.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: 'Create bot in Telegram', url: request.creationUrl }]],
          },
        },
      );
    } catch (err) {
      await ctx.reply(
        `Could not create launch bot setup link: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  });

  bot.command('operators', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const ops = await db.select().from(operators).where(eq(operators.workspaceId, wsId));

    if (ops.length === 0) {
      return ctx.reply(
        'No operators created yet. Use the web UI to configure co-founder operators.',
      );
    }

    const lines = ops.map((op) => `- *${op.name}* (${op.role}) — ${op.goal}`);
    await ctx.reply(`*Your Operators*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.command('tasks', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const taskList = await db.select().from(tasks).where(eq(tasks.workspaceId, wsId)).limit(10);

    if (taskList.length === 0) {
      return ctx.reply('No tasks yet.');
    }

    const lines = taskList.map((t) => `- [${t.status}] ${t.title}`);
    await ctx.reply(`*Recent Tasks*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '*Pilot Commands*\n\n' +
        '*Getting Started*\n' +
        '/start — Initialize workspace\n' +
        '/profile — Set up founder profile\n' +
        '/status — System overview\n\n' +
        '*Modes*\n' +
        '/mode — Current mode\n' +
        '/discover — Opportunity discovery\n' +
        '/decide — Lock in direction\n' +
        '/build — Execute plan\n' +
        '/launch — Ship product\n' +
        '/apply — Prepare applications\n\n' +
        '*Launch Bot*\n' +
        '/launchbot — Create a founder-owned launch/support bot\n\n' +
        '*Work & Chat*\n' +
        '/operators — List operators\n' +
        '/chat — Talk to an operator\n' +
        '/candidates — Review opportunities\n' +
        '/tasks — Recent tasks\n' +
        '/approve — Handle approvals\n',
      { parse_mode: 'Markdown' },
    );
  });

  // ─── Text message handler routing ───
  bot.on('message:text', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    // 1. Try onboarding handler (if awaiting profile input)
    if (await handleProfileInput(ctx)) return;

    // 2. Try operator chat handler (if active chat context)
    if (await handleOperatorChat(ctx)) return;

    await ctx.reply(
      'Free-form chat coming soon. For now, use commands (/help to see all).\n\n' +
        'Tip: Use /chat to talk directly to your operators.',
    );
  });

  return bot;
}

export type { BotDeps } from './types.js';

// ─── Standalone entry point ───
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const { createLogger } = await import('@pilot/shared/logger');
  const log = createLogger('telegram-bot');

  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const dbUrl = process.env['DATABASE_URL'];

  if (!token) {
    log.fatal('TELEGRAM_BOT_TOKEN required');
    process.exit(1);
  }
  if (!dbUrl) {
    log.fatal('DATABASE_URL required');
    process.exit(1);
  }

  const { db, close: dbClose } = createDb(dbUrl);
  const bot = createBot(token, db);

  bot.start();
  log.info('Pilot Telegram bot started (standalone)');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down bot...');
    await bot.stop();
    await dbClose();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

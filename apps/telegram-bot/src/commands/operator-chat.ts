import { Bot } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { operators } from '@helm-pilot/db/schema';
import { type BotContext } from '../types.js';

export function registerOperatorChat(bot: Bot<BotContext>, db: Db) {
  bot.command('chat', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const args = ctx.match;
    if (!args) {
      // List available operators to chat with
      const ops = await db.select().from(operators).where(eq(operators.workspaceId, wsId));
      if (ops.length === 0) {
        return ctx.reply('No operators available to chat.');
      }
      const keyboard = ops.map((o) => [{ text: `Chat with ${o.name}`, callback_data: `chat:${o.id}` }]);
      keyboard.push([{ text: 'Stop Chatting', callback_data: 'chat:none' }]);

      return ctx.reply('Select an operator to chat with:', {
        reply_markup: { inline_keyboard: keyboard },
      });
    }

    // Direct command /chat <name>
    const ops = await db.select().from(operators).where(eq(operators.workspaceId, wsId));
    const op = ops.find((o) => o.name.toLowerCase() === args.toLowerCase());
    
    if (op) {
      ctx.session.activeOperatorContext = op.id;
      return ctx.reply(`You are now chatting with *${op.name}* (${op.role}).\nType your messages normally. Send /stopchat to exit.`, { parse_mode: 'Markdown' });
    } else {
      return ctx.reply(`Operator "${args}" not found.`);
    }
  });

  bot.command('stopchat', async (ctx) => {
    if (ctx.session.activeOperatorContext) {
      ctx.session.activeOperatorContext = undefined;
      return ctx.reply('Exited operator chat mode.');
    }
    return ctx.reply('You are not currently chatting with an operator.');
  });

  bot.callbackQuery(/^chat:(.+)$/, async (ctx) => {
    const action = ctx.callbackQuery.data.split(':')[1];
    if (action === 'none') {
      ctx.session.activeOperatorContext = undefined;
      return ctx.editMessageText('Exited operator chat mode.');
    }

    const wsId = ctx.session.workspaceId;
    if (!wsId || !action) return;

    const [op] = await db.select().from(operators).where(and(eq(operators.id, action), eq(operators.workspaceId, wsId))).limit(1);
    if (op) {
      ctx.session.activeOperatorContext = op.id;
      return ctx.editMessageText(`You are now chatting with *${op.name}* (${op.role}).\nType your messages normally. Send /stopchat to exit.`, { parse_mode: 'Markdown' });
    } else {
      return ctx.answerCallbackQuery({ text: 'Operator not found.' });
    }
  });

  // Handler for chatting with operator
  return async function handleOperatorChat(ctx: BotContext): Promise<boolean> {
    const wsId = ctx.session.workspaceId;
    const opId = ctx.session.activeOperatorContext;
    if (!wsId || !opId || !ctx.message?.text) return false;

    const [operator] = await db
      .select()
      .from(operators)
      .where(and(eq(operators.id, opId), eq(operators.workspaceId, wsId)))
      .limit(1);

    const replyText = operator
      ? `*${operator.name}* received: _${ctx.message.text}_\n\nDirect orchestrator chat integration is still being wired through the runtime.`
      : `Operator ${opId.slice(0, 6)} is no longer available.`;

    await ctx.reply(replyText, { parse_mode: 'Markdown' });
    return true;
  }
}

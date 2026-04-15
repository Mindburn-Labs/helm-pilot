import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { opportunities } from '@helm-pilot/db/schema';
import { type BotContext } from '../types.js';

export function registerCandidates(bot: Bot<BotContext>, db: Db) {
  bot.command('candidates', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const pending = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.workspaceId, wsId))
      .limit(5);

    const activeList = pending.filter((o) => o.status === 'identified' || o.status === 'scored');

    if (activeList.length === 0) {
      return ctx.reply('No candidate opportunities at the moment.');
    }

    await ctx.reply(`*Opportunities Review (${activeList.length})*`, { parse_mode: 'Markdown' });

    for (const opp of activeList) {
      await ctx.reply(
        `*${opp.title}*\n\n` +
          `${opp.description}\n\n` +
          `Status: ${opp.status}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Accept Direction', callback_data: `opp_accept:${opp.id}` },
                { text: 'Reject', callback_data: `opp_reject:${opp.id}` },
              ],
            ],
          },
        },
      );
    }
  });

  bot.callbackQuery(/^(opp_accept|opp_reject):(.+)$/, async (ctx) => {
    const match = ctx.callbackQuery.data.match(/^(opp_accept|opp_reject):(.+)$/);
    if (!match) return;
    const [, action, oppId] = match;
    const isAccept = action === 'opp_accept';

    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.answerCallbackQuery({ text: 'Session expired. Use /start first.' });

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, oppId!)).limit(1);
    if (!opp || opp.workspaceId !== wsId) {
      return ctx.answerCallbackQuery({ text: 'Opportunity not found or not authorized.' });
    }

    try {
      await db
        .update(opportunities)
        .set({ status: isAccept ? 'approved' : 'rejected' })
        .where(eq(opportunities.id, oppId!));

      await ctx.answerCallbackQuery({ text: isAccept ? 'Accepted direction' : 'Rejected' });
      await ctx.editMessageText(
        `*${opp.title}*\n\n${opp.description}\n\nStatus: ${isAccept ? '✅ Accepted' : '❌ Rejected'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: 'Error updating opportunity' });
    }
  });
}

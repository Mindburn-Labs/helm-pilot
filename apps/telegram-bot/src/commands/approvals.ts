import { Bot } from 'grammy';
import { and, eq } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { approvals } from '@helm-pilot/db/schema';
import { type BotContext } from '../types.js';

export function registerApprovals(bot: Bot<BotContext>, db: Db) {
  bot.command('approve', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const pending = await db
      .select()
      .from(approvals)
      .where(eq(approvals.workspaceId, wsId))
      .limit(10);
    const pendingList = pending.filter((a) => a.status === 'pending');

    if (pendingList.length === 0) {
      return ctx.reply('No pending approvals.');
    }

    for (const approval of pendingList) {
      await ctx.reply(
        `*Approval Needed*\n\n` +
          `Action: ${approval.action}\n` +
          `Reason: ${approval.reason}\n` +
          `Requested by: ${approval.requestedBy}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Approve', callback_data: `approve:${approval.id}` },
                { text: 'Reject', callback_data: `reject:${approval.id}` },
              ],
            ],
          },
        },
      );
    }
  });

  bot.callbackQuery(/^(approve|reject):(.+)$/, async (ctx) => {
    const match = ctx.callbackQuery.data.match(/^(approve|reject):(.+)$/);
    if (!match) return;
    const [, action, approvalId] = match;
    const approved = action === 'approve';

    // Verify the approving user owns the workspace for this approval
    const wsId = ctx.session.workspaceId;
    if (!wsId) {
      await ctx.answerCallbackQuery({ text: 'Session expired. Use /start first.' });
      return;
    }
    // lint-tenancy: ok — looked up by globally-unique id, then ownership
    //   verified against session.workspaceId below. The subsequent UPDATE
    //   composes both predicates so there is no TOCTOU window.
    const [approval] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, approvalId!), eq(approvals.workspaceId, wsId)))
      .limit(1);
    if (!approval) {
      await ctx.answerCallbackQuery({ text: 'Not authorized to approve this action.' });
      return;
    }

    await db
      .update(approvals)
      .set({
        status: approved ? 'approved' : 'rejected',
        resolvedBy: ctx.from?.id?.toString() ?? 'unknown',
        resolvedAt: new Date(),
      })
      .where(and(eq(approvals.id, approvalId!), eq(approvals.workspaceId, wsId)));

    await ctx.answerCallbackQuery({ text: approved ? 'Approved' : 'Rejected' });
    await ctx.editMessageText(
      `${approved ? 'Approved' : 'Rejected'} by ${ctx.from?.first_name ?? 'user'}.`,
    );
  });
}

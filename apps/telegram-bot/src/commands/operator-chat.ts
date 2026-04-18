import { Bot } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { operators, tasks } from '@helm-pilot/db/schema';
import {
  type BotContext,
  type BotDeps,
} from '../types.js';

export function registerOperatorChat(
  bot: Bot<BotContext>,
  db: Db,
  deps?: Partial<BotDeps>,
) {
  // ─── Phase 13 Track C4 — /conduct command ───
  bot.command('conduct', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');
    const prompt = (ctx.match ?? '').trim();
    if (!prompt) {
      return ctx.reply(
        'Usage: /conduct <task description>\n\nRuns a subagent-enabled conduct loop — the orchestrator may delegate to governed subagents like opportunity_scout or decision_facilitator.',
      );
    }
    if (!deps?.runConduct) {
      return ctx.reply('Orchestrator not configured for /conduct on this deployment.');
    }
    const [row] = await db
      .insert(tasks)
      .values({
        workspaceId: wsId,
        title: prompt.slice(0, 60),
        description: prompt,
        mode: 'conduct',
        status: 'running',
      })
      .returning();
    if (!row) return ctx.reply('Failed to create task.');
    await ctx.reply(`Running conduct loop on task \`${row.id.slice(0, 8)}\`…`, {
      parse_mode: 'Markdown',
    });
    try {
      const result = await deps.runConduct({
        taskId: row.id,
        workspaceId: wsId,
        context: prompt,
      });
      const cost = result.costUsd ? `$${result.costUsd.toFixed(4)}` : 'n/a';
      await ctx.reply(
        `*Conduct result*: ${result.status}\nIterations: ${result.iterationsUsed}/${result.iterationBudget}\nCost: ${cost}${result.error ? `\nError: ${result.error}` : ''}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      await ctx.reply(
        `Conduct failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  });

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

    if (!operator) {
      await ctx.reply(`Operator ${opId.slice(0, 6)} is no longer available.`, {
        parse_mode: 'Markdown',
      });
      return true;
    }

    // Phase 13 Track C4 — real orchestrator wiring. When deps.runTask is
    // present (gateway-composed process), we create a task row and run the
    // agent loop against the user's message. When absent (e.g. in the
    // polling-mode standalone runner), fall back to the prior echo stub
    // so the bot still responds coherently.
    if (!deps?.runTask) {
      await ctx.reply(
        `*${operator.name}* received: _${ctx.message.text}_\n\n_Orchestrator not wired on this deployment — message logged but not executed._`,
        { parse_mode: 'Markdown' },
      );
      return true;
    }

    const msg = ctx.message.text;
    const [row] = await db
      .insert(tasks)
      .values({
        workspaceId: wsId,
        operatorId: opId,
        title: msg.slice(0, 60),
        description: msg,
        mode: 'build',
        status: 'running',
      })
      .returning();
    if (!row) {
      await ctx.reply('Failed to create task row.');
      return true;
    }

    await ctx.reply(`*${operator.name}* is thinking…`, { parse_mode: 'Markdown' });

    try {
      const result = await deps.runTask({
        taskId: row.id,
        workspaceId: wsId,
        operatorId: opId,
        context: msg,
      });
      const cost = result.costUsd ? `$${result.costUsd.toFixed(4)}` : 'n/a';
      await ctx.reply(
        `*${operator.name}* · ${result.status}\nIterations: ${result.iterationsUsed}/${result.iterationBudget}\nCost: ${cost}${result.error ? `\nError: ${result.error}` : ''}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      await ctx.reply(
        `Task failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
    return true;
  }
}

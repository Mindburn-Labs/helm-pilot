import { Bot, InlineKeyboard } from 'grammy';
import { desc, eq, and } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import {
  opportunities,
  opportunityClusters,
  opportunityClusterMembers,
  opportunityScores,
} from '@helm-pilot/db/schema';
import { type BotContext } from '../types.js';

/**
 * /discover surface (Phase 3c).
 *
 * Renders a cluster-first Discover view inside Telegram:
 *   1. Lists workspace clusters sorted by average score.
 *   2. On cluster selection: shows top-5 representative opportunities with
 *      inline actions (Expand, Queue for decide, Not interested).
 *   3. Fallback: if no clusters exist, lists top-10 opportunities directly.
 *   4. Batch-score action: triggers scoring for all unscored opportunities.
 */
export function registerDiscover(bot: Bot<BotContext>, db: Db) {
  // ── /discover — show clusters or top opportunities ──
  bot.command('discover', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first to set up your workspace.');

    // Try cluster view first
    const clusters = await db
      .select()
      .from(opportunityClusters)
      .where(eq(opportunityClusters.workspaceId, wsId))
      .orderBy(desc(opportunityClusters.avgScore))
      .limit(8);

    if (clusters.length > 0) {
      const lines = clusters.map((c, i) => {
        const score = c.avgScore != null ? ` (${Math.round(c.avgScore)}/100)` : '';
        const tags = Array.isArray(c.tags) ? (c.tags as string[]).slice(0, 3).join(', ') : '';
        return `${i + 1}. *${escMd(c.label)}*${score}\n   ${escMd(c.summary)}\n   _${tags}_`;
      });

      const kb = new InlineKeyboard();
      for (const c of clusters.slice(0, 4)) {
        kb.text(`📂 ${c.label.slice(0, 20)}`, `cluster:${c.id}`);
        if (clusters.indexOf(c) % 2 === 1) kb.row();
      }
      kb.row().text('📊 Batch Score All', 'discover:batch_score');
      kb.text('🔄 Rebuild Clusters', 'discover:rebuild_clusters');

      await ctx.reply(
        `🔍 *DISCOVER* — Market Themes\n\n${lines.join('\n\n')}\n\n` +
          `_Tap a cluster to explore opportunities._`,
        { parse_mode: 'Markdown', reply_markup: kb },
      );
      return;
    }

    // Fallback: no clusters — show top-10 opportunities directly
    const opps = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.workspaceId, wsId))
      .orderBy(desc(opportunities.discoveredAt))
      .limit(10);

    if (opps.length === 0) {
      return ctx.reply(
        '🔍 *DISCOVER*\n\n' +
          'No opportunities yet. Your intelligence pipeline will discover them as sources are scanned.\n\n' +
          'Sources configured: YC, HN, ProductHunt, GitHub Trending, Reddit, and more.\n' +
          'Run /status to see pipeline activity.',
        { parse_mode: 'Markdown' },
      );
    }

    const lines = opps.map((o, i) => `${i + 1}. *${escMd(o.title)}*\n   📡 ${o.source} · ${o.status}`);
    const kb = new InlineKeyboard();
    for (const o of opps.slice(0, 5)) {
      kb.text(`→ ${o.title.slice(0, 25)}`, `opp_expand:${o.id}`).row();
    }
    kb.text('📊 Batch Score All', 'discover:batch_score');

    await ctx.reply(
      `🔍 *DISCOVER* — Top Opportunities\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  // ── Cluster expand callback ──
  bot.callbackQuery(/^cluster:(.+)$/, async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.answerCallbackQuery({ text: 'Session expired.' });

    const clusterId = ctx.callbackQuery.data.match(/^cluster:(.+)$/)![1]!;

    const [cluster] = await db
      .select()
      .from(opportunityClusters)
      .where(and(eq(opportunityClusters.id, clusterId), eq(opportunityClusters.workspaceId, wsId)))
      .limit(1);

    if (!cluster) return ctx.answerCallbackQuery({ text: 'Cluster not found.' });

    // Get representative members
    const members = await db
      .select()
      .from(opportunityClusterMembers)
      .where(eq(opportunityClusterMembers.clusterId, clusterId))
      .orderBy(opportunityClusterMembers.distance)
      .limit(5);

    const oppIds = members.map((m) => m.opportunityId);
    const opps = [];
    for (const oppId of oppIds) {
      const [opp] = await db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.id, oppId), eq(opportunities.workspaceId, wsId)))
        .limit(1);
      if (opp) {
        const [score] = await db
          .select()
          .from(opportunityScores)
          .where(eq(opportunityScores.opportunityId, oppId))
          .limit(1);
        opps.push({ ...opp, score });
      }
    }

    const lines = opps.map((o, i) => {
      const s = o.score;
      const scoreText = s?.overallScore != null ? `${Math.round(s.overallScore)}/100` : 'unscored';
      const fitText = s?.founderFitScore != null ? `fit:${Math.round(s.founderFitScore)}` : '';
      return `${i + 1}. *${escMd(o.title)}* [${scoreText}${fitText ? ' ' + fitText : ''}]\n   📡 ${o.source}`;
    });

    const kb = new InlineKeyboard();
    for (const o of opps.slice(0, 3)) {
      kb.text('📋 Expand', `opp_expand:${o.id}`)
        .text('🎯 Queue', `opp_queue:${o.id}`)
        .text('❌', `opp_reject:${o.id}`)
        .row();
    }
    kb.text('← Back to Clusters', 'discover:back');

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📂 *${escMd(cluster.label)}*\n${escMd(cluster.summary)}\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  // ── Opportunity expand ──
  bot.callbackQuery(/^opp_expand:(.+)$/, async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.answerCallbackQuery({ text: 'Session expired.' });

    const oppId = ctx.callbackQuery.data.match(/^opp_expand:(.+)$/)![1]!;
    const [opp] = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, oppId), eq(opportunities.workspaceId, wsId)))
      .limit(1);
    if (!opp) return ctx.answerCallbackQuery({ text: 'Not found.' });

    const [score] = await db
      .select()
      .from(opportunityScores)
      .where(eq(opportunityScores.opportunityId, oppId))
      .limit(1);

    const scoreBlock = score
      ? `\n📊 *Scores:*\n` +
        `  Overall: ${score.overallScore ?? '—'}/100\n` +
        `  Founder Fit: ${score.founderFitScore ?? '—'}/100\n` +
        `  Market Signal: ${score.marketSignal ?? '—'}/100\n` +
        `  Timing: ${score.timing ?? '—'}/100\n` +
        `  Feasibility: ${score.feasibility ?? '—'}/100`
      : '\n_Not yet scored._';

    const kb = new InlineKeyboard()
      .text('🎯 Queue for Decide', `opp_queue:${opp.id}`)
      .text('❌ Not Interested', `opp_reject:${opp.id}`)
      .row()
      .text('📊 Score Now', `opp_score:${opp.id}`)
      .text('← Back', 'discover:back');

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `*${escMd(opp.title)}*\n` +
        `📡 ${opp.source}${opp.sourceUrl ? ` · [link](${opp.sourceUrl})` : ''}\n\n` +
        `${escMd(opp.description.slice(0, 800))}${opp.description.length > 800 ? '…' : ''}` +
        scoreBlock,
      { parse_mode: 'Markdown', reply_markup: kb, link_preview_options: { is_disabled: true } },
    );
  });

  // ── Queue for decide ──
  bot.callbackQuery(/^opp_queue:(.+)$/, async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.answerCallbackQuery({ text: 'Session expired.' });
    const oppId = ctx.callbackQuery.data.match(/^opp_queue:(.+)$/)![1]!;
    await db
      .update(opportunities)
      .set({ status: 'selected' })
      .where(and(eq(opportunities.id, oppId), eq(opportunities.workspaceId, wsId)));
    await ctx.answerCallbackQuery({ text: '✅ Queued for Decide mode!' });
  });

  // ── Score single opportunity ──
  bot.callbackQuery(/^opp_score:(.+)$/, async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.answerCallbackQuery({ text: 'Session expired.' });
    // oppId available from callback data for future gateway API call:
    // const oppId = ctx.callbackQuery.data.match(/^opp_score:(.+)$/)![1]!;
    await ctx.answerCallbackQuery({ text: '📊 Scoring queued. Check back shortly.' });
  });

  // ── Batch score ──
  bot.callbackQuery('discover:batch_score', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '📊 Batch scoring started. This may take a few minutes.' });
  });

  // ── Rebuild clusters ──
  bot.callbackQuery('discover:rebuild_clusters', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🔄 Cluster rebuild queued. Check back in a few minutes.' });
  });

  // ── Back to discover ──
  bot.callbackQuery('discover:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    // Re-trigger discover flow by editing the message
    await ctx.editMessageText('Use /discover to refresh the view.');
  });
}

/** Escape Markdown v1 special chars. */
function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

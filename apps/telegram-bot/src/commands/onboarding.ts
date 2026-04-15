import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { users, workspaces, workspaceMembers, founderProfiles } from '@helm-pilot/db/schema';
import { type BotContext, type BotDeps } from '../types.js';

export function registerOnboarding(bot: Bot<BotContext>, db: Db, deps?: Partial<BotDeps>) {
  const founderIntel = deps?.founderIntel;

  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          telegramId,
          name: ctx.from?.first_name ?? 'Founder',
        })
        .returning();
    }

    if (!user) return;
    ctx.session.userId = user.id;

    // Find or create workspace
    const [existingMembership] = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
      .limit(1);

    if (existingMembership) {
      ctx.session.workspaceId = existingMembership.workspaceId;
      await ctx.reply(
        `Welcome back, ${user.name}! Your workspace is ready.\n\n` +
          'Use /mode to check your current mode, or /help for all commands.',
      );
    } else {
      const [ws] = await db
        .insert(workspaces)
        .values({ name: `${user.name}'s Workspace`, ownerId: user.id })
        .returning();

      if (!ws) return;

      await db.insert(workspaceMembers).values({
        workspaceId: ws.id,
        userId: user.id,
        role: 'owner',
      });

      ctx.session.workspaceId = ws.id;

      await ctx.reply(
        `Welcome to HELM Pilot, ${user.name}!\n\n` +
          "I've created your workspace. Let's start by understanding your background.\n\n" +
          'Use /profile to set up your founder profile, or /help for all commands.',
      );
    }
  });

  bot.command('profile', async (ctx) => {
    const wsId = ctx.session.workspaceId;
    if (!wsId) return ctx.reply('Use /start first.');

    const [existing] = await db
      .select()
      .from(founderProfiles)
      .where(eq(founderProfiles.workspaceId, wsId))
      .limit(1);

    if (existing) {
      await ctx.reply(
        `*Your Founder Profile*\n\n` +
          `Name: ${existing.name}\n` +
          `Background: ${existing.background ?? 'Not set'}\n` +
          `Experience: ${existing.experience ?? 'Not set'}\n` +
          `Interests: ${(existing.interests as string[]).join(', ') || 'Not set'}\n` +
          `Startup Vector: ${existing.startupVector ?? 'Not set'}\n\n` +
          'To update, send a message describing your background.',
        { parse_mode: 'Markdown' },
      );
    } else {
      await ctx.reply(
        'Tell me about yourself! Send a message with:\n\n' +
          '1. Your name\n' +
          '2. Your technical/professional background\n' +
          '3. Your interests and what excites you\n' +
          '4. Any relevant experience\n\n' +
          "I'll analyze your profile, score your strengths, and suggest a startup direction.",
      );
    }

    ctx.session.awaitingProfileInput = true;
  });

  // Exported handler for text messages to route to onboarding if needed
  return async function handleProfileInput(ctx: BotContext): Promise<boolean> {
    const wsId = ctx.session.workspaceId;
    if (!wsId || !ctx.session.awaitingProfileInput || !ctx.message?.text) return false;

    ctx.session.awaitingProfileInput = false;

    if (!founderIntel) {
      await db
        .insert(founderProfiles)
        .values({
          workspaceId: wsId,
          name: ctx.from?.first_name ?? 'Founder',
          background: ctx.message.text,
          interests: [],
        })
        .onConflictDoUpdate({
          target: founderProfiles.workspaceId,
          set: { background: ctx.message.text, updatedAt: new Date() },
        });
      await ctx.reply(
        'Profile saved (raw text only — LLM analysis unavailable).\n' +
          'Configure OPENROUTER_API_KEY or ANTHROPIC_API_KEY for full analysis.',
      );
      return true;
    }

    const rawText = ctx.message.text;
    await ctx.reply('Analyzing your profile... This may take a moment.');

    try {
      const result = await founderIntel.processIntake(wsId, rawText);

      const strengthLines = result.strengths
        .sort((a, b) => b.score - a.score)
        .map((s) => {
          const filled = Math.round(s.score / 10);
          const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
          return `${s.dimension}: ${bar} ${s.score}/100\n   _${s.evidence}_`;
        });

      await ctx.reply(
        `*Founder Profile Created*\n\n` +
          `Name: ${result.name}\n` +
          `Background: ${result.background}\n\n` +
          `*Strength Assessment*\n${strengthLines.join('\n\n')}\n\n` +
          `*Startup Vector*\n${result.startupVector}\n\n` +
          'Use /discover to start exploring opportunities that match your profile.',
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await ctx.reply(
        `Could not analyze profile: ${msg}\n\n` +
          'Your text has been saved. Try /profile again once LLM is configured.',
      );

      await db
        .insert(founderProfiles)
        .values({
          workspaceId: wsId,
          name: ctx.from?.first_name ?? 'Founder',
          background: rawText,
          interests: [],
        })
        .onConflictDoUpdate({
          target: founderProfiles.workspaceId,
          set: {
            background: rawText,
            updatedAt: new Date(),
          },
        });
    }
    return true;
  };
}

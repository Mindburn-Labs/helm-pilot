import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { users, sessions, apiKeys, workspaces, workspaceMembers } from '@helm-pilot/db/schema';
import { generateToken, generateApiKey, hashApiKey } from '../middleware/auth.js';
import { type GatewayDeps } from '../index.js';

export function authRoutes(deps: GatewayDeps) {
  const app = new Hono();

  // POST /api/auth/telegram — Validate Telegram Web App init data, create session
  app.post('/telegram', async (c) => {
    const body = await c.req.json();
    const initData: string | undefined = body.initData;
    if (!initData) {
      return c.json({ error: 'initData required' }, 400);
    }

    const botToken = process.env['TELEGRAM_BOT_TOKEN'];
    if (!botToken) {
      return c.json({ error: 'Telegram not configured' }, 503);
    }

    // Validate Telegram Web App initData (HMAC)
    const parsed = validateTelegramInitData(initData, botToken);
    if (!parsed) {
      return c.json({ error: 'Invalid Telegram initData' }, 401);
    }

    const telegramId = parsed.id.toString();
    const name = [parsed.first_name, parsed.last_name].filter(Boolean).join(' ') || 'Founder';

    // Find or create user
    let [user] = await deps.db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (!user) {
      [user] = await deps.db
        .insert(users)
        .values({ telegramId, name })
        .returning();
    }

    if (!user) return c.json({ error: 'Failed to create user' }, 500);

    // Find or create workspace
    let [membership] = await deps.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
      .limit(1);

    if (!membership) {
      const [ws] = await deps.db
        .insert(workspaces)
        .values({ name: `${name}'s Workspace`, ownerId: user.id })
        .returning();
      if (ws) {
        [membership] = await deps.db
          .insert(workspaceMembers)
          .values({ workspaceId: ws.id, userId: user.id, role: 'owner' })
          .returning();
      }
    }

    // Create session (30-day expiry)
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await deps.db.insert(sessions).values({
      userId: user.id,
      token,
      channel: 'telegram',
      expiresAt,
    });

    // Resolve workspace name for the response
    let workspaceName = 'Workspace';
    if (membership) {
      const [ws] = await deps.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, membership.workspaceId))
        .limit(1);
      if (ws) workspaceName = ws.name;
    }

    return c.json({
      token,
      user: { id: user.id, name: user.name, telegramId },
      workspace: membership
        ? { id: membership.workspaceId, name: workspaceName }
        : null,
      expiresAt: expiresAt.toISOString(),
    });
  });

  // POST /api/auth/apikey — Create an API key (requires auth)
  app.post('/apikey', async (c) => {
    const userId = c.get('userId');
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json().catch(() => ({}));
    const name = (body as { name?: string }).name ?? 'default';

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await deps.db.insert(apiKeys).values({ userId, name, keyHash, expiresAt });

    return c.json({ key: rawKey, name, expiresAt: expiresAt.toISOString() }, 201);
  });

  // POST /api/auth/email/request — Request magic link
  app.post('/email/request', async (c) => {
    const body = await c.req.json();
    const { email } = body as { email: string };
    if (!email || !email.includes('@')) {
      return c.json({ error: 'Valid email required' }, 400);
    }

    // Generate a magic link token (6-digit code + random token)
    const magicToken = generateToken();
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store as a session with 'email_pending' channel (15-min expiry)
    // Find or create user by email
    let [user] = await deps.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      [user] = await deps.db
        .insert(users)
        .values({ email, name: email.split('@')[0] ?? 'User' })
        .returning();
    }
    if (!user) return c.json({ error: 'Failed to create user' }, 500);

    // Store magic link token in sessions
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await deps.db.insert(sessions).values({
      userId: user.id,
      token: `magic:${code}:${magicToken}`,
      channel: 'email_pending',
      expiresAt,
    });

    // In production, send email with the code. V1: log it.
    const log = (await import('@helm-pilot/shared/logger')).createLogger('auth');
    log.info({ email, code }, 'Magic link code generated (email sending not configured — use code directly)');

    return c.json({
      sent: true,
      email,
      // V1: return code in response for development. Remove in production.
      ...(process.env['NODE_ENV'] !== 'production' ? { code } : {}),
    });
  });

  // POST /api/auth/email/verify — Verify magic link code
  app.post('/email/verify', async (c) => {
    const body = await c.req.json();
    const { email, code } = body as { email: string; code: string };
    if (!email || !code) {
      return c.json({ error: 'email and code required' }, 400);
    }

    // Find the user
    const [user] = await deps.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) return c.json({ error: 'Invalid code' }, 401);

    // Find the magic session
    const allSessions = await deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));

    const magicSession = allSessions.find(
      (s) => s.channel === 'email_pending' && s.token.startsWith(`magic:${code}:`) && new Date(s.expiresAt) > new Date(),
    );

    if (!magicSession) return c.json({ error: 'Invalid or expired code' }, 401);

    // Delete the magic session
    await deps.db.delete(sessions).where(eq(sessions.id, magicSession.id));

    // Find or create workspace
    let [membership] = await deps.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
      .limit(1);

    if (!membership) {
      const name = user.name ?? email.split('@')[0] ?? 'User';
      const [ws] = await deps.db
        .insert(workspaces)
        .values({ name: `${name}'s Workspace`, ownerId: user.id })
        .returning();
      if (ws) {
        [membership] = await deps.db
          .insert(workspaceMembers)
          .values({ workspaceId: ws.id, userId: user.id, role: 'owner' })
          .returning();
      }
    }

    // Create real session (30-day expiry)
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await deps.db.insert(sessions).values({
      userId: user.id,
      token,
      channel: 'email',
      expiresAt,
    });

    let workspaceName = 'Workspace';
    if (membership) {
      const [ws] = await deps.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, membership.workspaceId))
        .limit(1);
      if (ws) workspaceName = ws.name;
    }

    return c.json({
      token,
      user: { id: user.id, name: user.name, email },
      workspace: membership
        ? { id: membership.workspaceId, name: workspaceName }
        : null,
      expiresAt: expiresAt.toISOString(),
    });
  });

  // DELETE /api/auth/session — Logout
  app.delete('/session', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'No session' }, 400);
    }
    const token = authHeader.slice(7);
    await deps.db.delete(sessions).where(eq(sessions.token, token));
    return c.json({ ok: true });
  });

  // POST /api/auth/invite/:token — Accept workspace invite
  // Token format: invite:{workspaceId}:{role}:{randomToken}
  app.post('/invite/:token', async (c) => {
    const { token: inviteToken } = c.req.param();
    const body = await c.req.json();
    const { email } = body as { email?: string };
    if (!email) return c.json({ error: 'email required' }, 400);

    // Find the pending invite session by token prefix match
    const fullToken = `invite:${inviteToken}`;
    const [inviteSession] = await deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.token, fullToken))
      .limit(1);

    if (!inviteSession || inviteSession.channel !== 'invite' || new Date(inviteSession.expiresAt) < new Date()) {
      return c.json({ error: 'Invalid or expired invite' }, 401);
    }

    // Parse workspaceId and role from token
    // Token stored as: invite:{wsId}:{role}:{random}
    const parts = inviteSession.token.split(':');
    const workspaceId = parts[1];
    const role = parts[2] ?? 'member';

    if (!workspaceId) return c.json({ error: 'Malformed invite token' }, 400);

    // Find or create user
    let [user] = await deps.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) {
      [user] = await deps.db
        .insert(users)
        .values({ email, name: email.split('@')[0] ?? 'User' })
        .returning();
    }
    if (!user) return c.json({ error: 'Failed to create user' }, 500);

    // Add to workspace
    await deps.db
      .insert(workspaceMembers)
      .values({ workspaceId, userId: user.id, role })
      .onConflictDoNothing();

    // Delete the invite session
    await deps.db.delete(sessions).where(eq(sessions.id, inviteSession.id));

    // Create auth session
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await deps.db.insert(sessions).values({
      userId: user.id,
      token: sessionToken,
      channel: 'email',
      expiresAt,
    });

    return c.json({
      token: sessionToken,
      workspaceId,
      role,
    });
  });

  return app;
}

// ─── Telegram Init Data Validation ───

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

function validateTelegramInitData(initData: string, botToken: string): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    const userStr = params.get('user');
    if (!userStr) return null;

    return JSON.parse(userStr) as TelegramUser;
  } catch {
    return null;
  }
}

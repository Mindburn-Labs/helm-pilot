import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  users,
  sessions,
  apiKeys,
  workspaces,
  workspaceMembers,
  auditLog,
} from '@helm-pilot/db/schema';
import {
  clearSessionCookies,
  generateApiKey,
  generateToken,
  hashApiKey,
  SESSION_COOKIE_NAME,
  setSessionCookies,
} from '../middleware/auth.js';
import { type GatewayDeps } from '../index.js';

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
const TELEGRAM_AUTH_FUTURE_SKEW_SECONDS = 60;
const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

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
      [user] = await deps.db.insert(users).values({ telegramId, name }).returning();
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
    const csrfToken = setSessionCookies(c, token, expiresAt);

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
      csrfToken,
      user: { id: user.id, name: user.name, telegramId },
      workspace: membership ? { id: membership.workspaceId, name: workspaceName } : null,
      expiresAt: expiresAt.toISOString(),
    });
  });

  // POST /api/auth/email/request — Request magic link
  app.post('/email/request', async (c) => {
    const body = await c.req.json();
    const rawEmail = (body as { email: string }).email;
    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes('@')) {
      return c.json({ error: 'Valid email required' }, 400);
    }

    // Generate a crypto-backed 6-digit code and store only an HMAC digest.
    const code = randomInt(100000, 1000000).toString();
    const magicToken = createMagicCodeSessionToken(email, code);

    // Store as a session with 'email_pending' channel (15-min expiry)
    // Find or create user by email
    let [user] = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user) {
      [user] = await deps.db
        .insert(users)
        .values({ email, name: email.split('@')[0] ?? 'User' })
        .returning();
    }
    if (!user) return c.json({ error: 'Failed to create user' }, 500);

    // Store magic link token in sessions
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
    await deps.db.insert(sessions).values({
      userId: user.id,
      token: magicToken,
      channel: 'email_pending',
      expiresAt,
    });

    // Send email with the code + link. In dev (noop provider), also return code in response.
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
    const linkUrl = `${appUrl}/login?email=${encodeURIComponent(email)}&code=${code}`;
    const isDev = process.env['NODE_ENV'] !== 'production';

    try {
      if (deps.emailProvider) {
        await deps.emailProvider.sendMagicLink({ to: email, code, linkUrl });
      }
      await recordAuthAudit(deps, {
        action: 'auth.email.request',
        actor: email,
        verdict: 'allow',
        reason: 'magic_code_issued',
      });
    } catch (err) {
      const log = (await import('@helm-pilot/shared/logger')).createLogger('auth');
      log.error({ err, email }, 'Failed to send magic link email');
      await recordAuthAudit(deps, {
        action: 'auth.email.request',
        actor: email,
        verdict: 'deny',
        reason: 'email_delivery_failed',
      });
      // In production, fail the request — user has no way to get the code.
      // In dev, still return the code so developers can log in.
      if (!isDev) {
        return c.json({ error: 'Failed to send login email. Please try again.' }, 502);
      }
    }

    return c.json({
      sent: true,
      email,
      // Dev-only: return code in response when the provider is noop.
      // In production (resend/smtp), the code is delivered via email only.
      ...(isDev && deps.emailProvider?.kind === 'noop' ? { code } : {}),
    });
  });

  // POST /api/auth/email/verify — Verify magic link code
  app.post('/email/verify', async (c) => {
    const body = await c.req.json();
    const rawEmail = (body as { email: string; code: string }).email;
    const email = normalizeEmail(rawEmail);
    const { code } = body as { email: string; code: string };
    if (!email || !code) {
      return c.json({ error: 'email and code required' }, 400);
    }

    // Find the user
    const [user] = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) return c.json({ error: 'Invalid code' }, 401);

    // Find the magic session
    const allSessions = await deps.db.select().from(sessions).where(eq(sessions.userId, user.id));

    const pendingSessions = allSessions.filter(
      (s) => s.channel === 'email_pending' && new Date(s.expiresAt) > new Date(),
    );
    const magicSession = pendingSessions.find((s) => isMagicCodeSessionMatch(email, code, s.token));

    if (!magicSession) {
      await recordFailedMagicCodeAttempt(deps, pendingSessions);
      await recordAuthAudit(deps, {
        action: 'auth.email.verify',
        actor: email,
        verdict: 'deny',
        reason: 'invalid_or_expired_code',
      });
      return c.json({ error: 'Invalid or expired code' }, 401);
    }

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
    const csrfToken = setSessionCookies(c, token, expiresAt);
    await recordAuthAudit(deps, {
      action: 'auth.email.verify',
      actor: email,
      verdict: 'allow',
      reason: 'magic_code_redeemed',
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
      csrfToken,
      user: { id: user.id, name: user.name, email },
      workspace: membership ? { id: membership.workspaceId, name: workspaceName } : null,
      expiresAt: expiresAt.toISOString(),
    });
  });

  // DELETE /api/auth/session — Logout
  app.delete('/session', async (c) => {
    const authHeader = c.req.header('Authorization');
    const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!authHeader?.startsWith('Bearer ') && !cookieToken) {
      return c.json({ error: 'No session' }, 400);
    }
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;
    if (!token) return c.json({ error: 'No session' }, 400);
    await deps.db.delete(sessions).where(eq(sessions.token, token));
    clearSessionCookies(c);
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

    if (
      !inviteSession ||
      inviteSession.channel !== 'invite' ||
      new Date(inviteSession.expiresAt) < new Date()
    ) {
      return c.json({ error: 'Invalid or expired invite' }, 401);
    }

    // Parse workspaceId and role from token
    // Token stored as: invite:{wsId}:{role}:{random}
    const parts = inviteSession.token.split(':');
    const workspaceId = parts[1];
    const role = parts[2] ?? 'member';

    if (!workspaceId) return c.json({ error: 'Malformed invite token' }, 400);

    // Find or create user
    let [user] = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
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
    const csrfToken = setSessionCookies(c, sessionToken, expiresAt);

    return c.json({
      token: sessionToken,
      csrfToken,
      user: { id: user.id, name: user.name, email: user.email },
      workspaceId,
      role,
    });
  });

  return app;
}

export function authenticatedAuthRoutes(deps: GatewayDeps) {
  const app = new Hono();

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

  return app;
}

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function createMagicCodeSessionToken(email: string, code: string): string {
  const salt = randomBytes(16).toString('base64url');
  const digest = hashMagicCode(email, code, salt);
  return `magic:v2:${salt}:${digest}:0:${generateToken()}`;
}

function hashMagicCode(email: string, code: string, salt: string): string {
  const secret = process.env['SESSION_SECRET'] ?? 'dev-session-secret';
  return createHmac('sha256', secret)
    .update('helm-pilot:email-code:v2')
    .update('\0')
    .update(email)
    .update('\0')
    .update(salt)
    .update('\0')
    .update(code)
    .digest('hex');
}

function isMagicCodeSessionMatch(email: string, code: string, token: string): boolean {
  const parsed = parseMagicCodeSessionToken(token);
  if (!parsed) return false;

  if (parsed.version === 'legacy') {
    return timingSafeStringEqual(code, parsed.code);
  }

  if (parsed.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return false;
  return timingSafeHexEqual(hashMagicCode(email, code, parsed.salt), parsed.digest);
}

function parseMagicCodeSessionToken(
  token: string,
):
  | { version: 'v2'; salt: string; digest: string; attempts: number; nonce: string }
  | { version: 'legacy'; code: string }
  | null {
  const parts = token.split(':');
  if (parts[0] !== 'magic') return null;

  if (parts[1] === 'v2') {
    const [, , salt, digest, attemptsRaw, nonce] = parts;
    const attempts = Number(attemptsRaw);
    if (!salt || !digest || !Number.isInteger(attempts) || !nonce) return null;
    return { version: 'v2', salt, digest, attempts, nonce };
  }

  if (parts.length >= 3 && /^\d{6}$/.test(parts[1] ?? '')) {
    return { version: 'legacy', code: parts[1] ?? '' };
  }

  return null;
}

async function recordFailedMagicCodeAttempt(
  deps: GatewayDeps,
  pendingSessions: Array<{ id: string; token: string }>,
) {
  for (const session of pendingSessions) {
    const parsed = parseMagicCodeSessionToken(session.token);
    if (!parsed || parsed.version !== 'v2') continue;

    const attempts = parsed.attempts + 1;
    if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      await deps.db.delete(sessions).where(eq(sessions.id, session.id));
      continue;
    }

    const nextToken = `magic:v2:${parsed.salt}:${parsed.digest}:${attempts}:${parsed.nonce}`;
    await deps.db.update(sessions).set({ token: nextToken }).where(eq(sessions.id, session.id));
  }
}

function timingSafeHexEqual(leftHex: string, rightHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(leftHex) || !/^[0-9a-f]{64}$/i.test(rightHex)) return false;
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function recordAuthAudit(
  deps: GatewayDeps,
  entry: { action: string; actor: string; verdict: string; reason: string },
) {
  try {
    await deps.db.insert(auditLog).values({
      workspaceId: null,
      action: entry.action,
      actor: entry.actor,
      target: 'email_login',
      verdict: entry.verdict,
      reason: entry.reason,
      metadata: {},
    });
  } catch {
    // Public auth must not fail closed because an audit insert failed.
  }
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
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;

    const authDateRaw = params.get('auth_date');
    if (!authDateRaw || !/^\d+$/.test(authDateRaw)) return null;
    const authDate = Number(authDateRaw);
    const now = Math.floor(Date.now() / 1000);
    const age = now - authDate;
    if (age > TELEGRAM_AUTH_MAX_AGE_SECONDS || age < -TELEGRAM_AUTH_FUTURE_SKEW_SECONDS) {
      return null;
    }

    params.delete('hash');
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest();
    const providedHash = Buffer.from(hash, 'hex');

    if (
      providedHash.length !== computedHash.length ||
      !timingSafeEqual(providedHash, computedHash)
    ) {
      return null;
    }

    const userStr = params.get('user');
    if (!userStr) return null;

    return JSON.parse(userStr) as TelegramUser;
  } catch {
    return null;
  }
}

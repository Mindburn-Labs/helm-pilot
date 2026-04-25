import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { authenticatedAuthRoutes, authRoutes } from '../../routes/auth.js';
import { createGateway } from '../../index.js';
import {
  createMockDeps,
  testApp,
  expectJson,
  mockUser,
  mockSession,
  mockMembership,
  mockWorkspace,
} from '../helpers.js';

describe('authRoutes', () => {
  let savedBotToken: string | undefined;

  beforeEach(() => {
    savedBotToken = process.env['TELEGRAM_BOT_TOKEN'];
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
  });

  afterEach(() => {
    if (savedBotToken === undefined) {
      delete process.env['TELEGRAM_BOT_TOKEN'];
    } else {
      process.env['TELEGRAM_BOT_TOKEN'] = savedBotToken;
    }
  });

  // ─── POST /telegram ───

  describe('POST /telegram', () => {
    it('returns 400 when initData is missing', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/telegram', {});
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'initData required');
    });

    it('returns 503 when TELEGRAM_BOT_TOKEN is not set', async () => {
      delete process.env['TELEGRAM_BOT_TOKEN'];
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/telegram', { initData: 'some=data&hash=abc' });
      const json = await expectJson(res, 503);
      expect(json).toHaveProperty('error', 'Telegram not configured');
    });

    it('returns 401 when HMAC is invalid', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/telegram', {
        initData: 'user=%7B%22id%22%3A123%7D&auth_date=1700000000&hash=invalidhashvalue',
      });
      const json = await expectJson(res, 401);
      expect(json).toHaveProperty('error', 'Invalid Telegram initData');
    });

    it('returns 401 when signed initData is stale', async () => {
      const { fetch } = testApp(authRoutes);
      const staleAuthDate = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
      const res = await fetch('POST', '/telegram', {
        initData: signedTelegramInitData('test-token', staleAuthDate),
      });
      const json = await expectJson(res, 401);
      expect(json).toHaveProperty('error', 'Invalid Telegram initData');
    });

    it('returns 401 when signed initData is too far in the future', async () => {
      const { fetch } = testApp(authRoutes);
      const futureAuthDate = Math.floor(Date.now() / 1000) + 120;
      const res = await fetch('POST', '/telegram', {
        initData: signedTelegramInitData('test-token', futureAuthDate),
      });
      const json = await expectJson(res, 401);
      expect(json).toHaveProperty('error', 'Invalid Telegram initData');
    });
  });

  // ─── POST /apikey ───

  describe('POST /apikey', () => {
    it('is not mounted on the public auth routes', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/apikey', { name: 'my-key' });
      expect(res.status).toBe(404);
    });

    it('returns 201 with api key when userId is set', async () => {
      const deps = createMockDeps();
      const app = new Hono();
      // Inject userId via middleware since there is no auth middleware in test
      app.use('*', async (c, next) => {
        c.set('userId', 'user-1');
        await next();
      });
      app.route('/', authenticatedAuthRoutes(deps));

      const res = await app.fetch(
        new Request('http://localhost/apikey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'ci-key' }),
        }),
      );
      const json = await expectJson<{ key: string; name: string; expiresAt: string }>(res, 201);
      expect(json.key).toMatch(/^hp_/);
      expect(json.name).toBe('ci-key');
      expect(json.expiresAt).toBeDefined();
    });

    it('is reachable through the full gateway only after auth middleware succeeds', async () => {
      const deps = createMockDeps();
      deps.db._setResult([mockSession({ token: 'session-token', createdAt: new Date() })]);
      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => Promise.resolve([])),
      })) as any;
      const app = createGateway(deps);

      const res = await app.fetch(
        new Request('http://localhost/api/auth/apikey', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer session-token',
          },
          body: JSON.stringify({ name: 'full-gateway-key' }),
        }),
      );

      const json = await expectJson<{ key: string; name: string; expiresAt: string }>(res, 201);
      expect(json.key).toMatch(/^hp_/);
      expect(json.name).toBe('full-gateway-key');
    });
  });

  // ─── POST /email/request ───

  describe('POST /email/request', () => {
    it('returns 400 when email is missing', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/email/request', {});
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Valid email required');
    });

    it('returns 400 when email has no @', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/email/request', { email: 'not-an-email' });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Valid email required');
    });

    it('returns sent:true on success', async () => {
      const sendMagicLink = vi.fn(async () => {});
      const randomSpy = vi.spyOn(Math, 'random');
      const deps = createMockDeps({
        emailProvider: { kind: 'noop', sendMagicLink } as any,
      });
      // First select (find user by email) returns nothing, then insert returns the new user
      deps.db.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              then: (r: any) => r([]),
            })),
          })),
        })),
      })) as any;
      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [mockUser({ email: 'test@example.com' })]),
          then: (r: any) => r([mockUser({ email: 'test@example.com' })]),
        })),
      })) as any;

      const app = new Hono();
      app.route('/', authRoutes(deps));
      const res = await app.fetch(
        new Request('http://localhost/email/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        }),
      );
      const json = await expectJson<{ sent: boolean; email: string; code?: string }>(res, 200);
      expect(json.sent).toBe(true);
      expect(json.email).toBe('test@example.com');
      expect(json.code).toMatch(/^\d{6}$/);
      expect(sendMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com', code: json.code }),
      );
      expect(randomSpy).not.toHaveBeenCalled();
      randomSpy.mockRestore();
    });
  });

  // ─── POST /email/verify ───

  describe('POST /email/verify', () => {
    it('returns 400 when fields are missing', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/email/verify', { email: 'a@b.com' });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'email and code required');
    });

    it('returns 401 when user not found', async () => {
      // Default mock db returns [] for selects, so user won't be found
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/email/verify', {
        email: 'ghost@example.com',
        code: '123456',
      });
      const json = await expectJson(res, 401);
      expect(json).toHaveProperty('error', 'Invalid code');
    });

    it('returns 401 when no matching magic session', async () => {
      const deps = createMockDeps();
      let selectCallCount = 0;
      deps.db.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCallCount++;
            // First select: find user by email -> return a user
            // Second select: find sessions by userId -> return empty (no magic session)
            const result = selectCallCount === 1 ? [mockUser()] : [];
            return {
              limit: vi.fn(() => ({
                then: (r: any) => r(result),
              })),
              then: (r: any) => r(result),
            };
          }),
        })),
      })) as any;

      const app = new Hono();
      app.route('/', authRoutes(deps));
      const res = await app.fetch(
        new Request('http://localhost/email/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', code: '999999' }),
        }),
      );
      const json = await expectJson(res, 401);
      expect(json).toHaveProperty('error', 'Invalid or expired code');
    });
  });

  // ─── DELETE /session ───

  describe('DELETE /session', () => {
    it('returns 400 when no Bearer token is provided', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('DELETE', '/session');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'No session');
    });

    it('returns ok:true on success', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('DELETE', '/session', undefined, {
        Authorization: 'Bearer test-token-abc123',
      });
      const json = await expectJson<{ ok: boolean }>(res, 200);
      expect(json.ok).toBe(true);
    });
  });

  // ─── POST /invite/:token ───

  describe('POST /invite/:token', () => {
    it('returns 400 when email is missing', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/invite/some-token', {});
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'email required');
    });

    it('returns 401 when invite session not found or expired', async () => {
      // Default mock db returns [] — no invite session found
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/invite/some-token', { email: 'invitee@example.com' });
      const json = await expectJson(res, 401);
      expect(json).toHaveProperty('error', 'Invalid or expired invite');
    });
  });
});

function signedTelegramInitData(botToken: string, authDate: number): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('user', JSON.stringify({ id: 123, first_name: 'Test' }));
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

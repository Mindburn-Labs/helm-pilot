import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from '../../routes/auth.js';
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
  });

  // ─── POST /apikey ───

  describe('POST /apikey', () => {
    it('returns 401 when userId is not set (no auth middleware)', async () => {
      const { fetch } = testApp(authRoutes);
      const res = await fetch('POST', '/apikey', { name: 'my-key' });
      const json = await expectJson(res, 401);
      expect(json).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 201 with api key when userId is set', async () => {
      const deps = createMockDeps();
      const app = new Hono();
      // Inject userId via middleware since there is no auth middleware in test
      app.use('*', async (c, next) => {
        c.set('userId', 'user-1');
        await next();
      });
      app.route('/', authRoutes(deps));

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
      const deps = createMockDeps();
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
      const json = await expectJson<{ sent: boolean; email: string }>(res, 200);
      expect(json.sent).toBe(true);
      expect(json.email).toBe('test@example.com');
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
      const res = await fetch('POST', '/email/verify', { email: 'ghost@example.com', code: '123456' });
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

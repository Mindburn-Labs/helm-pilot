import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { authenticatedAuthRoutes, authRoutes } from '../../routes/auth.js';
import { createGateway } from '../../index.js';
import { requireAuth } from '../../middleware/auth.js';
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

    it('requires CSRF header for mutating cookie-authenticated requests', async () => {
      const deps = createMockDeps();
      deps.db._setResult([mockSession({ token: 'cookie-session', createdAt: new Date() })]);
      const app = new Hono();
      app.use('*', requireAuth(deps.db as any));
      app.post('/protected', (c) => c.json({ userId: c.get('userId') }));

      const missingCsrf = await app.fetch(
        new Request('http://localhost/protected', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'helm_session=cookie-session',
          },
        }),
      );

      expect(missingCsrf.status).toBe(403);

      const ok = await app.fetch(
        new Request('http://localhost/protected', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'helm_session=cookie-session; helm_csrf=csrf-token',
            'X-CSRF-Token': 'csrf-token',
          },
        }),
      );
      const json = await expectJson<{ userId: string }>(ok, 200);
      expect(json.userId).toBe('user-1');
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
      const insertedValues: Array<Record<string, unknown>> = [];
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
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return {
            returning: vi.fn(async () => [mockUser({ email: 'test@example.com' })]),
            then: (r: any) => r([mockUser({ email: 'test@example.com' })]),
          };
        }),
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
      const pending = insertedValues.find((values) => values.channel === 'email_pending');
      expect(pending?.token).toMatch(/^magic:v2:/);
      expect(String(pending?.token)).not.toContain(json.code ?? '');
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

    it('redeems hashed magic codes once and deletes the pending session', async () => {
      const sendMagicLink = vi.fn(async () => {});
      const insertedValues: Array<Record<string, unknown>> = [];
      const deps = createMockDeps({
        emailProvider: { kind: 'noop', sendMagicLink } as any,
      });

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
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return {
            returning: vi.fn(async () => [mockUser({ email: 'test@example.com' })]),
            then: (r: any) => r([]),
          };
        }),
      })) as any;

      const app = new Hono();
      app.route('/', authRoutes(deps));
      const requestRes = await app.fetch(
        new Request('http://localhost/email/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'TEST@example.com' }),
        }),
      );
      const requestJson = await expectJson<{ code: string }>(requestRes, 200);
      const pending = insertedValues.find((values) => values.channel === 'email_pending');
      expect(pending?.token).toMatch(/^magic:v2:/);

      let selectCallCount = 0;
      deps.db.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCallCount++;
            const result =
              selectCallCount === 1
                ? [mockUser({ email: 'test@example.com' })]
                : selectCallCount === 2
                  ? [
                      mockSession({
                        id: 'pending-1',
                        token: pending?.token,
                        channel: 'email_pending',
                        expiresAt: new Date(Date.now() + 60_000),
                      }),
                    ]
                  : selectCallCount === 3
                    ? [mockMembership()]
                    : [mockWorkspace()];
            return {
              limit: vi.fn(() => ({
                then: (r: any) => r(result),
              })),
              then: (r: any) => r(result),
            };
          }),
        })),
      })) as any;
      deps.db.delete = vi.fn(() => ({
        where: vi.fn(() => ({
          then: (r: any) => r([]),
        })),
      })) as any;
      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          then: (r: any) => r([]),
        })),
      })) as any;

      const verifyRes = await app.fetch(
        new Request('http://localhost/email/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', code: requestJson.code }),
        }),
      );

      const verifyJson = await expectJson<{ token: string; csrfToken: string }>(verifyRes, 200);
      expect(verifyJson.token).toMatch(/^[a-f0-9]{64}$/);
      expect(verifyJson.csrfToken).toMatch(/^[a-f0-9]{64}$/);
      expect(verifyRes.headers.get('set-cookie') ?? '').toContain('helm_session=');
      expect(deps.db.delete).toHaveBeenCalled();
    });

    it('deletes pending hashed code after the final failed attempt', async () => {
      const sendMagicLink = vi.fn(async () => {});
      const insertedValues: Array<Record<string, unknown>> = [];
      const deps = createMockDeps({
        emailProvider: { kind: 'noop', sendMagicLink } as any,
      });

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
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return {
            returning: vi.fn(async () => [mockUser({ email: 'test@example.com' })]),
            then: (r: any) => r([]),
          };
        }),
      })) as any;

      const app = new Hono();
      app.route('/', authRoutes(deps));
      const requestRes = await app.fetch(
        new Request('http://localhost/email/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        }),
      );
      await expectJson(requestRes, 200);
      const pending = insertedValues.find((values) => values.channel === 'email_pending');
      const finalAttemptToken = String(pending?.token).replace(/:0:/, ':4:');

      let selectCallCount = 0;
      deps.db.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCallCount++;
            const result =
              selectCallCount === 1
                ? [mockUser({ email: 'test@example.com' })]
                : [
                    mockSession({
                      id: 'pending-1',
                      token: finalAttemptToken,
                      channel: 'email_pending',
                      expiresAt: new Date(Date.now() + 60_000),
                    }),
                  ];
            return {
              limit: vi.fn(() => ({
                then: (r: any) => r(result),
              })),
              then: (r: any) => r(result),
            };
          }),
        })),
      })) as any;
      deps.db.delete = vi.fn(() => ({
        where: vi.fn(() => ({
          then: (r: any) => r([]),
        })),
      })) as any;

      const verifyRes = await app.fetch(
        new Request('http://localhost/email/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', code: '000000' }),
        }),
      );

      const verifyJson = await expectJson(verifyRes, 401);
      expect(verifyJson).toHaveProperty('error', 'Invalid or expired code');
      expect(deps.db.delete).toHaveBeenCalled();
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

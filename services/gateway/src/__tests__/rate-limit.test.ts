import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimit, _resetRateLimitForTests } from '../middleware/rate-limit.js';

// Minimal mock helpers for Hono Context and Next
interface MockContext {
  get: (key: string) => string | undefined;
  req: { header: (name: string) => string | undefined };
  json: (body: unknown, status?: number) => unknown;
  res: { headers: { set: (name: string, value: string) => void } };
}

function createMockContext(opts: {
  userId?: string;
  forwardedFor?: string;
} = {}): MockContext {
  const headersSet = vi.fn();
  return {
    get: (key: string) => (key === 'userId' ? opts.userId : undefined),
    req: {
      header: (name: string) => (name === 'x-forwarded-for' ? opts.forwardedFor : undefined),
    },
    json: vi.fn((_body: unknown, _status?: number) => 'json-response'),
    res: { headers: { set: headersSet } },
  };
}

function createMockNext(): () => Promise<void> {
  return vi.fn(async () => {});
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls next() when under the limit', async () => {
    const middleware = rateLimit({ windowMs: 10_000, max: 5 });
    const c = createMockContext({ userId: 'user-1' });
    const next = createMockNext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(c.json).not.toHaveBeenCalled();
  });

  it('keys by userId when present', async () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 2 });
    const next = createMockNext();

    // Two different users each get their own window
    const c1 = createMockContext({ userId: 'alice' });
    const c2 = createMockContext({ userId: 'bob' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c1 as any, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c1 as any, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c2 as any, next);

    // alice hit 2/2, bob hit 1/2 — all allowed
    expect(next).toHaveBeenCalledTimes(3);
    expect(c1.json).not.toHaveBeenCalled();
    expect(c2.json).not.toHaveBeenCalled();
  });

  it('keys by x-forwarded-for when userId is absent', async () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 1 });
    const next = createMockNext();

    const c = createMockContext({ forwardedFor: '10.0.0.1' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    expect(next).toHaveBeenCalledOnce();

    // Second request from same IP exceeds max=1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await middleware(c as any, next);
    expect(c.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' }, 429);
    expect(result).toBe('json-response');
  });

  it('falls back to "anonymous" key when no userId or forwarded-for', async () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 1 });
    const next = createMockNext();

    const c = createMockContext(); // no userId, no forwardedFor

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    expect(next).toHaveBeenCalledOnce();

    // Second anonymous request hits the limit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    expect(c.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' }, 429);
  });

  it('returns 429 with Retry-After header after max requests', async () => {
    const middleware = rateLimit({ windowMs: 30_000, max: 3 });
    const next = createMockNext();
    const c = createMockContext({ userId: 'user-x' });

    // Exhaust the limit: 3 allowed requests
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await middleware(c as any, next);
    }
    expect(next).toHaveBeenCalledTimes(3);

    // 4th request should be rate-limited
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);

    expect(c.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' }, 429);
    expect(c.res.headers.set).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^\d+$/),
    );
    // next should NOT be called a 4th time
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('Retry-After value reflects remaining window time', async () => {
    const middleware = rateLimit({ windowMs: 20_000, max: 1 });
    const next = createMockNext();
    const c = createMockContext({ userId: 'user-y' });

    // First request — allowed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);

    // Advance 5s into the 20s window
    vi.advanceTimersByTime(5_000);

    // Second request — blocked; ~15s remaining
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);

    // Find the Retry-After header call among all headers.set calls
    const calls = (c.res.headers.set as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const retryAfterCall = calls.find((call) => call[0] === 'Retry-After');
    expect(retryAfterCall).toBeDefined();
    const retryAfterValue = Number(retryAfterCall![1]);
    // Should be ceil((20000 - 5000) / 1000) = 15
    expect(retryAfterValue).toBe(15);
  });

  it('resets count after window expires', async () => {
    const middleware = rateLimit({ windowMs: 10_000, max: 1 });
    const next = createMockNext();
    const c = createMockContext({ userId: 'user-z' });

    // First request — allowed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Second request within window — blocked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    expect(c.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' }, 429);

    // Advance past the window
    vi.advanceTimersByTime(11_000);

    // New window — should be allowed again
    const freshC = createMockContext({ userId: 'user-z' });
    const freshNext = createMockNext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(freshC as any, freshNext);
    expect(freshNext).toHaveBeenCalledOnce();
    expect(freshC.json).not.toHaveBeenCalled();
  });

  it('uses default options when none provided', async () => {
    // Default: windowMs=60_000, max=100
    const middleware = rateLimit();
    const next = createMockNext();
    const c = createMockContext({ userId: 'default-test' });

    // Should allow at least one request with defaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('isolates rate limit state between different keys', async () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 1 });
    const next = createMockNext();

    const cAlice = createMockContext({ userId: 'alice' });
    const cBob = createMockContext({ userId: 'bob' });

    // Alice uses her one request
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(cAlice as any, next);

    // Alice is now rate-limited
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(cAlice as any, next);
    expect(cAlice.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' }, 429);

    // Bob should still be allowed (separate key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(cBob as any, next);
    expect(cBob.json).not.toHaveBeenCalled();
  });

  it('continues to block after max is exceeded within window', async () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 2 });
    const next = createMockNext();
    const c = createMockContext({ userId: 'persistent' });

    // 2 allowed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);

    // 3rd and 4th should both be blocked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(c as any, next);

    expect(c.json).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

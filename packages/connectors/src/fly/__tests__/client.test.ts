import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FlyMachinesClient } from '../client.js';

type FetchArgs = [string | URL | Request, RequestInit | undefined];

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: FetchArgs[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push([input, init]);
    return handler(url, init ?? {});
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

describe('FlyMachinesClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires a token', () => {
    expect(() => new FlyMachinesClient('')).toThrow(/FLY_API_TOKEN/);
  });

  it('createApp POSTs the correct body and parses response via Zod', async () => {
    const { fn } = mockFetch(async () => {
      return new Response(
        JSON.stringify({
          id: 'app_abc',
          name: 'pilot-mvp',
          organization: { slug: 'personal' },
          status: 'pending',
        }),
        { status: 201 },
      );
    });
    const client = new FlyMachinesClient('tok_xyz');
    const app = await client.createApp({ name: 'pilot-mvp', orgSlug: 'personal' });
    expect(app.name).toBe('pilot-mvp');
    const first = (fn.mock.calls as unknown as FetchArgs[])[0]!;
    const [url, init] = first;
    expect(String(url)).toBe('https://api.machines.dev/v1/apps');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      app_name: 'pilot-mvp',
      org_slug: 'personal',
    });
  });

  it('throws FlyApiError on non-2xx with status + body', async () => {
    mockFetch(async () => new Response('auth denied', { status: 401 }));
    const client = new FlyMachinesClient('tok_xyz');
    await expect(client.getApp('missing')).rejects.toMatchObject({
      name: 'FlyApiError',
      status: 401,
    });
  });

  it('createMachine serializes config correctly', async () => {
    const { fn } = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: 'mach_17811915f65986',
            state: 'created',
            region: 'fra',
          }),
          { status: 201 },
        ),
    );
    const client = new FlyMachinesClient('tok_xyz');
    await client.createMachine({
      appName: 'pilot-mvp',
      region: 'fra',
      image: 'registry.fly.io/pilot-mvp:deployment-abc',
      env: { NODE_ENV: 'production' },
      leaseTtlSeconds: 30,
    });
    const first = (fn.mock.calls as unknown as FetchArgs[])[0]!;
    const init = first[1];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.region).toBe('fra');
    expect(body.config.image).toBe('registry.fly.io/pilot-mvp:deployment-abc');
    expect(body.config.env).toEqual({ NODE_ENV: 'production' });
    expect(body.lease_ttl).toBe(30);
  });

  it('waitForMachineState polls until target state', async () => {
    const states = ['starting', 'starting', 'started'];
    let i = 0;
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: 'mach_1',
            state: states[i++] ?? 'started',
            region: 'fra',
          }),
          { status: 200 },
        ),
    );
    const client = new FlyMachinesClient('tok_xyz');
    const result = await client.waitForMachineState('pilot-mvp', 'mach_1', 'started', 10_000);
    expect(result.state).toBe('started');
  });

  it('waitForMachineState throws on terminal failure', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ id: 'mach_1', state: 'failed', region: 'fra' }),
          { status: 200 },
        ),
    );
    const client = new FlyMachinesClient('tok_xyz');
    await expect(
      client.waitForMachineState('pilot-mvp', 'mach_1', 'started', 5_000),
    ).rejects.toThrow(/terminal state failed/);
  });

  it('sends Authorization: Bearer token on every request', async () => {
    const { fn } = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: 'app_1',
            name: 'x',
            organization: { slug: 'personal' },
            status: 'pending',
          }),
          { status: 200 },
        ),
    );
    const client = new FlyMachinesClient('tok_abc');
    await client.getApp('x');
    const first = (fn.mock.calls as unknown as FetchArgs[])[0]!;
    const init = first[1];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer tok_abc');
  });
});

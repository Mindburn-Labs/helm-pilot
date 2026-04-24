import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeConnector, StripeError } from '../stripe.js';
import { CalendarConnector, CalendarError } from '../calendar.js';
import { HubSpotConnector, HubSpotError } from '../hubspot.js';

// ─── Stripe + Calendar + HubSpot tests (v1.2.1 remediation) ───

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('StripeConnector', () => {
  it('rejects empty secret key at construction', () => {
    expect(() => new StripeConnector('')).toThrow(StripeError);
  });

  it('listCustomers converts epoch → ISO', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        data: [
          { id: 'cus_1', email: 'a@b.co', name: 'Alice', created: 1713000000 },
        ],
      }),
    );
    const out = await new StripeConnector('sk_test_FAKE').listCustomers({ limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('cus_1');
    expect(out[0]?.email).toBe('a@b.co');
    expect(out[0]?.createdAt).toMatch(/^2024-04-13T/);
  });

  it('recentCharges preserves minor-unit amounts', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        data: [
          {
            id: 'ch_1',
            amount: 2599,
            currency: 'usd',
            status: 'succeeded',
            description: 'test',
            created: 1713000000,
          },
        ],
      }),
    );
    const charges = await new StripeConnector('sk_test_FAKE').recentCharges();
    expect(charges[0]?.amount).toBe(2599);
    expect(charges[0]?.currency).toBe('usd');
  });

  it('HTTP 5xx maps to StripeError', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(new StripeConnector('sk_test_FAKE').balance()).rejects.toThrow(
      StripeError,
    );
  });
});

describe('CalendarConnector', () => {
  it('rejects empty token', () => {
    expect(() => new CalendarConnector('')).toThrow(CalendarError);
  });

  it('listEvents defaults window and parses event shape', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        items: [
          {
            id: 'ev-1',
            summary: 'Test event',
            start: { dateTime: '2026-05-01T10:00:00.000Z' },
            end: { dateTime: '2026-05-01T11:00:00.000Z' },
            htmlLink: 'https://cal/ev-1',
            attendees: [{ email: 'a@b.co' }, { email: 'c@d.co' }],
          },
        ],
      }),
    );
    const events = await new CalendarConnector('gcal-test-token').listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe('Test event');
    expect(events[0]?.attendees).toEqual(['a@b.co', 'c@d.co']);
    // URL should embed timeMin + timeMax query string
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('timeMin=');
    expect(url).toContain('timeMax=');
    expect(url).toContain('orderBy=startTime');
  });

  it('createEvent body shape includes dateTime + attendees', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        id: 'ev-new',
        summary: 'New',
        start: { dateTime: '2026-05-02T10:00:00Z' },
        end: { dateTime: '2026-05-02T11:00:00Z' },
        attendees: [{ email: 'a@b.co' }],
      }),
    );
    await new CalendarConnector('gcal-test-token').createEvent({
      summary: 'New',
      startIso: '2026-05-02T10:00:00Z',
      endIso: '2026-05-02T11:00:00Z',
      attendees: ['a@b.co'],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      start: { dateTime: string; timeZone: string };
      attendees: Array<{ email: string }>;
    };
    expect(body.start.dateTime).toBe('2026-05-02T10:00:00Z');
    expect(body.start.timeZone).toBe('UTC');
    expect(body.attendees).toEqual([{ email: 'a@b.co' }]);
  });

  it('HTTP 401 maps to CalendarError', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(
      new CalendarConnector('gcal-test-token').listEvents(),
    ).rejects.toMatchObject({ name: 'CalendarError', status: 401 });
  });
});

describe('HubSpotConnector', () => {
  it('rejects empty token', () => {
    expect(() => new HubSpotConnector('')).toThrow(HubSpotError);
  });

  it('listContacts extracts props from nested shape', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        results: [
          {
            id: 'c-1',
            properties: {
              email: 'founder@example.test',
              firstname: 'Founder',
              lastname: 'One',
              company: 'Acme',
            },
            createdAt: '2026-04-20T10:00:00.000Z',
            updatedAt: '2026-04-24T10:00:00.000Z',
          },
        ],
      }),
    );
    const out = await new HubSpotConnector('pat_test_FAKE').listContacts();
    expect(out).toEqual([
      {
        id: 'c-1',
        email: 'founder@example.test',
        firstName: 'Founder',
        lastName: 'One',
        company: 'Acme',
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-24T10:00:00.000Z',
      },
    ]);
  });

  it('createContact POST body wraps properties', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({ id: 'c-2', properties: { email: 'b@c.co' } }),
    );
    await new HubSpotConnector('pat_test_FAKE').createContact({
      email: 'b@c.co',
      firstName: 'Bob',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      properties: Record<string, string>;
    };
    expect(body.properties['email']).toBe('b@c.co');
    expect(body.properties['firstname']).toBe('Bob');
  });

  it('listDeals parses deal properties', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      ok({
        results: [
          {
            id: 'd-1',
            properties: {
              dealname: 'Big deal',
              amount: '50000',
              dealstage: 'closedwon',
              closedate: '2026-05-01',
            },
            createdAt: '2026-04-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const deals = await new HubSpotConnector('pat_test_FAKE').listDeals();
    expect(deals[0]).toEqual({
      id: 'd-1',
      name: 'Big deal',
      amount: '50000',
      stage: 'closedwon',
      closeDate: '2026-05-01',
      createdAt: '2026-04-01T00:00:00.000Z',
    });
  });
});

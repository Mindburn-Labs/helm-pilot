// ─── Google Calendar Connector (Phase 15 Track I) ───
//
// Bearer OAuth token (same envelope as gdrive/gmail). Scope:
// `https://www.googleapis.com/auth/calendar.events`. Read + write
// events on a single calendar (default `primary`).

const GCAL_API = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
  attendees: string[];
}

export interface CalendarCreateInput {
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  timeZone?: string;
  attendees?: string[];
  /** Defaults to `'primary'`. */
  calendarId?: string;
}

export class CalendarError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'CalendarError';
  }
}

export class CalendarConnector {
  constructor(private readonly token: string) {
    if (!token) throw new CalendarError('Calendar OAuth token is required');
  }

  /**
   * List events between two times (defaults to "now → +30 days").
   * Returns events in ascending start order.
   */
  async listEvents(opts?: {
    calendarId?: string;
    timeMinIso?: string;
    timeMaxIso?: string;
    limit?: number;
  }): Promise<CalendarEvent[]> {
    const calendarId = opts?.calendarId ?? 'primary';
    const now = new Date();
    const timeMin = opts?.timeMinIso ?? now.toISOString();
    const timeMax =
      opts?.timeMaxIso ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const limit = Math.max(1, Math.min(250, opts?.limit ?? 50));
    const qs = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: String(limit),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const json = await this.call(`calendars/${encodeURIComponent(calendarId)}/events?${qs}`);
    const items = Array.isArray(json['items'])
      ? (json['items'] as Record<string, unknown>[])
      : [];
    return items.map(parseEvent);
  }

  async createEvent(input: CalendarCreateInput): Promise<CalendarEvent> {
    const calendarId = input.calendarId ?? 'primary';
    const tz = input.timeZone ?? 'UTC';
    const body = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso, timeZone: tz },
      end: { dateTime: input.endIso, timeZone: tz },
      attendees: (input.attendees ?? []).map((email) => ({ email })),
    };
    const json = await this.call(
      `calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body },
    );
    return parseEvent(json);
  }

  private async call(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${GCAL_API}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) {
      throw new CalendarError(`Calendar HTTP ${response.status}`, response.status);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

function parseEvent(raw: Record<string, unknown>): CalendarEvent {
  const start = raw['start'] as Record<string, unknown> | undefined;
  const end = raw['end'] as Record<string, unknown> | undefined;
  const attendeesRaw = Array.isArray(raw['attendees'])
    ? (raw['attendees'] as Record<string, unknown>[])
    : [];
  return {
    id: String(raw['id'] ?? ''),
    summary: String(raw['summary'] ?? '(no title)'),
    start: String(start?.['dateTime'] ?? start?.['date'] ?? ''),
    end: String(end?.['dateTime'] ?? end?.['date'] ?? ''),
    htmlLink: raw['htmlLink'] != null ? String(raw['htmlLink']) : undefined,
    attendees: attendeesRaw
      .map((a) => (typeof a['email'] === 'string' ? (a['email'] as string) : null))
      .filter((e): e is string => e !== null),
  };
}

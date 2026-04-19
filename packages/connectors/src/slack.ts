// ─── Slack Connector (Phase 15 Track I) ───
//
// Thin REST wrapper over Slack Web API. Bearer-token auth (Bot User
// OAuth Token, scopes `chat:write,channels:read,groups:read,search:read`).
// Returns minimal typed shapes — Slack responses are huge and mostly
// uninteresting to a founder.

const SLACK_API = 'https://slack.com/api';

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface SlackPostResult {
  channel: string;
  ts: string;
}

export interface SlackSearchMatch {
  ts: string;
  channel: { id: string; name?: string };
  user?: string;
  text: string;
  permalink?: string;
}

export class SlackError extends Error {
  constructor(message: string, readonly slackError?: string) {
    super(message);
    this.name = 'SlackError';
  }
}

export class SlackConnector {
  constructor(private readonly token: string) {
    if (!token) throw new SlackError('Slack bot token is required');
  }

  /**
   * Post a plain-text message into a channel. `channel` may be a Slack
   * channel id (`C0123…`) or a literal channel name with `#` prefix.
   */
  async postMessage(
    channel: string,
    text: string,
    opts?: { threadTs?: string },
  ): Promise<SlackPostResult> {
    const body: Record<string, unknown> = { channel, text };
    if (opts?.threadTs) body['thread_ts'] = opts.threadTs;
    const r = await this.call('chat.postMessage', { method: 'POST', body });
    return {
      channel: String(r['channel']),
      ts: String(r['ts']),
    };
  }

  /** List channels visible to the bot (public + private it's been invited to). */
  async listChannels(opts?: { limit?: number }): Promise<SlackChannel[]> {
    const limit = Math.max(1, Math.min(1000, opts?.limit ?? 200));
    const r = await this.call(
      `conversations.list?types=public_channel,private_channel&limit=${limit}`,
      { method: 'GET' },
    );
    const channels = Array.isArray(r['channels'])
      ? (r['channels'] as Record<string, unknown>[])
      : [];
    return channels.map((c) => ({
      id: String(c['id']),
      name: String(c['name']),
      isPrivate: Boolean(c['is_private']),
    }));
  }

  /** Full-text search across messages the token can see. */
  async search(query: string, opts?: { limit?: number }): Promise<SlackSearchMatch[]> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 20));
    const r = await this.call(
      `search.messages?query=${encodeURIComponent(query)}&count=${limit}`,
      { method: 'GET' },
    );
    const wrapper =
      typeof r['messages'] === 'object' && r['messages'] !== null
        ? (r['messages'] as Record<string, unknown>)
        : {};
    const matches = Array.isArray(wrapper['matches'])
      ? (wrapper['matches'] as Record<string, unknown>[])
      : [];
    return matches.map((m) => {
      const ch = (m['channel'] ?? {}) as Record<string, unknown>;
      return {
        ts: String(m['ts'] ?? ''),
        channel: {
          id: String(ch['id'] ?? ''),
          name: ch['name'] != null ? String(ch['name']) : undefined,
        },
        user: m['user'] != null ? String(m['user']) : undefined,
        text: String(m['text'] ?? ''),
        permalink: m['permalink'] != null ? String(m['permalink']) : undefined,
      };
    });
  }

  private async call(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
    const response = await fetch(`${SLACK_API}/${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) {
      throw new SlackError(`Slack HTTP ${response.status}`);
    }
    const json = (await response.json()) as Record<string, unknown>;
    if (json['ok'] !== true) {
      throw new SlackError(
        `Slack API error: ${json['error'] ?? 'unknown'}`,
        typeof json['error'] === 'string' ? json['error'] : undefined,
      );
    }
    return json;
  }
}

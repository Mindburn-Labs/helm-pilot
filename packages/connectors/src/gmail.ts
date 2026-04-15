import { createLogger } from '@helm-pilot/shared/logger';

const log = createLogger('gmail-connector');

/**
 * Gmail Connector — read and send emails via the Gmail REST API.
 *
 * Uses raw fetch (no googleapis dependency). Requires an OAuth2 access token
 * with the appropriate Gmail scopes.
 */
export class GmailConnector {
  private readonly baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me';

  constructor(private readonly token: string) {}

  /**
   * Send an email via Gmail API.
   */
  async sendEmail(params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    isHtml?: boolean;
  }): Promise<{ id: string; threadId: string }> {
    const contentType = params.isHtml ? 'text/html' : 'text/plain';
    const headers = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      `Content-Type: ${contentType}; charset=utf-8`,
      'MIME-Version: 1.0',
    ];
    if (params.cc) headers.push(`Cc: ${params.cc}`);
    if (params.bcc) headers.push(`Bcc: ${params.bcc}`);
    if (params.replyTo) headers.push(`Reply-To: ${params.replyTo}`);

    const rawMessage = `${headers.join('\r\n')}\r\n\r\n${params.body}`;
    const encoded = Buffer.from(rawMessage).toString('base64url');

    const response = await this.request('POST', '/messages/send', { raw: encoded });
    log.info({ to: params.to, subject: params.subject }, 'Email sent');
    return { id: response.id as string, threadId: response.threadId as string };
  }

  /**
   * List messages matching a query.
   *
   * @param query Gmail search query (e.g., "is:unread", "from:alice@example.com")
   * @param maxResults Maximum number of messages to return (default: 20)
   */
  async listMessages(query?: string, maxResults = 20): Promise<GmailMessageSummary[]> {
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (query) params.set('q', query);

    const response = await this.request('GET', `/messages?${params.toString()}`);
    const messageIds = (response.messages as Array<{ id: string; threadId: string }>) ?? [];

    // Fetch headers for each message (batch would be better but keeps it simple)
    const messages: GmailMessageSummary[] = [];
    for (const msg of messageIds.slice(0, maxResults)) {
      try {
        const detail = await this.getMessage(msg.id);
        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          from: detail.from,
          to: detail.to,
          subject: detail.subject,
          date: detail.date,
          snippet: detail.snippet,
          isUnread: detail.labels.includes('UNREAD'),
        });
      } catch {
        // Skip messages we can't fetch
      }
    }

    return messages;
  }

  /**
   * Get a single message by ID with parsed headers and body.
   */
  async getMessage(id: string): Promise<GmailMessage> {
    const response = await this.request('GET', `/messages/${id}?format=full`);
    const headers = (response.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> ?? [];

    const getHeader = (name: string): string =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    // Extract body (prefer text/plain, fallback to text/html)
    const body = this.extractBody(response.payload as GmailPayload);

    return {
      id: response.id as string,
      threadId: response.threadId as string,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      snippet: response.snippet as string ?? '',
      body,
      labels: (response.labelIds as string[]) ?? [],
    };
  }

  /**
   * List Gmail labels.
   */
  async listLabels(): Promise<GmailLabel[]> {
    const response = await this.request('GET', '/labels');
    return ((response.labels as Array<Record<string, unknown>>) ?? []).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      type: l.type as string,
      messagesTotal: (l.messagesTotal as number) ?? 0,
      messagesUnread: (l.messagesUnread as number) ?? 0,
    }));
  }

  /**
   * Mark a message as read.
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.request('POST', `/messages/${messageId}/modify`, {
      removeLabelIds: ['UNREAD'],
    });
  }

  /**
   * Archive a message (remove INBOX label).
   */
  async archive(messageId: string): Promise<void> {
    await this.request('POST', `/messages/${messageId}/modify`, {
      removeLabelIds: ['INBOX'],
    });
  }

  // ─── Internal ───

  private extractBody(payload: GmailPayload): string {
    // Direct body
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }

    // Multipart — find text/plain first, then text/html
    if (payload.parts) {
      const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, 'base64url').toString('utf8');
      }
      const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        return Buffer.from(htmlPart.body.data, 'base64url').toString('utf8');
      }
      // Recurse into nested parts
      for (const part of payload.parts) {
        if (part.parts) {
          const nested = this.extractBody(part);
          if (nested) return nested;
        }
      }
    }

    return '';
  }

  private async request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Gmail API ${method} ${path} failed: ${response.status} ${errorBody}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}

// ─── Types ───

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  isUnread: boolean;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  labels: string[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal: number;
  messagesUnread: number;
}

interface GmailPayload {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

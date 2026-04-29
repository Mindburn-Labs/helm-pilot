import { createHmac, timingSafeEqual } from 'node:crypto';

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

export interface SlackSignatureInput {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}

export interface SlackSlashCommandPayload {
  teamId?: string;
  teamDomain?: string;
  channelId: string;
  channelName?: string;
  userId: string;
  userName?: string;
  command: string;
  text: string;
  responseUrl?: string;
  triggerId?: string;
}

export interface SlackWorkspaceAgentRequest {
  workspaceId: string;
  source: 'slash_command';
  teamId?: string;
  teamDomain?: string;
  channelId: string;
  channelName?: string;
  userId: string;
  userName?: string;
  command: string;
  text: string;
  responseUrl?: string;
  triggerId?: string;
}

export interface SlackWorkspaceAgentApproval {
  approvalId: string;
  action: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  receiptId?: string;
}

export interface SlackWorkspaceAgentRunSummary {
  title: string;
  status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'blocked';
  steps: readonly string[];
  approvals: readonly SlackWorkspaceAgentApproval[];
  evidencePackId?: string;
  receiptUrl?: string;
}

export class SlackError extends Error {
  constructor(
    message: string,
    readonly slackError?: string,
  ) {
    super(message);
    this.name = 'SlackError';
  }
}

export function verifySlackRequestSignature(input: SlackSignatureInput): boolean {
  if (!input.signingSecret || !input.timestamp || !input.rawBody || !input.signature) {
    return false;
  }

  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = input.toleranceSeconds ?? 60 * 5;
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;

  const base = `v0:${input.timestamp}:${input.rawBody}`;
  const expected = `v0=${createHmac('sha256', input.signingSecret).update(base).digest('hex')}`;
  return timingSafeStringEqual(expected, input.signature);
}

export function parseSlackFormBody(body: string | URLSearchParams): Record<string, string> {
  const params = typeof body === 'string' ? new URLSearchParams(body) : body;
  return Object.fromEntries(params.entries());
}

export function parseSlackSlashCommand(
  body: string | URLSearchParams | Record<string, string | undefined>,
): SlackSlashCommandPayload {
  const payload =
    typeof body === 'string' || body instanceof URLSearchParams ? parseSlackFormBody(body) : body;
  const channelId = requiredSlackField(payload, 'channel_id');
  const userId = requiredSlackField(payload, 'user_id');
  const command = requiredSlackField(payload, 'command');

  return {
    teamId: optionalSlackField(payload, 'team_id'),
    teamDomain: optionalSlackField(payload, 'team_domain'),
    channelId,
    channelName: optionalSlackField(payload, 'channel_name'),
    userId,
    userName: optionalSlackField(payload, 'user_name'),
    command,
    text: optionalSlackField(payload, 'text') ?? '',
    responseUrl: optionalSlackField(payload, 'response_url'),
    triggerId: optionalSlackField(payload, 'trigger_id'),
  };
}

export function slackWorkspaceAgentRequestFromSlashCommand(
  workspaceId: string,
  body: string | URLSearchParams | Record<string, string | undefined>,
): SlackWorkspaceAgentRequest {
  if (!workspaceId) throw new SlackError('workspaceId is required');
  const parsed = parseSlackSlashCommand(body);

  return {
    workspaceId,
    source: 'slash_command',
    ...parsed,
  };
}

export function formatSlackWorkspaceAgentRunSummary(
  summary: SlackWorkspaceAgentRunSummary,
): string {
  const stepLines =
    summary.steps.length > 0
      ? summary.steps.map((step, index) => `${index + 1}. ${step}`)
      : ['No steps reported.'];
  const approvalLines =
    summary.approvals.length > 0
      ? summary.approvals.map(formatApprovalLine)
      : ['No approvals required.'];
  const evidenceLines = [
    summary.evidencePackId ? `Evidence pack: ${summary.evidencePackId}` : undefined,
    summary.receiptUrl ? `Receipt trail: ${summary.receiptUrl}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return [
    `*${summary.title}*`,
    `Status: ${summary.status}`,
    '',
    '*Steps*',
    ...stepLines,
    '',
    '*HELM approvals and receipts*',
    ...approvalLines,
    ...(evidenceLines.length > 0 ? ['', ...evidenceLines] : []),
  ].join('\n');
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requiredSlackField(payload: Record<string, string | undefined>, field: string): string {
  const value = optionalSlackField(payload, field);
  if (!value) throw new SlackError(`Missing Slack field: ${field}`);
  return value;
}

function optionalSlackField(
  payload: Record<string, string | undefined>,
  field: string,
): string | undefined {
  const value = payload[field];
  return value && value.trim().length > 0 ? value : undefined;
}

function formatApprovalLine(approval: SlackWorkspaceAgentApproval): string {
  const receiptSuffix = approval.receiptId ? ` receipt=${approval.receiptId}` : '';
  const reasonSuffix = approval.reason ? ` reason=${approval.reason}` : '';
  return `- ${approval.status}: ${approval.action} approval=${approval.approvalId}${receiptSuffix}${reasonSuffix}`;
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
    const r = await this.call(`search.messages?query=${encodeURIComponent(query)}&count=${limit}`, {
      method: 'GET',
    });
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

  async postWorkspaceAgentRunSummary(
    channel: string,
    summary: SlackWorkspaceAgentRunSummary,
    opts?: { threadTs?: string },
  ): Promise<SlackPostResult> {
    return this.postMessage(channel, formatSlackWorkspaceAgentRunSummary(summary), opts);
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

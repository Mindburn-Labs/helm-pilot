import { createHmac, timingSafeEqual } from 'node:crypto';
import { SlackConnector, SlackError, type SlackPostResult } from '@pilot/connectors';

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

export interface SlackWorkspaceAgentDispatch {
  taskId: string;
  status: 'queued' | 'awaiting_approval';
  message: string;
  approvalId?: string;
}

export interface SlackWorkspaceAgentHeaders {
  signature?: string;
  timestamp?: string;
}

export interface SlackWorkspaceAgentAdapterConfig {
  workspaceId: string;
  signingSecret: string;
  slack: SlackConnector;
  enqueueRequest: (request: SlackWorkspaceAgentRequest) => Promise<SlackWorkspaceAgentDispatch>;
  nowSeconds?: () => number;
}

export class SlackWorkspaceAgentAdapter {
  constructor(private readonly config: SlackWorkspaceAgentAdapterConfig) {
    if (!config.workspaceId) throw new SlackError('workspaceId is required');
    if (!config.signingSecret) throw new SlackError('Slack signing secret is required');
  }

  parseAndVerifySlashCommand(
    rawBody: string,
    headers: SlackWorkspaceAgentHeaders,
  ): SlackWorkspaceAgentRequest {
    const verified = verifySlackRequestSignature({
      signingSecret: this.config.signingSecret,
      rawBody,
      signature: headers.signature ?? '',
      timestamp: headers.timestamp ?? '',
      nowSeconds: this.config.nowSeconds?.(),
    });
    if (!verified) throw new SlackError('Slack request signature verification failed');

    return workspaceAgentRequestFromSlashCommand(this.config.workspaceId, rawBody);
  }

  async handleSlashCommand(
    rawBody: string,
    headers: SlackWorkspaceAgentHeaders,
  ): Promise<SlackWorkspaceAgentDispatch> {
    const request = this.parseAndVerifySlashCommand(rawBody, headers);
    return this.config.enqueueRequest(request);
  }

  async postRunSummary(
    channel: string,
    summary: SlackWorkspaceAgentRunSummary,
    opts?: { threadTs?: string },
  ): Promise<SlackPostResult> {
    return this.config.slack.postMessage(channel, formatRunSummary(summary), opts);
  }
}

function verifySlackRequestSignature(input: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = input.toleranceSeconds ?? 60 * 5;
  if (!input.signingSecret || !input.timestamp || !input.rawBody || !input.signature) return false;
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;

  const expected = `v0=${createHmac('sha256', input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function workspaceAgentRequestFromSlashCommand(
  workspaceId: string,
  rawBody: string,
): SlackWorkspaceAgentRequest {
  const params = new URLSearchParams(rawBody);
  const field = (name: string): string | undefined => {
    const value = params.get(name);
    return value && value.trim().length > 0 ? value : undefined;
  };
  const required = (name: string): string => {
    const value = field(name);
    if (!value) throw new SlackError(`Missing Slack field: ${name}`);
    return value;
  };

  return {
    workspaceId,
    source: 'slash_command',
    teamId: field('team_id'),
    teamDomain: field('team_domain'),
    channelId: required('channel_id'),
    channelName: field('channel_name'),
    userId: required('user_id'),
    userName: field('user_name'),
    command: required('command'),
    text: field('text') ?? '',
    responseUrl: field('response_url'),
    triggerId: field('trigger_id'),
  };
}

function formatRunSummary(summary: SlackWorkspaceAgentRunSummary): string {
  const stepLines =
    summary.steps.length > 0
      ? summary.steps.map((step, index) => `${index + 1}. ${step}`)
      : ['No steps reported.'];
  const approvalLines =
    summary.approvals.length > 0
      ? summary.approvals.map((approval) => {
          const receipt = approval.receiptId ? ` receipt=${approval.receiptId}` : '';
          const reason = approval.reason ? ` reason=${approval.reason}` : '';
          return `- ${approval.status}: ${approval.action} approval=${approval.approvalId}${receipt}${reason}`;
        })
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

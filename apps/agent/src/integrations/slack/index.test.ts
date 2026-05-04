import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SlackConnector } from '@pilot/connectors';
import { SlackWorkspaceAgentAdapter } from './index.js';

function signedHeaders(secret: string, timestamp: string, rawBody: string) {
  const signature = `v0=${createHmac('sha256', secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
  return { signature, timestamp };
}

describe('SlackWorkspaceAgentAdapter', () => {
  it('verifies slash commands and normalizes them into workspace-agent requests', async () => {
    const enqueueRequest = vi.fn(async () => ({
      taskId: 'task-1',
      status: 'queued' as const,
      message: 'Queued for HELM-governed execution',
    }));
    const rawBody =
      'team_id=T1&team_domain=mindburn&channel_id=C1&channel_name=founder-os&user_id=U1&user_name=ivan&command=%2Fpilot&text=prepare%20launch%20brief&response_url=https%3A%2F%2Fslack.test%2Fresponse&trigger_id=trig-1';
    const adapter = new SlackWorkspaceAgentAdapter({
      workspaceId: 'ws-1',
      signingSecret: 'secret',
      slack: new SlackConnector('xoxb-test'),
      enqueueRequest,
      nowSeconds: () => 1_000,
    });

    const result = await adapter.handleSlashCommand(
      rawBody,
      signedHeaders('secret', '1000', rawBody),
    );

    expect(result).toEqual({
      taskId: 'task-1',
      status: 'queued',
      message: 'Queued for HELM-governed execution',
    });
    expect(enqueueRequest).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      source: 'slash_command',
      teamId: 'T1',
      teamDomain: 'mindburn',
      channelId: 'C1',
      channelName: 'founder-os',
      userId: 'U1',
      userName: 'ivan',
      command: '/pilot',
      text: 'prepare launch brief',
      responseUrl: 'https://slack.test/response',
      triggerId: 'trig-1',
    });
  });

  it('rejects commands with invalid signatures before enqueueing', async () => {
    const enqueueRequest = vi.fn();
    const adapter = new SlackWorkspaceAgentAdapter({
      workspaceId: 'ws-1',
      signingSecret: 'secret',
      slack: new SlackConnector('xoxb-test'),
      enqueueRequest,
      nowSeconds: () => 1_000,
    });

    expect(() =>
      adapter.parseAndVerifySlashCommand('channel_id=C1&user_id=U1&command=%2Fpilot', {
        signature: 'v0=bad',
        timestamp: '1000',
      }),
    ).toThrow('Slack request signature verification failed');
    expect(enqueueRequest).not.toHaveBeenCalled();
  });
});

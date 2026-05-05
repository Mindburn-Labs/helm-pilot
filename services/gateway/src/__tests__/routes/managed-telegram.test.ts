import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { launchRoutes } from '../../routes/launch.js';
import { managedTelegramWebhookRoutes } from '../../routes/telegram-managed.js';
import { createMockDeps, expectJson } from '../helpers.js';
import {
  ManagedTelegramBotService,
  TELEGRAM_MANAGED_ACTIONS,
  managedTelegramActionEffectLevel,
} from '../../services/managed-telegram-bots.js';

type ManagedTelegramActionEvaluator = {
  evaluateAction(input: {
    workspaceId: string;
    action: string;
    resource: string;
    context?: Record<string, unknown>;
  }): Promise<unknown>;
};

function appWithContext(routeFactory: typeof launchRoutes, deps = createMockDeps()) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    c.set('workspaceId', 'ws-1');
    c.set('workspaceRole', 'owner');
    await next();
  });
  app.route('/', routeFactory(deps));
  return {
    deps,
    fetch(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
      return app.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    },
  };
}

describe('managed Telegram launch routes', () => {
  it('returns launch bot state', async () => {
    const managedTelegram = {
      getState: vi.fn(async () => ({ bot: null, pendingRequest: null, leads: [], messages: [] })),
    };
    const { fetch } = appWithContext(launchRoutes, createMockDeps({ managedTelegram } as never));

    const res = await fetch('GET', '/telegram-bot');
    const body = await expectJson<{ bot: null }>(res, 200);

    expect(body.bot).toBeNull();
    expect(managedTelegram.getState).toHaveBeenCalledWith('ws-1');
  });

  it('creates provisioning request only for Telegram-linked users', async () => {
    const managedTelegram = {
      createProvisioningRequest: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000001',
        creationUrl: 'https://t.me/newbot/Manager/acme_launch_bot?name=Acme',
        suggestedUsername: 'acme_launch_bot',
        suggestedName: 'Acme Launch Support',
        managerBotUsername: 'Manager',
        expiresAt: new Date().toISOString(),
      })),
    };
    const deps = createMockDeps({ managedTelegram } as never);
    deps.db._setResult([{ id: 'user-1', telegramId: '999' }]);
    const { fetch } = appWithContext(launchRoutes, deps);

    const res = await fetch('POST', '/telegram-bot/provisioning-request', {});
    await expectJson(res, 201);

    expect(managedTelegram.createProvisioningRequest).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      creatorTelegramId: '999',
    });
  });

  it('updates managed bot settings through the service', async () => {
    const managedTelegram = {
      updateSettings: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000001',
        responseMode: 'approval_required',
      })),
    };
    const { fetch } = appWithContext(launchRoutes, createMockDeps({ managedTelegram } as never));

    const res = await fetch('PATCH', '/telegram-bot/settings', {
      responseMode: 'approval_required',
    });
    await expectJson(res, 200);

    expect(managedTelegram.updateSettings).toHaveBeenCalledWith('ws-1', 'user-1', {
      responseMode: 'approval_required',
    });
  });
});

describe('managed Telegram child webhook route', () => {
  it('rejects invalid webhook secrets before handling the update', async () => {
    const managedTelegram = {
      getBotForWebhook: vi.fn(async () => ({ id: 'bot-1', webhookSecretHash: 'hash' })),
      verifyWebhookSecret: vi.fn(() => false),
      handleChildWebhook: vi.fn(),
    };
    const app = new Hono();
    app.route('/', managedTelegramWebhookRoutes(createMockDeps({ managedTelegram } as never)));

    const res = await app.fetch(
      new Request('http://localhost/bot-1/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1 }),
      }),
    );

    await expectJson(res, 403);
    expect(managedTelegram.handleChildWebhook).not.toHaveBeenCalled();
  });

  it('accepts valid webhook secrets and dispatches the update', async () => {
    const managedTelegram = {
      getBotForWebhook: vi.fn(async () => ({ id: 'bot-1', webhookSecretHash: 'hash' })),
      verifyWebhookSecret: vi.fn(() => true),
      handleChildWebhook: vi.fn(async () => {}),
    };
    const app = new Hono();
    app.route('/', managedTelegramWebhookRoutes(createMockDeps({ managedTelegram } as never)));

    const res = await app.fetch(
      new Request('http://localhost/bot-1/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'secret',
        },
        body: JSON.stringify({ update_id: 1 }),
      }),
    );

    await expectJson(res, 200);
    expect(managedTelegram.handleChildWebhook).toHaveBeenCalledWith('bot-1', { update_id: 1 });
  });
});

describe('managed Telegram service governance', () => {
  it('classifies managed bot actions with explicit HELM effect levels', () => {
    expect(managedTelegramActionEffectLevel(TELEGRAM_MANAGED_ACTIONS.SEND_MESSAGE)).toBe('E2');
    expect(managedTelegramActionEffectLevel(TELEGRAM_MANAGED_ACTIONS.CLAIM)).toBe('E3');
    expect(managedTelegramActionEffectLevel(TELEGRAM_MANAGED_ACTIONS.SET_WEBHOOK)).toBe('E3');
    expect(managedTelegramActionEffectLevel(TELEGRAM_MANAGED_ACTIONS.ROTATE_TOKEN)).toBe('E3');
    expect(managedTelegramActionEffectLevel(TELEGRAM_MANAGED_ACTIONS.DISABLE)).toBe('E3');
  });

  it('fails closed for elevated managed bot actions without HELM', async () => {
    const deps = createMockDeps();
    const service = new ManagedTelegramBotService({ db: deps.db as never });

    await expect(
      (service as unknown as ManagedTelegramActionEvaluator).evaluateAction({
        workspaceId: 'ws-1',
        action: TELEGRAM_MANAGED_ACTIONS.SEND_MESSAGE,
        resource: 'telegram-managed-message:msg-1',
      }),
    ).rejects.toMatchObject({
      status: 503,
      message: 'HELM governance client is required for elevated Telegram managed bot actions',
    });
  });

  it('passes managed bot effect levels into HELM evaluation', async () => {
    const deps = createMockDeps();
    const helmClient = {
      evaluate: vi.fn(async () => ({
        receipt: { decisionId: 'dec-1', verdict: 'ALLOW', reason: 'allowed' },
      })),
    };
    const service = new ManagedTelegramBotService({
      db: deps.db as never,
      helmClient: helmClient as never,
    });

    await (service as unknown as ManagedTelegramActionEvaluator).evaluateAction({
      workspaceId: 'ws-1',
      action: TELEGRAM_MANAGED_ACTIONS.SET_WEBHOOK,
      resource: 'telegram:123',
      context: { managedBotId: 'bot-1' },
    });

    expect(helmClient.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: 'workspace:ws-1/operator:launch',
        action: TELEGRAM_MANAGED_ACTIONS.SET_WEBHOOK,
        resource: 'telegram:123',
        effectLevel: 'E3',
        context: expect.objectContaining({
          workspaceId: 'ws-1',
          managedBotId: 'bot-1',
        }),
      }),
    );
  });
});

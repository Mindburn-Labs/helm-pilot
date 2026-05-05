import { describe, expect, it, vi } from 'vitest';
import {
  auditLog,
  browserActions,
  browserObservations,
  browserSessionGrants,
  browserSessions,
  evidenceItems,
} from '@pilot/db/schema';
import { browserSessionRoutes } from '../../routes/browser-session.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const grantId = '00000000-0000-4000-8000-000000000004';
const evidencePackId = '00000000-0000-4000-8000-000000000005';
const wsHeader = { 'X-Workspace-Id': workspaceId };

function createBrowserDb(selectResults: unknown[][] = []) {
  const inserts: Array<{ table: unknown; value: unknown }> = [];
  const updates: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const chain = {
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(async () => selectResults.shift() ?? []),
          then: (resolve: (value: unknown[]) => void) => resolve(selectResults.shift() ?? []),
        };
        return chain;
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        inserts.push({ table, value });
        return {
          returning: vi.fn(async () => {
            if (table === browserSessions) {
              return [{ id: sessionId, workspaceId, status: 'active' }];
            }
            if (table === browserSessionGrants) {
              return [{ id: grantId, workspaceId, sessionId, scope: 'read_extract', status: 'active' }];
            }
            if (table === browserActions) {
              return [
                {
                  id: 'browser-action-1',
                  replayIndex: 0,
                  evidencePackId: (value as { evidencePackId?: string }).evidencePackId,
                },
              ];
            }
            if (table === browserObservations) {
              return [
                {
                  id: 'obs-1',
                  workspaceId,
                  sessionId,
                  grantId,
                  browserActionId: (value as { browserActionId?: string }).browserActionId,
                  domHash: (value as { domHash?: string }).domHash,
                  evidencePackId: (value as { evidencePackId?: string }).evidencePackId,
                },
              ];
            }
            if (table === evidenceItems) {
              return [{ id: 'evidence-item-1' }];
            }
            return [];
          }),
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((value: unknown) => {
        updates.push({ table, value });
        return {
          where: vi.fn(async () => []),
        };
      }),
    })),
    execute: vi.fn(async () => [{ '?column?': 1 }]),
    _setResult: vi.fn(),
    _reset: vi.fn(),
  };
  return { db, inserts, updates };
}

describe('browserSessionRoutes', () => {
  it('creates a browser session without storing credentials', async () => {
    const { db, inserts } = createBrowserDb();
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      '/',
      {
        workspaceId,
        name: 'Founder Chrome',
        browser: 'chrome',
        profileLabel: 'Default',
        allowedOrigins: ['https://www.ycombinator.com'],
        metadata: { note: 'active tab only', apiKey: 'do-not-store' },
      },
      wsHeader,
    );
    const body = await expectJson<{ session: { id: string } }>(res, 201);

    expect(body.session.id).toBe(sessionId);
    expect(inserts.find((insert) => insert.table === browserSessions)?.value).toMatchObject({
      workspaceId,
      name: 'Founder Chrome',
      allowedOrigins: ['https://www.ycombinator.com'],
      metadata: {
        note: 'active tab only',
        apiKey: '[REDACTED]',
        credentialBoundary: 'session_use_only_no_cookie_or_password_export',
      },
    });
    expect(JSON.stringify(inserts.map((insert) => insert.value))).not.toMatch(
      /super-secret|refreshToken|sessionData/iu,
    );
    expect(inserts.find((insert) => insert.table === auditLog)?.value).toMatchObject({
      action: 'BROWSER_SESSION_CREATED',
      verdict: 'allow',
    });
  });

  it('requires owner role before mutating browser sessions', async () => {
    const { db } = createBrowserDb();
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      '/',
      {
        workspaceId,
        name: 'Founder Chrome',
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      { ...wsHeader, 'X-Workspace-Role': 'member' },
    );
    const body = await expectJson<{ error: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
  });

  it('rejects a grant whose origin exceeds the session origin scope', async () => {
    const { db } = createBrowserDb([
      [{ id: sessionId, workspaceId, allowedOrigins: ['https://www.ycombinator.com'] }],
    ]);
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      `/${sessionId}/grants`,
      {
        workspaceId,
        allowedOrigins: ['https://example.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 403);

    expect(body.error).toContain('exceeds');
  });

  it('stores a HELM-approved redacted read-only browser observation', async () => {
    const { db, inserts } = createBrowserDb([
      [{ id: sessionId, workspaceId, allowedOrigins: ['https://www.ycombinator.com'] }],
      [
        {
          id: grantId,
          sessionId,
          workspaceId,
          allowedOrigins: ['https://www.ycombinator.com'],
          grantedToType: 'agent',
        },
      ],
    ]);
    const helmClient = {
      evaluateOperatorBrowserRead: vi.fn(async () => ({
        status: 'approved_for_read',
        evidencePackId,
        receipt: { decisionId: 'dec-browser', policyVersion: 'founder-ops-v1' },
      })),
    };
    const deps = createMockDeps({ db: db as never, helmClient: helmClient as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      '/observations',
      {
        workspaceId,
        sessionId,
        grantId,
        taskId,
        url: 'https://www.ycombinator.com/account',
        title: 'YC Account',
        domSnapshot: 'password=super-secret token=abc123',
        extractedData: {
          company: 'Pilot',
          cookie: 'do-not-store',
        },
        metadata: { authorization: 'Bearer abc123' },
      },
      wsHeader,
    );
    const body = await expectJson<{
      browserAction: { id: string; evidencePackId: string };
      observation: { id: string; domHash: string; evidencePackId: string };
      governance: { decisionId: string };
      evidenceItemId: string;
    }>(res, 201);

    expect(helmClient.evaluateOperatorBrowserRead).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: `workspace:${workspaceId}/browser:${sessionId}`,
        workspaceId,
        sessionId,
        grantId,
        url: 'https://www.ycombinator.com/account',
      }),
    );
    expect(body.observation.id).toBe('obs-1');
    expect(body.browserAction.id).toBe('browser-action-1');
    expect(body.evidenceItemId).toBe('evidence-item-1');
    expect(body.observation.domHash).toMatch(/^sha256:/u);
    expect(body.governance.decisionId).toBe('dec-browser');
    expect(inserts.find((insert) => insert.table === browserActions)?.value).toMatchObject({
      workspaceId,
      sessionId,
      grantId,
      taskId,
      actionType: 'read_extract',
      policyDecisionId: 'dec-browser',
      policyVersion: 'founder-ops-v1',
      evidencePackId,
    });
    expect(inserts.find((insert) => insert.table === browserObservations)?.value).toMatchObject({
      workspaceId,
      sessionId,
      grantId,
      browserActionId: 'browser-action-1',
      taskId,
      origin: 'https://www.ycombinator.com',
      redactedDomSnapshot: 'password=[REDACTED] token=[REDACTED]',
      extractedData: {
        company: 'Pilot',
        cookie: '[REDACTED]',
      },
      metadata: {
        authorization: '[REDACTED]',
        helmDecisionId: 'dec-browser',
        helmPolicyVersion: 'founder-ops-v1',
        credentialBoundary: 'read_only_no_cookie_or_password_export',
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId,
      taskId,
      evidencePackId,
      browserObservationId: 'obs-1',
      evidenceType: 'browser_observation',
      sourceType: 'gateway_browser_session',
      redactionState: 'redacted',
      contentHash: expect.stringMatching(/^sha256:/u),
      replayRef: `browser:${sessionId}:0`,
    });
    expect(inserts.find((insert) => insert.table === auditLog)?.value).toMatchObject({
      action: 'BROWSER_OBSERVATION_CAPTURED',
      verdict: 'allow',
    });
  });

  it('fails closed when storing an observation without HELM', async () => {
    const { db } = createBrowserDb();
    const deps = createMockDeps({ db: db as never, helmClient: undefined });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      '/observations',
      {
        workspaceId,
        sessionId,
        grantId,
        url: 'https://www.ycombinator.com/account',
        domSnapshot: '<main>YC account</main>',
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 503);

    expect(body.error).toContain('HELM client is required');
  });

  it('returns a workspace-scoped browser replay sequence without production promotion', async () => {
    const { db } = createBrowserDb([
      [
        {
          id: 'obs-1',
          workspaceId,
          sessionId,
          grantId,
          browserActionId: 'browser-action-1',
          taskId,
          actionId: 'tool-action-1',
          evidencePackId,
          replayIndex: 0,
          observedAt: new Date('2026-05-05T10:00:00Z'),
          url: 'https://www.ycombinator.com/account',
          origin: 'https://www.ycombinator.com',
          title: 'YC Account',
          objective: 'Read profile status',
          domHash: 'sha256:dom',
          screenshotHash: 'sha256:screenshot',
          screenshotRef: 'storage://screenshots/obs-1.png',
          redactedDomSnapshot: 'token=[REDACTED]',
          extractedData: { company: 'Pilot', cookie: '[REDACTED]' },
          redactions: ['token'],
          metadata: { token: 'do-not-return', note: 'safe' },
        },
      ],
    ]);
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch('GET', `/${sessionId}/replay`, undefined, wsHeader);
    const body = await expectJson<{
      replay: {
        kind: string;
        orderedBy: string[];
        capability: { key: string; state: string; productionReady: boolean };
        redactionContract: string;
        observations: Array<{
          id: string;
          replayIndex: number;
          redactedDomSnapshot: string;
          metadata: Record<string, unknown>;
        }>;
      };
    }>(res, 200);

    expect(body.replay.kind).toBe('browser_observation_sequence');
    expect(body.replay.orderedBy).toEqual(['replayIndex', 'observedAt', 'id']);
    expect(body.replay.capability).toEqual({
      key: 'browser_execution',
      state: 'prototype',
      productionReady: false,
    });
    expect(body.replay.redactionContract).toContain('no_cookie_password_or_token_export');
    expect(body.replay.observations[0]).toMatchObject({
      id: 'obs-1',
      replayIndex: 0,
      redactedDomSnapshot: 'token=[REDACTED]',
      metadata: { token: '[REDACTED]', note: 'safe' },
    });
    expect(JSON.stringify(body)).not.toContain('do-not-return');
  });
});

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
const foreignOperatorId = '00000000-0000-4000-8000-000000000006';
const foreignUserId = '00000000-0000-4000-8000-000000000007';
const wsHeader = { 'X-Workspace-Id': workspaceId };

function createBrowserAccessHelmClient(decisionId = 'dec-browser-access') {
  return {
    evaluate: vi.fn(async () => ({
      evidencePackId,
      receipt: {
        decisionId,
        policyVersion: 'founder-ops-v1',
      },
    })),
  };
}

function createBrowserDb(
  selectResults: unknown[][] = [],
  options: { failOnInsertTable?: unknown } = {},
) {
  const inserts: Array<{ table: unknown; value: unknown }> = [];
  const updates: Array<{ table: unknown; value: unknown }> = [];

  const createDbFacade = (
    insertSink: Array<{ table: unknown; value: unknown }>,
    updateSink: Array<{ table: unknown; value: unknown }>,
  ) => ({
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
        insertSink.push({ table, value });
        return {
          returning: vi.fn(async () => {
            if (options.failOnInsertTable === table) {
              throw new Error('forced insert failure');
            }
            if (table === browserSessions) {
              return [{ id: sessionId, workspaceId, status: 'active' }];
            }
            if (table === browserSessionGrants) {
              return [
                { id: grantId, workspaceId, sessionId, scope: 'read_extract', status: 'active' },
              ];
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
        updateSink.push({ table, value });
        return {
          where: vi.fn(async () => []),
        };
      }),
    })),
    execute: vi.fn(async () => [{ '?column?': 1 }]),
  });

  const db = {
    ...createDbFacade(inserts, updates),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const stagedInserts: Array<{ table: unknown; value: unknown }> = [];
      const stagedUpdates: Array<{ table: unknown; value: unknown }> = [];
      const tx = createDbFacade(stagedInserts, stagedUpdates);
      const result = await callback(tx);
      inserts.push(...stagedInserts);
      updates.push(...stagedUpdates);
      return result;
    }),
    _setResult: vi.fn(),
    _reset: vi.fn(),
  };
  return { db, inserts, updates };
}

describe('browserSessionRoutes', () => {
  it('creates a browser session without storing credentials', async () => {
    const { db, inserts, updates } = createBrowserDb();
    const helmClient = createBrowserAccessHelmClient('dec-browser-session-create');
    const deps = createMockDeps({ db: db as never, helmClient: helmClient as never });
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
    expect(helmClient.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: `workspace:${workspaceId}/operator:browser-session`,
        action: 'BROWSER_SESSION_CREATE',
        effectLevel: 'E3',
      }),
    );
    expect(inserts.find((insert) => insert.table === browserSessions)?.value).toMatchObject({
      workspaceId,
      name: 'Founder Chrome',
      allowedOrigins: ['https://www.ycombinator.com'],
      policyDecisionId: 'dec-browser-session-create',
      policyVersion: 'founder-ops-v1',
      helmDocumentVersionPins: {
        browserOperationPolicy: 'founder-ops-v1',
      },
      evidencePackId,
      metadata: {
        note: 'active tab only',
        apiKey: '[REDACTED]',
        credentialBoundary: 'session_use_only_no_cookie_or_password_export',
        governance: {
          policyDecisionId: 'dec-browser-session-create',
          policyVersion: 'founder-ops-v1',
          policyPin: {
            documentVersionPins: {
              browserOperationPolicy: 'founder-ops-v1',
            },
          },
        },
      },
    });
    expect(JSON.stringify(inserts.map((insert) => insert.value))).not.toMatch(
      /super-secret|refreshToken|sessionData/iu,
    );
    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    const auditInsertIndex = inserts.findIndex((insert) => insert.table === auditLog);
    const evidenceInsertIndex = inserts.findIndex((insert) => insert.table === evidenceItems);
    expect(auditInsertIndex).toBeLessThan(evidenceInsertIndex);
    expect(auditInsert).toMatchObject({
      action: 'BROWSER_SESSION_CREATED',
      verdict: 'allow',
      metadata: {
        evidenceType: 'browser_session_created',
        replayRef: `browser-session:${sessionId}:created`,
        governance: {
          policyDecisionId: 'dec-browser-session-create',
        },
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId,
      auditEventId: auditInsert.id,
      evidencePackId,
      evidenceType: 'browser_session_created',
      sourceType: 'gateway_browser_session',
      redactionState: 'redacted',
      sensitivity: 'restricted',
      replayRef: `browser-session:${sessionId}:created`,
      metadata: {
        credentialBoundary: 'no_raw_credentials',
        governance: {
          policyDecisionId: 'dec-browser-session-create',
        },
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-item-1',
      },
    });
  });

  it('fails closed without committing browser session rows when control evidence persistence fails', async () => {
    const { db, inserts } = createBrowserDb([], { failOnInsertTable: evidenceItems });
    const helmClient = createBrowserAccessHelmClient('dec-browser-session-create');
    const deps = createMockDeps({ db: db as never, helmClient: helmClient as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      '/',
      {
        workspaceId,
        name: 'Founder Chrome',
        browser: 'chrome',
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 500);

    expect(body.error).toContain('failed to persist governed browser session');
    expect(inserts).toEqual([]);
  });

  it('fails closed when creating a browser session without HELM', async () => {
    const { db, inserts } = createBrowserDb();
    const deps = createMockDeps({ db: db as never, helmClient: undefined });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      '/',
      {
        workspaceId,
        name: 'Founder Chrome',
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 503);

    expect(body.error).toContain('HELM governance client is required');
    expect(inserts).toEqual([]);
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

  it('stores HELM governance when granting browser session access', async () => {
    const { db, inserts, updates } = createBrowserDb([
      [{ id: sessionId, workspaceId, allowedOrigins: ['https://www.ycombinator.com'] }],
    ]);
    const helmClient = createBrowserAccessHelmClient('dec-browser-session-grant');
    const deps = createMockDeps({ db: db as never, helmClient: helmClient as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      `/${sessionId}/grants`,
      {
        workspaceId,
        taskId,
        grantedToType: 'agent',
        scope: 'read_extract',
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ grant: { id: string } }>(res, 201);

    expect(body.grant.id).toBe(grantId);
    expect(helmClient.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: `workspace:${workspaceId}/operator:browser-session`,
        action: 'BROWSER_SESSION_GRANT',
        resource: `${sessionId}:read_extract`,
        effectLevel: 'E3',
        context: expect.objectContaining({
          workspaceId,
          source: 'gateway.browser-session',
          sessionId,
          taskId,
          scope: 'read_extract',
          allowedOrigins: ['https://www.ycombinator.com'],
        }),
      }),
    );
    expect(inserts.find((insert) => insert.table === browserSessionGrants)?.value).toMatchObject({
      workspaceId,
      sessionId,
      taskId,
      allowedOrigins: ['https://www.ycombinator.com'],
      policyDecisionId: 'dec-browser-session-grant',
      policyVersion: 'founder-ops-v1',
      helmDocumentVersionPins: {
        browserOperationPolicy: 'founder-ops-v1',
      },
      evidencePackId,
    });
    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    const auditInsertIndex = inserts.findIndex((insert) => insert.table === auditLog);
    const evidenceInsertIndex = inserts.findIndex((insert) => insert.table === evidenceItems);
    expect(auditInsertIndex).toBeLessThan(evidenceInsertIndex);
    expect(auditInsert).toMatchObject({
      action: 'BROWSER_SESSION_GRANTED',
      verdict: 'allow',
      metadata: {
        evidenceType: 'browser_session_granted',
        replayRef: `browser-session:${sessionId}:grant:${grantId}`,
        governance: {
          policyDecisionId: 'dec-browser-session-grant',
        },
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId,
      taskId,
      auditEventId: auditInsert.id,
      evidencePackId,
      evidenceType: 'browser_session_granted',
      sourceType: 'gateway_browser_session',
      redactionState: 'redacted',
      sensitivity: 'restricted',
      replayRef: `browser-session:${sessionId}:grant:${grantId}`,
      metadata: {
        sessionId,
        grantId,
        scope: 'read_extract',
        governance: {
          policyDecisionId: 'dec-browser-session-grant',
        },
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-item-1',
      },
    });
  });

  it('records audit-linked evidence when revoking a browser session', async () => {
    const { db, inserts, updates } = createBrowserDb();
    const deps = createMockDeps({ db: db as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch('DELETE', `/${sessionId}`, undefined, wsHeader);
    const body = await expectJson<{ revoked: boolean; sessionId: string }>(res, 200);

    expect(body).toEqual({ revoked: true, sessionId });
    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    const auditInsertIndex = inserts.findIndex((insert) => insert.table === auditLog);
    const evidenceInsertIndex = inserts.findIndex((insert) => insert.table === evidenceItems);
    expect(auditInsertIndex).toBeLessThan(evidenceInsertIndex);
    expect(auditInsert).toMatchObject({
      workspaceId,
      action: 'BROWSER_SESSION_REVOKED',
      target: sessionId,
      verdict: 'allow',
      metadata: {
        evidenceType: 'browser_session_revoked',
        replayRef: `browser-session:${sessionId}:revoked`,
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId,
      auditEventId: auditInsert.id,
      evidenceType: 'browser_session_revoked',
      sourceType: 'gateway_browser_session',
      redactionState: 'redacted',
      sensitivity: 'restricted',
      replayRef: `browser-session:${sessionId}:revoked`,
      metadata: {
        sessionId,
        credentialBoundary: 'no_raw_credentials',
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-item-1',
      },
    });
  });

  it('fails closed when granting browser session access without HELM', async () => {
    const { db, inserts } = createBrowserDb([
      [{ id: sessionId, workspaceId, allowedOrigins: ['https://www.ycombinator.com'] }],
    ]);
    const deps = createMockDeps({ db: db as never, helmClient: undefined });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      `/${sessionId}/grants`,
      {
        workspaceId,
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 503);

    expect(body.error).toContain('HELM governance client is required');
    expect(inserts).toEqual([]);
  });

  it('rejects browser grants to operators outside the authenticated workspace', async () => {
    const { db, inserts } = createBrowserDb([
      [{ id: sessionId, workspaceId, allowedOrigins: ['https://www.ycombinator.com'] }],
      [],
    ]);
    const helmClient = createBrowserAccessHelmClient('dec-browser-session-grant');
    const deps = createMockDeps({ db: db as never, helmClient: helmClient as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      `/${sessionId}/grants`,
      {
        workspaceId,
        grantedToType: 'operator',
        grantedToId: foreignOperatorId,
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 403);

    expect(body.error).toContain('granted operator does not belong');
    expect(helmClient.evaluate).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it('rejects browser grants to users outside the authenticated workspace', async () => {
    const { db, inserts } = createBrowserDb([
      [{ id: sessionId, workspaceId, allowedOrigins: ['https://www.ycombinator.com'] }],
      [],
    ]);
    const helmClient = createBrowserAccessHelmClient('dec-browser-session-grant');
    const deps = createMockDeps({ db: db as never, helmClient: helmClient as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      `/${sessionId}/grants`,
      {
        workspaceId,
        grantedToType: 'user',
        grantedToId: foreignUserId,
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 403);

    expect(body.error).toContain('granted user does not belong');
    expect(helmClient.evaluate).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it('requires a concrete recipient id for operator and user browser grants', async () => {
    const { db, inserts } = createBrowserDb([
      [{ id: sessionId, workspaceId, allowedOrigins: ['https://www.ycombinator.com'] }],
    ]);
    const helmClient = createBrowserAccessHelmClient('dec-browser-session-grant');
    const deps = createMockDeps({ db: db as never, helmClient: helmClient as never });
    const { fetch } = testApp(browserSessionRoutes, deps);

    const res = await fetch(
      'POST',
      `/${sessionId}/grants`,
      {
        workspaceId,
        grantedToType: 'operator',
        allowedOrigins: ['https://www.ycombinator.com'],
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 400);

    expect(body.error).toContain('grantedToId is required');
    expect(helmClient.evaluate).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it('stores a HELM-approved redacted read-only browser observation', async () => {
    const { db, inserts, updates } = createBrowserDb([
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
      governance: { decisionId: string; helmDocumentVersionPins: Record<string, string> };
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
    expect(body.governance.helmDocumentVersionPins).toEqual({
      browserReadPolicy: 'founder-ops-v1',
    });
    expect(inserts.find((insert) => insert.table === browserActions)?.value).toMatchObject({
      workspaceId,
      sessionId,
      grantId,
      taskId,
      actionType: 'read_extract',
      policyDecisionId: 'dec-browser',
      policyVersion: 'founder-ops-v1',
      helmDocumentVersionPins: { browserReadPolicy: 'founder-ops-v1' },
      evidencePackId,
      metadata: {
        helmDocumentVersionPins: { browserReadPolicy: 'founder-ops-v1' },
      },
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
        helmDocumentVersionPins: { browserReadPolicy: 'founder-ops-v1' },
        credentialBoundary: 'read_only_no_cookie_or_password_export',
      },
    });
    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    const auditInsertIndex = inserts.findIndex((insert) => insert.table === auditLog);
    const evidenceInsertIndex = inserts.findIndex((insert) => insert.table === evidenceItems);
    expect(auditInsertIndex).toBeLessThan(evidenceInsertIndex);
    expect(auditInsert.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId,
      taskId,
      auditEventId: auditInsert.id,
      evidencePackId,
      browserObservationId: 'obs-1',
      evidenceType: 'browser_observation',
      sourceType: 'gateway_browser_session',
      redactionState: 'redacted',
      contentHash: expect.stringMatching(/^sha256:/u),
      replayRef: `browser:${sessionId}:0`,
      metadata: {
        helmDocumentVersionPins: { browserReadPolicy: 'founder-ops-v1' },
      },
    });
    expect(auditInsert).toMatchObject({
      action: 'BROWSER_OBSERVATION_CAPTURED',
      verdict: 'allow',
      metadata: {
        helmDocumentVersionPins: { browserReadPolicy: 'founder-ops-v1' },
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-item-1',
      },
    });
  });

  it('fails closed without committing browser observation rows when evidence persistence fails', async () => {
    const { db, inserts } = createBrowserDb(
      [
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
      ],
      { failOnInsertTable: evidenceItems },
    );
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
        domSnapshot: '<main>YC account</main>',
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 500);

    expect(body.error).toContain('failed to persist governed browser observation evidence');
    expect(helmClient.evaluateOperatorBrowserRead).toHaveBeenCalled();
    expect(inserts).toEqual([]);
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

import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { appendEvidenceItem } from '@pilot/db';
import {
  auditLog,
  browserActions,
  browserObservations,
  browserSessionGrants,
  browserSessions,
} from '@pilot/db/schema';
import {
  BrowserReadObservationInput,
  CreateBrowserSessionGrantInput,
  CreateBrowserSessionInput,
} from '@pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole, workspaceIdMismatch } from '../lib/workspace.js';

export function browserSessionRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view browser sessions');
    if (roleDenied) return roleDenied;

    const sessions = await deps.db
      .select()
      .from(browserSessions)
      .where(eq(browserSessions.workspaceId, workspaceId))
      .orderBy(desc(browserSessions.createdAt))
      .limit(100);

    return c.json({ sessions });
  });

  app.post('/', async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateBrowserSessionInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    const roleDenied = requireWorkspaceRole(c, 'owner', 'create browser sessions');
    if (roleDenied) return roleDenied;
    if (workspaceIdMismatch(c, parsed.data.workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const [session] = await deps.db
      .insert(browserSessions)
      .values({
        workspaceId: parsed.data.workspaceId,
        userId: (c.get('userId') as string | undefined) ?? null,
        name: parsed.data.name,
        browser: parsed.data.browser,
        profileLabel: parsed.data.profileLabel,
        allowedOrigins: normalizeOrigins(parsed.data.allowedOrigins),
        metadata: {
          ...redactRecord(parsed.data.metadata),
          credentialBoundary: 'session_use_only_no_cookie_or_password_export',
        },
      })
      .returning({
        id: browserSessions.id,
        workspaceId: browserSessions.workspaceId,
        status: browserSessions.status,
      });

    await deps.db.insert(auditLog).values({
      workspaceId: parsed.data.workspaceId,
      action: 'BROWSER_SESSION_CREATED',
      actor: `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`,
      target: session?.id ?? null,
      verdict: 'allow',
      metadata: {
        browser: parsed.data.browser,
        allowedOrigins: normalizeOrigins(parsed.data.allowedOrigins),
        credentialBoundary: 'no_raw_credentials',
      },
    });

    return c.json({ session }, 201);
  });

  app.post('/:sessionId/grants', async (c) => {
    const sessionId = c.req.param('sessionId');
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateBrowserSessionGrantInput.safeParse({ ...raw, sessionId });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    const roleDenied = requireWorkspaceRole(c, 'owner', 'grant browser session access');
    if (roleDenied) return roleDenied;
    if (workspaceIdMismatch(c, parsed.data.workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const [session] = await deps.db
      .select()
      .from(browserSessions)
      .where(
        and(
          eq(browserSessions.id, sessionId),
          eq(browserSessions.workspaceId, parsed.data.workspaceId),
          eq(browserSessions.status, 'active'),
        ),
      )
      .limit(1);
    if (!session) return c.json({ error: 'active browser session not found' }, 404);

    const sessionOrigins = normalizeOrigins(asStringArray(session.allowedOrigins));
    const grantOrigins = normalizeOrigins(parsed.data.allowedOrigins);
    if (grantOrigins.length === 0) {
      return c.json({ error: 'at least one grant allowedOrigin is required' }, 400);
    }
    if (sessionOrigins.length > 0 && !grantOrigins.every((origin) => sessionOrigins.includes(origin))) {
      return c.json({ error: 'grant origin exceeds session allowedOrigins' }, 403);
    }

    const [grant] = await deps.db
      .insert(browserSessionGrants)
      .values({
        workspaceId: parsed.data.workspaceId,
        sessionId,
        taskId: parsed.data.taskId,
        ventureId: parsed.data.ventureId,
        missionId: parsed.data.missionId,
        grantedToType: parsed.data.grantedToType,
        grantedToId: parsed.data.grantedToId,
        scope: parsed.data.scope,
        allowedOrigins: grantOrigins,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      })
      .returning({
        id: browserSessionGrants.id,
        workspaceId: browserSessionGrants.workspaceId,
        sessionId: browserSessionGrants.sessionId,
        scope: browserSessionGrants.scope,
        status: browserSessionGrants.status,
      });

    await deps.db.insert(auditLog).values({
      workspaceId: parsed.data.workspaceId,
      action: 'BROWSER_SESSION_GRANTED',
      actor: `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`,
      target: grant?.id ?? sessionId,
      verdict: 'allow',
      metadata: {
        sessionId,
        scope: parsed.data.scope,
        allowedOrigins: grantOrigins,
      },
    });

    return c.json({ grant }, 201);
  });

  app.delete('/:sessionId', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'revoke browser sessions');
    if (roleDenied) return roleDenied;
    const sessionId = c.req.param('sessionId');

    await deps.db
      .update(browserSessions)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(browserSessions.id, sessionId), eq(browserSessions.workspaceId, workspaceId)));
    await deps.db
      .update(browserSessionGrants)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(
        and(
          eq(browserSessionGrants.sessionId, sessionId),
          eq(browserSessionGrants.workspaceId, workspaceId),
          eq(browserSessionGrants.status, 'active'),
        ),
      );

    await deps.db.insert(auditLog).values({
      workspaceId,
      action: 'BROWSER_SESSION_REVOKED',
      actor: `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`,
      target: sessionId,
      verdict: 'allow',
    });

    return c.json({ revoked: true, sessionId });
  });

  app.post('/observations', async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = BrowserReadObservationInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    const roleDenied = requireWorkspaceRole(c, 'owner', 'store browser observations');
    if (roleDenied) return roleDenied;
    if (workspaceIdMismatch(c, parsed.data.workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }
    if (!deps.helmClient) {
      return c.json({ error: 'HELM client is required for browser read observations' }, 503);
    }

    const ownership = await loadActiveBrowserGrant(deps, parsed.data);
    if (ownership instanceof Response) return ownership;

    const url = new URL(parsed.data.url);
    if (!ownership.allowedOrigins.includes(url.origin)) {
      return c.json({ error: 'browser observation origin is outside the active grant' }, 403);
    }

    const evaluation = await deps.helmClient.evaluateOperatorBrowserRead({
      principal: `workspace:${parsed.data.workspaceId}/browser:${parsed.data.sessionId}`,
      workspaceId: parsed.data.workspaceId,
      sessionId: parsed.data.sessionId,
      grantId: parsed.data.grantId,
      objective: parsed.data.objective,
      url: parsed.data.url,
      taskId: parsed.data.taskId,
      operatorId:
        ownership.grantedToType === 'operator' && ownership.grantedToId
          ? ownership.grantedToId
          : undefined,
    });

    const redacted = redactBrowserText(parsed.data.domSnapshot ?? '');
    const redactions = Array.from(new Set([...parsed.data.redactions, ...redacted.redactions]));
    const [browserAction] = await deps.db
      .insert(browserActions)
      .values({
        workspaceId: parsed.data.workspaceId,
        sessionId: parsed.data.sessionId,
        grantId: parsed.data.grantId,
        taskId: parsed.data.taskId,
        toolActionId: parsed.data.actionId,
        actionType: 'read_extract',
        objective: parsed.data.objective,
        url: parsed.data.url,
        origin: url.origin,
        status: 'completed',
        policyDecisionId: evaluation.receipt.decisionId,
        policyVersion: evaluation.receipt.policyVersion,
        evidencePackId: evaluation.evidencePackId ?? null,
        completedAt: new Date(),
        metadata: {
          helmDecisionId: evaluation.receipt.decisionId,
          helmPolicyVersion: evaluation.receipt.policyVersion,
          credentialBoundary: 'read_only_no_cookie_or_password_export',
        },
      })
      .returning({
        id: browserActions.id,
        replayIndex: browserActions.replayIndex,
        evidencePackId: browserActions.evidencePackId,
      });

    const [observation] = await deps.db
      .insert(browserObservations)
      .values({
        workspaceId: parsed.data.workspaceId,
        sessionId: parsed.data.sessionId,
        grantId: parsed.data.grantId,
        browserActionId: browserAction?.id ?? null,
        taskId: parsed.data.taskId,
        actionId: parsed.data.actionId,
        evidencePackId: evaluation.evidencePackId ?? null,
        url: parsed.data.url,
        origin: url.origin,
        title: parsed.data.title,
        objective: parsed.data.objective,
        domHash: parsed.data.domSnapshot ? hashText(redacted.text) : null,
        screenshotHash: parsed.data.screenshotHash ?? null,
        screenshotRef: parsed.data.screenshotRef ?? null,
        redactedDomSnapshot: redacted.text || null,
        extractedData: redactJson(parsed.data.extractedData),
        redactions,
        replayIndex: browserAction?.replayIndex ?? 0,
        metadata: {
          ...redactRecord(parsed.data.metadata),
          helmDecisionId: evaluation.receipt.decisionId,
          helmPolicyVersion: evaluation.receipt.policyVersion,
          credentialBoundary: 'read_only_no_cookie_or_password_export',
        },
      })
      .returning({
        id: browserObservations.id,
        workspaceId: browserObservations.workspaceId,
        sessionId: browserObservations.sessionId,
        grantId: browserObservations.grantId,
        domHash: browserObservations.domHash,
        evidencePackId: browserObservations.evidencePackId,
      });

    const evidenceItemId = await appendEvidenceItem(deps.db, {
      workspaceId: parsed.data.workspaceId,
      taskId: parsed.data.taskId ?? null,
      actionId: parsed.data.actionId ?? null,
      evidencePackId: evaluation.evidencePackId ?? null,
      browserObservationId: observation?.id ?? null,
      evidenceType: 'browser_observation',
      sourceType: 'gateway_browser_session',
      title: `Browser read: ${parsed.data.title ?? url.hostname}`,
      summary: parsed.data.objective ?? `Read-only browser extraction from ${url.origin}`,
      redactionState: redactions.length > 0 ? 'redacted' : 'clean',
      sensitivity: 'sensitive',
      contentHash: observation?.domHash ?? parsed.data.screenshotHash ?? null,
      storageRef: parsed.data.screenshotRef ?? null,
      replayRef: `browser:${parsed.data.sessionId}:${browserAction?.replayIndex ?? 0}`,
      metadata: {
        sessionId: parsed.data.sessionId,
        grantId: parsed.data.grantId,
        browserActionId: browserAction?.id ?? null,
        url: parsed.data.url,
        origin: url.origin,
        helmDecisionId: evaluation.receipt.decisionId,
        helmPolicyVersion: evaluation.receipt.policyVersion,
        credentialBoundary: 'read_only_no_cookie_or_password_export',
        redactions,
      },
    });

    await deps.db.insert(auditLog).values({
      workspaceId: parsed.data.workspaceId,
      action: 'BROWSER_OBSERVATION_CAPTURED',
      actor: `browser:${parsed.data.sessionId}`,
      target: observation?.id ?? parsed.data.url,
      verdict: 'allow',
      metadata: {
        grantId: parsed.data.grantId,
        browserActionId: browserAction?.id ?? null,
        url: parsed.data.url,
        origin: url.origin,
        helmDecisionId: evaluation.receipt.decisionId,
        helmPolicyVersion: evaluation.receipt.policyVersion,
        evidencePackId: evaluation.evidencePackId ?? null,
        evidenceItemId,
        redactions,
      },
    });

    return c.json(
      {
        browserAction,
        observation,
        governance: {
          status: evaluation.status,
          decisionId: evaluation.receipt.decisionId,
          policyVersion: evaluation.receipt.policyVersion,
          evidencePackId: evaluation.evidencePackId,
        },
        evidenceItemId,
      },
      201,
    );
  });

  app.get('/:sessionId/observations', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view browser observations');
    if (roleDenied) return roleDenied;
    const sessionId = c.req.param('sessionId');

    const observations = await deps.db
      .select()
      .from(browserObservations)
      .where(
        and(
          eq(browserObservations.workspaceId, workspaceId),
          eq(browserObservations.sessionId, sessionId),
        ),
      )
      .orderBy(desc(browserObservations.observedAt))
      .limit(100);

    return c.json({ observations });
  });

  return app;
}

async function loadActiveBrowserGrant(
  deps: GatewayDeps,
  input: {
    workspaceId: string;
    sessionId: string;
    grantId: string;
  },
): Promise<
  | {
      allowedOrigins: string[];
      grantedToType: string;
      grantedToId?: string;
    }
  | Response
> {
  const [session] = await deps.db
    .select()
    .from(browserSessions)
    .where(
      and(
        eq(browserSessions.id, input.sessionId),
        eq(browserSessions.workspaceId, input.workspaceId),
        eq(browserSessions.status, 'active'),
      ),
    )
    .limit(1);
  if (!session) return Response.json({ error: 'active browser session not found' }, { status: 404 });

  const [grant] = await deps.db
    .select()
    .from(browserSessionGrants)
    .where(
      and(
        eq(browserSessionGrants.id, input.grantId),
        eq(browserSessionGrants.sessionId, input.sessionId),
        eq(browserSessionGrants.workspaceId, input.workspaceId),
        eq(browserSessionGrants.status, 'active'),
      ),
    )
    .limit(1);
  if (!grant) return Response.json({ error: 'active browser grant not found' }, { status: 404 });

  const grantOrigins = normalizeOrigins(asStringArray(grant.allowedOrigins));
  const sessionOrigins = normalizeOrigins(asStringArray(session.allowedOrigins));
  const allowedOrigins = grantOrigins.length > 0 ? grantOrigins : sessionOrigins;
  if (allowedOrigins.length === 0) {
    return Response.json({ error: 'browser grant has no allowed origins' }, { status: 403 });
  }
  return {
    allowedOrigins,
    grantedToType: String(grant.grantedToType ?? 'agent'),
    grantedToId: typeof grant.grantedToId === 'string' ? grant.grantedToId : undefined,
  };
}

function normalizeOrigins(origins: string[]) {
  return Array.from(
    new Set(
      origins.map((origin) => {
        const url = new URL(origin);
        return url.origin;
      }),
    ),
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hashText(text: string) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

const SENSITIVE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [
    /((?:name|id)=["']?(?:password|passwd|pwd|token|secret|cookie|session)[^>]*\bvalue=["']?)[^"'>\s]+/giu,
    '$1[REDACTED]',
  ],
  [/(password|passwd|pwd)(\s*[:=]\s*)(["']?)[^"'\s<>&]+/giu, '$1$2$3[REDACTED]'],
  [/(token|secret|api[_-]?key|authorization)(\s*[:=]\s*)(["']?)[^"'\s<>&]+/giu, '$1$2$3[REDACTED]'],
  [/(session|cookie)(\s*[:=]\s*)(["']?)[^"'\s<>&]+/giu, '$1$2$3[REDACTED]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gu, '$1[REDACTED]'],
];

function redactBrowserText(text: string) {
  let redacted = text;
  const redactions: string[] = [];
  for (const [pattern, replacement] of SENSITIVE_TEXT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(redacted)) {
      redactions.push(pattern.source);
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, replacement);
    }
  }
  return { text: redacted, redactions };
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if (/password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie|session/iu.test(key)) {
        return [key, '[REDACTED]'];
      }
      if (typeof child === 'string') return [key, redactBrowserText(child).text];
      return [key, redactJson(child)];
    }),
  );
}

function redactRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const redacted = redactJson(value ?? {});
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}

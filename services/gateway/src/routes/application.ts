import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { appendEvidenceItem } from '@pilot/db';
import { applications, applicationDrafts, applicationArtifacts, auditLog } from '@pilot/db/schema';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole, workspaceIdMismatch } from '../lib/workspace.js';

const VALID_STATUSES = [
  'draft',
  'in_progress',
  'in_review',
  'submitted',
  'accepted',
  'rejected',
] as const;

export function applicationRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const results = await deps.db
      .select()
      .from(applications)
      .where(eq(applications.workspaceId, workspaceId));

    return c.json(results.map(serializeApplication));
  });

  app.post('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'create applications');
    if (roleDenied) return roleDenied;
    const body = await c.req.json();
    if (workspaceIdMismatch(c, body.workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }
    const targetProgram = body.targetProgram ?? body.program;
    const name = body.name ?? targetProgram ?? 'Application';

    if (!targetProgram) {
      return c.json({ error: 'workspaceId and targetProgram required' }, 400);
    }

    const created = await deps.db
      .transaction(async (tx) => {
        const [application] = await tx
          .insert(applications)
          .values({
            workspaceId,
            name,
            targetProgram,
            deadline: body.deadline ? new Date(body.deadline) : undefined,
            status: normalizeStatus(body.status) ?? 'draft',
          })
          .returning();

        if (!application) throw new Error('failed to create application');

        const auditEventId = randomUUID();
        const replayRef = `application:${workspaceId}:${application.id}:created`;
        const auditMetadata = {
          applicationId: application.id,
          name,
          targetProgram,
          status: application.status,
          deadlinePresent: Boolean(body.deadline),
          evidenceContract: 'application_create_evidence_required',
        };

        await tx.insert(auditLog).values({
          id: auditEventId,
          workspaceId,
          action: 'APPLICATION_CREATED',
          actor: `user:${c.get('userId') ?? 'unknown'}`,
          target: application.id,
          verdict: 'allow',
          metadata: {
            evidenceType: 'application_created',
            replayRef,
            ...auditMetadata,
          },
        });

        const evidenceItemId = await appendEvidenceItem(tx, {
          workspaceId,
          auditEventId,
          evidenceType: 'application_created',
          sourceType: 'gateway_application_route',
          title: `Application created: ${targetProgram}`,
          summary: 'Workspace application record was created.',
          redactionState: 'none',
          sensitivity: 'internal',
          replayRef,
          metadata: auditMetadata,
        });

        await tx
          .update(auditLog)
          .set({
            metadata: {
              evidenceType: 'application_created',
              replayRef,
              evidenceItemId,
              ...auditMetadata,
            },
          })
          .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.id, auditEventId)));

        return { application, evidenceItemId };
      })
      .catch(() => null);

    if (!created) return c.json({ error: 'Failed to persist application evidence' }, 500);
    return c.json(
      { ...serializeApplication(created.application), evidenceItemId: created.evidenceItemId },
      201,
    );
  });

  app.get('/:id', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const { id } = c.req.param();

    const [application] = await deps.db
      .select()
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.workspaceId, workspaceId)))
      .limit(1);
    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    const drafts = await deps.db
      .select()
      .from(applicationDrafts)
      .where(eq(applicationDrafts.applicationId, id));

    const artifacts = await deps.db
      .select()
      .from(applicationArtifacts)
      .where(eq(applicationArtifacts.applicationId, id));

    return c.json({ ...serializeApplication(application), drafts, artifacts });
  });

  app.put('/:id/drafts', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const { id } = c.req.param();
    const body = await c.req.json();
    const { section, content } = body as { section: string; content: string };
    if (!section || !content) {
      return c.json({ error: 'section and content required' }, 400);
    }

    const [application] = await deps.db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.workspaceId, workspaceId)))
      .limit(1);
    if (!application) return c.json({ error: 'Application not found' }, 404);

    const [existing] = await deps.db
      .select()
      .from(applicationDrafts)
      .where(and(eq(applicationDrafts.applicationId, id), eq(applicationDrafts.section, section)))
      .limit(1);

    if (existing) {
      const nextVersion = String(Number(existing.version ?? '1') + 1);
      const [updated] = await deps.db
        .update(applicationDrafts)
        .set({ content, version: nextVersion, updatedAt: new Date() })
        .where(eq(applicationDrafts.id, existing.id))
        .returning();
      return c.json(updated);
    }

    const [created] = await deps.db
      .insert(applicationDrafts)
      .values({ applicationId: id, section, content })
      .returning();
    return c.json(created, 201);
  });

  app.put('/:id/status', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const { id } = c.req.param();
    const body = await c.req.json();
    const normalizedStatus = normalizeStatus(body.status);

    if (!normalizedStatus || !VALID_STATUSES.includes(normalizedStatus)) {
      return c.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }

    const values: Record<string, unknown> = { status: normalizedStatus, updatedAt: new Date() };
    if (normalizedStatus === 'submitted') {
      values['submittedAt'] = new Date();
    }

    // Predicate composes id with workspaceId so a caller cannot flip the
    // status of another tenant's application by id-guess.
    const [updated] = await deps.db
      .update(applications)
      .set(values)
      .where(and(eq(applications.id, id), eq(applications.workspaceId, workspaceId)))
      .returning();

    if (!updated) return c.json({ error: 'Application not found' }, 404);
    return c.json(serializeApplication(updated));
  });

  return app;
}

function normalizeStatus(status: unknown): (typeof VALID_STATUSES)[number] | undefined {
  if (status === undefined || status === null || status === '') return undefined;
  if (status === 'in_review') return 'in_progress';
  if (
    typeof status === 'string' &&
    VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])
  ) {
    return status as (typeof VALID_STATUSES)[number];
  }
  return undefined;
}

function serializeApplication(application: typeof applications.$inferSelect) {
  return {
    ...application,
    program: application.targetProgram,
  };
}

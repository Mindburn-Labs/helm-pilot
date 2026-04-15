import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { applications, applicationDrafts, applicationArtifacts } from '@helm-pilot/db/schema';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

const VALID_STATUSES = ['draft', 'in_progress', 'in_review', 'submitted', 'accepted', 'rejected'] as const;

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
    const body = await c.req.json();
    const resolvedWorkspaceId = body.workspaceId ?? workspaceId;
    const targetProgram = body.targetProgram ?? body.program;
    const name = body.name ?? targetProgram ?? 'Application';

    if (!resolvedWorkspaceId || !targetProgram) {
      return c.json({ error: 'workspaceId and targetProgram required' }, 400);
    }

    const [created] = await deps.db
      .insert(applications)
      .values({
        workspaceId: resolvedWorkspaceId,
        name,
        targetProgram,
        deadline: body.deadline ? new Date(body.deadline) : undefined,
        status: normalizeStatus(body.status) ?? 'draft',
      })
      .returning();

    if (!created) return c.json({ error: 'Failed to create application' }, 500);
    return c.json(serializeApplication(created), 201);
  });

  app.get('/:id', async (c) => {
    const workspaceId = getWorkspaceId(c);
    const { id } = c.req.param();

    const [application] = await deps.db
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .limit(1);
    if (!application || (workspaceId && application.workspaceId !== workspaceId)) {
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
    const { id } = c.req.param();
    const body = await c.req.json();
    const { section, content } = body as { section: string; content: string };
    if (!section || !content) {
      return c.json({ error: 'section and content required' }, 400);
    }

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
  if (typeof status === 'string' && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
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

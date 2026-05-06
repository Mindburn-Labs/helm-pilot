import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { appendEvidenceItem } from '@pilot/db';
import { auditLog, operators, operatorRoles, operatorConfigs } from '@pilot/db/schema';
import { CreateOperatorInput, UpdateOperatorInput } from '@pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole, workspaceIdMismatch } from '../lib/workspace.js';

export function operatorRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const rows = await deps.db
      .select()
      .from(operators)
      .where(eq(operators.workspaceId, workspaceId));

    return c.json(rows);
  });

  app.post('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'create workspace operators');
    if (roleDenied) return roleDenied;
    const raw = await c.req.json();
    if (workspaceIdMismatch(c, raw.workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }
    const parsed = CreateOperatorInput.safeParse({
      ...raw,
      workspaceId,
    });

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const body = parsed.data;

    const op = await deps.db
      .transaction(async (tx) => {
        const [created] = await tx
          .insert(operators)
          .values({
            workspaceId: body.workspaceId,
            name: body.name,
            role: body.role,
            goal: body.goal,
            constraints: body.constraints,
            tools: body.tools,
          })
          .returning();

        if (!created) return null;

        await tx.insert(operatorConfigs).values({
          operatorId: created.id,
          iterationBudget: { maxIterations: 50 },
        });

        const auditEventId = randomUUID();
        const replayRef = `operator:${created.id}:created`;
        const evidenceMetadata = {
          operatorId: created.id,
          role: created.role,
          toolCount: Array.isArray(created.tools) ? created.tools.length : 0,
          hasConstraints: Boolean(created.constraints),
        };

        await tx.insert(auditLog).values({
          id: auditEventId,
          workspaceId,
          action: 'WORKSPACE_OPERATOR_CREATED',
          actor: `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`,
          target: created.id,
          verdict: 'allow',
          metadata: {
            evidenceType: 'workspace_operator_created',
            replayRef,
            ...evidenceMetadata,
          },
        });

        const evidenceItemId = await appendEvidenceItem(tx, {
          workspaceId,
          auditEventId,
          evidenceType: 'workspace_operator_created',
          sourceType: 'gateway_operator',
          title: `Workspace operator created: ${created.name}`,
          summary: 'Workspace operator metadata and default runtime budget were created.',
          redactionState: 'redacted',
          sensitivity: 'internal',
          replayRef,
          metadata: evidenceMetadata,
        });

        await tx
          .update(auditLog)
          .set({
            metadata: {
              evidenceType: 'workspace_operator_created',
              replayRef,
              evidenceItemId,
              ...evidenceMetadata,
            },
          })
          .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.id, auditEventId)));

        return created;
      })
      .catch(() => null);

    if (!op) return c.json({ error: 'Failed to create operator' }, 500);

    return c.json(op, 201);
  });

  app.get('/roles', async (c) => {
    const roles = await deps.db.select().from(operatorRoles);
    return c.json(roles);
  });

  app.get('/:id', async (c) => {
    const { id } = c.req.param();
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    // Composed predicate: operator must exist AND belong to caller's
    // workspace — otherwise return 404 to avoid leaking existence.
    const [op] = await deps.db
      .select()
      .from(operators)
      .where(and(eq(operators.id, id), eq(operators.workspaceId, workspaceId)))
      .limit(1);

    if (!op) return c.json({ error: 'Operator not found' }, 404);

    const [config] = await deps.db
      .select()
      .from(operatorConfigs)
      .where(eq(operatorConfigs.operatorId, id))
      .limit(1);

    return c.json({ ...op, config: config ?? null });
  });

  app.put('/:id', async (c) => {
    const { id } = c.req.param();
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'mutate workspace operators');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json();
    const parsed = UpdateOperatorInput.safeParse(raw);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const [existing] = await deps.db
      .select()
      .from(operators)
      .where(and(eq(operators.id, id), eq(operators.workspaceId, workspaceId)))
      .limit(1);

    if (!existing) return c.json({ error: 'Operator not found' }, 404);

    const body = parsed.data;
    // Both SELECT and UPDATE compose id with workspaceId so mutations cannot
    // target another tenant's operator by id-guess.
    const updated = await deps.db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(operators)
          .set({
            goal: body.goal ?? existing.goal,
            constraints: body.constraints ?? existing.constraints,
            tools: body.tools ?? existing.tools,
            isActive:
              body.isActive === undefined
                ? existing.isActive
                : typeof body.isActive === 'boolean'
                  ? String(body.isActive)
                  : body.isActive,
          })
          .where(and(eq(operators.id, id), eq(operators.workspaceId, workspaceId)))
          .returning();

        if (!row) return null;

        const auditEventId = randomUUID();
        const replayRef = `operator:${row.id}:updated`;
        const changedFields = Object.entries(body)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key)
          .sort();
        const evidenceMetadata = {
          operatorId: row.id,
          role: row.role,
          changedFields,
          toolCount: Array.isArray(row.tools) ? row.tools.length : 0,
          isActive: row.isActive,
        };

        await tx.insert(auditLog).values({
          id: auditEventId,
          workspaceId,
          action: 'WORKSPACE_OPERATOR_UPDATED',
          actor: `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`,
          target: row.id,
          verdict: 'allow',
          metadata: {
            evidenceType: 'workspace_operator_updated',
            replayRef,
            ...evidenceMetadata,
          },
        });

        const evidenceItemId = await appendEvidenceItem(tx, {
          workspaceId,
          auditEventId,
          evidenceType: 'workspace_operator_updated',
          sourceType: 'gateway_operator',
          title: `Workspace operator updated: ${row.name}`,
          summary: 'Workspace operator metadata was updated.',
          redactionState: 'redacted',
          sensitivity: 'internal',
          replayRef,
          metadata: evidenceMetadata,
        });

        await tx
          .update(auditLog)
          .set({
            metadata: {
              evidenceType: 'workspace_operator_updated',
              replayRef,
              evidenceItemId,
              ...evidenceMetadata,
            },
          })
          .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.id, auditEventId)));

        return row;
      })
      .catch(() => null);

    if (!updated) return c.json({ error: 'Failed to update operator' }, 500);

    return c.json(updated);
  });

  return app;
}

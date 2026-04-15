import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { operators, operatorRoles, operatorConfigs } from '@helm-pilot/db/schema';
import { CreateOperatorInput, UpdateOperatorInput } from '@helm-pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

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
    const raw = await c.req.json();
    const parsed = CreateOperatorInput.safeParse({
      ...raw,
      workspaceId: raw.workspaceId ?? workspaceId,
    });

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const body = parsed.data;

    const [op] = await deps.db
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

    if (!op) return c.json({ error: 'Failed to create operator' }, 500);

    await deps.db.insert(operatorConfigs).values({
      operatorId: op.id,
      iterationBudget: { maxIterations: 50 },
    });

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
    const [updated] = await deps.db
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

    return c.json(updated);
  });

  return app;
}

import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { workspaces, workspaceSettings, workspaceMembers, sessions } from '@pilot/db/schema';
import { generateToken } from '../middleware/auth.js';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole } from '../lib/workspace.js';

export function workspaceRoutes(deps: GatewayDeps) {
  const app = new Hono();

  const assertWorkspacePath = (c: Context, id: string) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (workspaceId !== id) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }
    return null;
  };

  // GET /api/workspace/:id — Get workspace details
  app.get('/:id', async (c) => {
    const { id } = c.req.param();
    const mismatch = assertWorkspacePath(c, id);
    if (mismatch) return mismatch;

    const [ws] = await deps.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!ws) return c.json({ error: 'Workspace not found' }, 404);

    const members = await deps.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, id));

    return c.json({ ...ws, members });
  });

  // GET /api/workspace/:id/settings — Get workspace settings
  app.get('/:id/settings', async (c) => {
    const { id } = c.req.param();
    const mismatch = assertWorkspacePath(c, id);
    if (mismatch) return mismatch;

    const [settings] = await deps.db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, id))
      .limit(1);

    if (!settings) {
      return c.json(defaultWorkspaceSettings(id));
    }

    return c.json(normalizeWorkspaceSettings(id, settings));
  });

  // PUT /api/workspace/:id/settings — Update workspace settings
  app.put('/:id/settings', async (c) => {
    const { id } = c.req.param();
    const mismatch = assertWorkspacePath(c, id);
    if (mismatch) return mismatch;
    const roleDenied = requireWorkspaceRole(c, 'owner', 'update workspace policy settings');
    if (roleDenied) return roleDenied;

    const body = await c.req.json();
    const { policyConfig, budgetConfig, modelConfig } = body as {
      policyConfig?: Record<string, unknown>;
      budgetConfig?: Record<string, unknown>;
      modelConfig?: Record<string, unknown>;
    };

    // Verify workspace exists
    const [ws] = await deps.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!ws) return c.json({ error: 'Workspace not found' }, 404);

    // Upsert settings
    const [existing] = await deps.db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, id))
      .limit(1);

    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (policyConfig) updates['policyConfig'] = normalizePolicyConfig(policyConfig);
      if (budgetConfig) updates['budgetConfig'] = normalizeBudgetConfig(budgetConfig);
      if (modelConfig) updates['modelConfig'] = normalizeModelConfig(modelConfig);

      const [updated] = await deps.db
        .update(workspaceSettings)
        .set(updates)
        .where(eq(workspaceSettings.workspaceId, id))
        .returning();
      return c.json(normalizeWorkspaceSettings(id, updated ?? existing));
    }

    const [created] = await deps.db
      .insert(workspaceSettings)
      .values({
        workspaceId: id,
        policyConfig: normalizePolicyConfig(policyConfig ?? {}),
        budgetConfig: normalizeBudgetConfig(budgetConfig ?? {}),
        modelConfig: normalizeModelConfig(modelConfig ?? {}),
      })
      .returning();
    return c.json(normalizeWorkspaceSettings(id, created ?? null), 201);
  });

  // PUT /api/workspace/:id/mode — Switch workspace mode
  app.put('/:id/mode', async (c) => {
    const { id } = c.req.param();
    const mismatch = assertWorkspacePath(c, id);
    if (mismatch) return mismatch;
    const roleDenied = requireWorkspaceRole(c, 'owner', 'change workspace mode');
    if (roleDenied) return roleDenied;

    const body = await c.req.json();
    const { mode } = body as { mode: string };

    const validModes = ['discover', 'decide', 'build', 'launch', 'apply'];
    if (!validModes.includes(mode)) {
      return c.json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}` }, 400);
    }

    const [updated] = await deps.db
      .update(workspaces)
      .set({ currentMode: mode, updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();

    if (!updated) return c.json({ error: 'Workspace not found' }, 404);
    return c.json({ id: updated.id, currentMode: updated.currentMode });
  });

  // POST /api/workspace/:id/invite — Generate invite link
  app.post('/:id/invite', async (c) => {
    const { id } = c.req.param();
    const mismatch = assertWorkspacePath(c, id);
    if (mismatch) return mismatch;
    const roleDenied = requireWorkspaceRole(c, 'owner', 'create workspace invites');
    if (roleDenied) return roleDenied;

    const body = await c.req.json();
    const { role, email } = body as { role?: string; email?: string };

    const validRoles = ['partner', 'member'];
    const inviteRole = validRoles.includes(role ?? '') ? role! : 'member';

    // Verify workspace exists
    const [ws] = await deps.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!ws) return c.json({ error: 'Workspace not found' }, 404);

    // Generate invite token
    const randomPart = generateToken();
    const inviteToken = `${id}:${inviteRole}:${randomPart}`;

    // Store as a session row with 'invite' channel (7-day expiry)
    // Use a system user ID — the workspace owner's ID
    await deps.db.insert(sessions).values({
      userId: ws.ownerId,
      token: `invite:${inviteToken}`,
      channel: 'invite',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
    const inviteUrl = `${appUrl}/invite/${inviteToken}`;

    return c.json(
      {
        inviteUrl,
        inviteToken,
        role: inviteRole,
        expiresIn: '7 days',
        ...(email ? { sentTo: email } : {}),
      },
      201,
    );
  });

  return app;
}

function defaultWorkspaceSettings(workspaceId: string) {
  return {
    workspaceId,
    policyConfig: {
      maxIterationBudget: 50,
      toolBlocklist: [],
      connectorAllowlist: [],
      requireApprovalFor: [],
      failClosed: true,
    },
    budgetConfig: {
      dailyTotalMax: 500,
      perTaskMax: 100,
      perOperatorMax: 200,
      emergencyKill: 1500,
      currency: 'EUR',
    },
    modelConfig: {
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4-20250514',
      temperature: 0.7,
    },
  };
}

function normalizeWorkspaceSettings(
  workspaceId: string,
  settings: {
    policyConfig?: unknown;
    budgetConfig?: unknown;
    modelConfig?: unknown;
  } | null,
) {
  const defaults = defaultWorkspaceSettings(workspaceId);
  return {
    workspaceId,
    policyConfig: normalizePolicyConfig(settings?.policyConfig ?? defaults.policyConfig),
    budgetConfig: normalizeBudgetConfig(settings?.budgetConfig ?? defaults.budgetConfig),
    modelConfig: normalizeModelConfig(settings?.modelConfig ?? defaults.modelConfig),
  };
}

function normalizePolicyConfig(policyConfig: unknown) {
  const config = asRecord(policyConfig);
  return {
    maxIterationBudget: toNumber(config['maxIterationBudget'], 50),
    toolBlocklist: toStringArray(config['toolBlocklist'] ?? config['blockedTools']),
    connectorAllowlist: toStringArray(config['connectorAllowlist']),
    requireApprovalFor: toStringArray(config['requireApprovalFor']),
    failClosed: typeof config['failClosed'] === 'boolean' ? config['failClosed'] : true,
  };
}

function normalizeBudgetConfig(budgetConfig: unknown) {
  const config = asRecord(budgetConfig);
  return {
    dailyTotalMax: toNumber(config['dailyTotalMax'] ?? config['monthlyLlmBudget'], 500),
    perTaskMax: toNumber(config['perTaskMax'], 100),
    perOperatorMax: toNumber(config['perOperatorMax'], 200),
    emergencyKill: toNumber(config['emergencyKill'], 1500),
    currency: typeof config['currency'] === 'string' ? config['currency'] : 'EUR',
  };
}

function normalizeModelConfig(modelConfig: unknown) {
  const config = asRecord(modelConfig);
  return {
    provider: typeof config['provider'] === 'string' ? config['provider'] : 'openrouter',
    model:
      typeof config['model'] === 'string' ? config['model'] : 'anthropic/claude-sonnet-4-20250514',
    temperature: toNumber(config['temperature'], 0.7),
  };
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function toNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

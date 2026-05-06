import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { appendEvidenceItem } from '@pilot/db';
import {
  auditLog,
  workspaces,
  workspaceSettings,
  workspaceMembers,
  sessions,
} from '@pilot/db/schema';
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

    const result = await deps.db
      .transaction(async (tx) => {
        // Verify workspace exists inside the same transaction that writes
        // evidence, so policy mutations cannot partially commit.
        const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
        if (!ws) return { status: 'not_found' as const };

        const [existing] = await tx
          .select()
          .from(workspaceSettings)
          .where(eq(workspaceSettings.workspaceId, id))
          .limit(1);

        let settings: typeof existing | null = existing ?? null;
        let created = false;
        const changedSections = [
          policyConfig ? 'policyConfig' : null,
          budgetConfig ? 'budgetConfig' : null,
          modelConfig ? 'modelConfig' : null,
        ].filter((section): section is string => Boolean(section));

        if (existing) {
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (policyConfig) updates['policyConfig'] = normalizePolicyConfig(policyConfig);
          if (budgetConfig) updates['budgetConfig'] = normalizeBudgetConfig(budgetConfig);
          if (modelConfig) updates['modelConfig'] = normalizeModelConfig(modelConfig);

          const [updated] = await tx
            .update(workspaceSettings)
            .set(updates)
            .where(eq(workspaceSettings.workspaceId, id))
            .returning();
          settings = updated ?? existing;
        } else {
          const [inserted] = await tx
            .insert(workspaceSettings)
            .values({
              workspaceId: id,
              policyConfig: normalizePolicyConfig(policyConfig ?? {}),
              budgetConfig: normalizeBudgetConfig(budgetConfig ?? {}),
              modelConfig: normalizeModelConfig(modelConfig ?? {}),
            })
            .returning();
          settings = inserted ?? null;
          created = true;
        }

        await appendWorkspaceControlEvidence(tx, {
          workspaceId: id,
          actor: actorFromContext(c),
          action: created ? 'WORKSPACE_SETTINGS_CREATED' : 'WORKSPACE_SETTINGS_UPDATED',
          target: id,
          evidenceType: created ? 'workspace_settings_created' : 'workspace_settings_updated',
          replayRef: `workspace:${id}:settings:${created ? 'created' : 'updated'}`,
          title: `Workspace settings ${created ? 'created' : 'updated'}`,
          summary: 'Workspace policy, budget, or model routing settings changed.',
          metadata: {
            workspaceId: id,
            changedSections: changedSections.length > 0 ? changedSections : ['defaultSettings'],
            created,
          },
        });

        return { status: created ? ('created' as const) : ('updated' as const), settings };
      })
      .catch(() => ({ status: 'failed' as const }));

    if (result.status === 'not_found') return c.json({ error: 'Workspace not found' }, 404);
    if (result.status === 'failed')
      return c.json({ error: 'Failed to update workspace settings' }, 500);

    return c.json(
      normalizeWorkspaceSettings(id, result.settings ?? null),
      result.status === 'created' ? 201 : 200,
    );
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

    const result = await deps.db
      .transaction(async (tx) => {
        const [updated] = await tx
          .update(workspaces)
          .set({ currentMode: mode, updatedAt: new Date() })
          .where(eq(workspaces.id, id))
          .returning();

        if (!updated) return null;

        await appendWorkspaceControlEvidence(tx, {
          workspaceId: id,
          actor: actorFromContext(c),
          action: 'WORKSPACE_MODE_CHANGED',
          target: id,
          evidenceType: 'workspace_mode_changed',
          replayRef: `workspace:${id}:mode:${mode}`,
          title: `Workspace mode changed: ${mode}`,
          summary: 'Workspace runtime mode was changed by an owner.',
          metadata: {
            workspaceId: id,
            mode,
          },
        });

        return updated;
      })
      .catch(() => undefined);

    if (result === null) return c.json({ error: 'Workspace not found' }, 404);
    if (result === undefined) return c.json({ error: 'Failed to change workspace mode' }, 500);

    const updated = result;
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

    const result = await deps.db
      .transaction(async (tx) => {
        // Verify workspace exists.
        const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
        if (!ws) return null;

        // Generate invite token. The token is returned to the caller and stored
        // only in the session row; evidence records contain redacted metadata.
        const randomPart = generateToken();
        const inviteToken = `${id}:${inviteRole}:${randomPart}`;

        // Store as a session row with 'invite' channel (7-day expiry).
        // Use a system user ID — the workspace owner's ID.
        await tx.insert(sessions).values({
          userId: ws.ownerId,
          token: `invite:${inviteToken}`,
          channel: 'invite',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        await appendWorkspaceControlEvidence(tx, {
          workspaceId: id,
          actor: actorFromContext(c),
          action: 'WORKSPACE_INVITE_CREATED',
          target: id,
          evidenceType: 'workspace_invite_created',
          replayRef: `workspace:${id}:invite`,
          title: `Workspace invite created for ${inviteRole}`,
          summary: 'Workspace invite was created with redacted token metadata.',
          metadata: {
            workspaceId: id,
            role: inviteRole,
            hasEmail: Boolean(email),
            expiresInDays: 7,
            inviteTokenRedacted: true,
          },
        });

        return { inviteToken };
      })
      .catch(() => undefined);

    if (result === null) return c.json({ error: 'Workspace not found' }, 404);
    if (result === undefined) return c.json({ error: 'Failed to create workspace invite' }, 500);

    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
    const inviteUrl = `${appUrl}/invite/${result.inviteToken}`;

    return c.json(
      {
        inviteUrl,
        inviteToken: result.inviteToken,
        role: inviteRole,
        expiresIn: '7 days',
        ...(email ? { sentTo: email } : {}),
      },
      201,
    );
  });

  return app;
}

type WorkspaceControlEvidenceInput = {
  workspaceId: string;
  actor: string;
  action: string;
  target: string;
  evidenceType: string;
  replayRef: string;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
};

async function appendWorkspaceControlEvidence(
  tx: Pick<GatewayDeps['db'], 'insert' | 'update'>,
  input: WorkspaceControlEvidenceInput,
) {
  const auditEventId = randomUUID();
  const metadata = {
    evidenceType: input.evidenceType,
    replayRef: input.replayRef,
    ...input.metadata,
  };

  await tx.insert(auditLog).values({
    id: auditEventId,
    workspaceId: input.workspaceId,
    action: input.action,
    actor: input.actor,
    target: input.target,
    verdict: 'allow',
    metadata,
  });

  const evidenceItemId = await appendEvidenceItem(tx, {
    workspaceId: input.workspaceId,
    auditEventId,
    evidenceType: input.evidenceType,
    sourceType: 'gateway_workspace_control',
    title: input.title,
    summary: input.summary,
    redactionState: 'redacted',
    sensitivity: 'internal',
    replayRef: input.replayRef,
    metadata: input.metadata,
  });

  await tx
    .update(auditLog)
    .set({
      metadata: {
        ...metadata,
        evidenceItemId,
      },
    })
    .where(and(eq(auditLog.workspaceId, input.workspaceId), eq(auditLog.id, auditEventId)));

  return evidenceItemId;
}

function actorFromContext(c: Context) {
  return `user:${(c.get('userId') as string | undefined) ?? 'unknown'}`;
}

function defaultWorkspaceSettings(workspaceId: string) {
  return {
    workspaceId,
    policyConfig: {
      killSwitch: false,
      maxIterationBudget: 50,
      toolBlocklist: [],
      contentBans: [],
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
    killSwitch: typeof config['killSwitch'] === 'boolean' ? config['killSwitch'] : false,
    maxIterationBudget: toNumber(config['maxIterationBudget'], 50),
    toolBlocklist: toStringArray(config['toolBlocklist'] ?? config['blockedTools']),
    contentBans: toStringArray(config['contentBans']),
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

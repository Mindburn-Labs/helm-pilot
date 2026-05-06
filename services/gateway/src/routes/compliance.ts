import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { appendEvidenceItem } from '@pilot/db';
import { auditLog, workspaces, complianceAttestations } from '@pilot/db/schema';
import {
  FRAMEWORKS,
  ComplianceFrameworkCodeSchema,
  type ComplianceFrameworkCode,
} from '@pilot/shared/compliance';
import { type GatewayDeps } from '../index.js';
import { requireWorkspaceRole } from '../lib/workspace.js';

// ─── Compliance routes (Phase 14 Track B) ───
//
// GET    /frameworks            — full catalog + workspace-enabled subset
// POST   /frameworks            — body: {code} → enable a framework
// DELETE /frameworks/:code      — disable a framework
// POST   /attest                — body: {framework} → fetch HELM bundle, persist attestation row
// GET    /attestations          — list attestation history for the workspace

export function complianceRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/frameworks', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view compliance frameworks');
    if (roleDenied) return roleDenied;
    const [ws] = await deps.db
      .select({ enabled: workspaces.complianceFrameworks })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return c.json({
      catalog: FRAMEWORKS,
      enabled: (ws?.enabled ?? []) as ComplianceFrameworkCode[],
    });
  });

  app.post('/frameworks', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'change compliance frameworks');
    if (roleDenied) return roleDenied;
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const parsed = ComplianceFrameworkCodeSchema.safeParse(body.code);
    if (!parsed.success) {
      return c.json({ error: 'invalid framework code' }, 400);
    }
    const result = await deps.db
      .transaction(async (tx) => {
        const [ws] = await tx
          .select({ enabled: workspaces.complianceFrameworks })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);
        if (!ws) return null;

        const next = Array.from(new Set([...(ws.enabled ?? []), parsed.data]));
        await tx
          .update(workspaces)
          .set({ complianceFrameworks: next, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId));

        await appendComplianceEvidence(tx, {
          workspaceId,
          actor: actorFromContext(c),
          action: 'COMPLIANCE_FRAMEWORK_ENABLED',
          target: parsed.data,
          evidenceType: 'compliance_framework_enabled',
          replayRef: `compliance:${workspaceId}:framework:${parsed.data}:enabled`,
          title: `Compliance framework enabled: ${parsed.data}`,
          summary: 'Workspace compliance framework configuration changed.',
          metadata: {
            framework: parsed.data,
            enabledCount: next.length,
          },
        });

        return { enabled: next };
      })
      .catch(() => undefined);

    if (result === null) return c.json({ error: 'workspace not found' }, 404);
    if (result === undefined) return c.json({ error: 'failed to enable framework' }, 500);

    const next = result.enabled;
    return c.json({ enabled: next });
  });

  app.delete('/frameworks/:code', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'change compliance frameworks');
    if (roleDenied) return roleDenied;
    const parsed = ComplianceFrameworkCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json({ error: 'invalid framework code' }, 400);
    const result = await deps.db
      .transaction(async (tx) => {
        const [ws] = await tx
          .select({ enabled: workspaces.complianceFrameworks })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);
        if (!ws) return null;

        const next = (ws.enabled ?? []).filter((code) => code !== parsed.data);
        await tx
          .update(workspaces)
          .set({ complianceFrameworks: next, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId));

        await appendComplianceEvidence(tx, {
          workspaceId,
          actor: actorFromContext(c),
          action: 'COMPLIANCE_FRAMEWORK_DISABLED',
          target: parsed.data,
          evidenceType: 'compliance_framework_disabled',
          replayRef: `compliance:${workspaceId}:framework:${parsed.data}:disabled`,
          title: `Compliance framework disabled: ${parsed.data}`,
          summary: 'Workspace compliance framework configuration changed.',
          metadata: {
            framework: parsed.data,
            enabledCount: next.length,
          },
        });

        return { enabled: next };
      })
      .catch(() => undefined);

    if (result === null) return c.json({ error: 'workspace not found' }, 404);
    if (result === undefined) return c.json({ error: 'failed to disable framework' }, 500);

    const next = result.enabled;
    return c.json({ enabled: next });
  });

  app.post('/attest', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'owner', 'create compliance attestations');
    if (roleDenied) return roleDenied;
    const body = (await c.req.json().catch(() => ({}))) as { framework?: string };
    const parsed = ComplianceFrameworkCodeSchema.safeParse(body.framework);
    if (!parsed.success) return c.json({ error: 'invalid framework code' }, 400);
    const framework = parsed.data;
    const meta = FRAMEWORKS.find((f) => f.code === framework);
    if (!meta) return c.json({ error: 'framework metadata missing' }, 500);

    let bundleHash: string | undefined;
    if (deps.helmClient) {
      try {
        const bundle = await deps.helmClient.exportSoc2(workspaceId);
        bundleHash = bundle.manifestHash;
      } catch (err) {
        return c.json(
          {
            error: 'helm bundle export failed',
            detail: err instanceof Error ? err.message : String(err),
          },
          502,
        );
      }
    }

    const expiresAt = new Date(Date.now() + meta.retentionDays * 24 * 60 * 60 * 1000);
    const row = await deps.db
      .transaction(async (tx) => {
        const [created] = await tx
          .insert(complianceAttestations)
          .values({
            workspaceId,
            framework,
            bundleHash: bundleHash ?? null,
            expiresAt,
            metadata: { trigger: 'manual' },
          })
          .returning();

        if (!created) return null;

        await appendComplianceEvidence(tx, {
          workspaceId,
          actor: actorFromContext(c),
          action: 'COMPLIANCE_ATTESTATION_CREATED',
          target: created.id,
          evidenceType: 'compliance_attestation_created',
          replayRef: `compliance:${workspaceId}:attestation:${created.id}`,
          title: `Compliance attestation created: ${framework}`,
          summary: 'Workspace compliance attestation was created.',
          metadata: {
            framework,
            attestationId: created.id,
            bundleHash: bundleHash ?? null,
            expiresAt: expiresAt.toISOString(),
          },
        });

        return created;
      })
      .catch(() => undefined);

    if (row === null || row === undefined) {
      return c.json({ error: 'failed to create compliance attestation' }, 500);
    }

    return c.json({ id: row?.id, framework, bundleHash, expiresAt });
  });

  app.get('/attestations', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view compliance attestations');
    if (roleDenied) return roleDenied;
    const rows = await deps.db
      .select()
      .from(complianceAttestations)
      .where(eq(complianceAttestations.workspaceId, workspaceId))
      .orderBy(desc(complianceAttestations.attestedAt))
      .limit(100);
    return c.json({ attestations: rows });
  });

  return app;
}

type ComplianceEvidenceInput = {
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

async function appendComplianceEvidence(
  tx: Pick<GatewayDeps['db'], 'insert' | 'update'>,
  input: ComplianceEvidenceInput,
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
    sourceType: 'gateway_compliance',
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

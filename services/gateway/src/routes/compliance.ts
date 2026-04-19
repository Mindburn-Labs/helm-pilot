import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { workspaces, complianceAttestations } from '@helm-pilot/db/schema';
import {
  FRAMEWORKS,
  ComplianceFrameworkCodeSchema,
  type ComplianceFrameworkCode,
} from '@helm-pilot/shared/compliance';
import { type GatewayDeps } from '../index.js';

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
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const parsed = ComplianceFrameworkCodeSchema.safeParse(body.code);
    if (!parsed.success) {
      return c.json({ error: 'invalid framework code' }, 400);
    }
    const [ws] = await deps.db
      .select({ enabled: workspaces.complianceFrameworks })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) return c.json({ error: 'workspace not found' }, 404);
    const next = Array.from(new Set([...(ws.enabled ?? []), parsed.data]));
    await deps.db
      .update(workspaces)
      .set({ complianceFrameworks: next, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
    return c.json({ enabled: next });
  });

  app.delete('/frameworks/:code', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const parsed = ComplianceFrameworkCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json({ error: 'invalid framework code' }, 400);
    const [ws] = await deps.db
      .select({ enabled: workspaces.complianceFrameworks })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) return c.json({ error: 'workspace not found' }, 404);
    const next = (ws.enabled ?? []).filter((code) => code !== parsed.data);
    await deps.db
      .update(workspaces)
      .set({ complianceFrameworks: next, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
    return c.json({ enabled: next });
  });

  app.post('/attest', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
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

    const expiresAt = new Date(
      Date.now() + meta.retentionDays * 24 * 60 * 60 * 1000,
    );
    const [row] = await deps.db
      .insert(complianceAttestations)
      .values({
        workspaceId,
        framework,
        bundleHash: bundleHash ?? null,
        expiresAt,
        metadata: { trigger: 'manual' },
      })
      .returning();
    return c.json({ id: row?.id, framework, bundleHash, expiresAt });
  });

  app.get('/attestations', async (c) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
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

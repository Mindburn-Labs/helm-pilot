import { Hono } from 'hono';
import { z } from 'zod';
import { getCapabilityRecord } from '@pilot/shared/capabilities';
import {
  PilotEvalRunRecordSchema,
  checkCapabilityPromotionReadiness,
  getPilotProductionEvalSuite,
} from '@pilot/shared/eval';
import { CapabilityKeySchema } from '@pilot/shared/capabilities';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole, workspaceIdMismatch } from '../lib/workspace.js';

const PromotionCheckInput = z.object({
  workspaceId: z.string().uuid().optional(),
  capabilityKey: CapabilityKeySchema,
  runs: z.array(PilotEvalRunRecordSchema).default([]),
});

export function evalRoutes(_deps: GatewayDeps) {
  const app = new Hono();

  app.get('/production-suite', (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'view production eval suite');
    if (roleDenied) return roleDenied;

    return c.json({
      workspaceId,
      productionReadyPromotionRule:
        'A capability cannot be promoted to production_ready unless its mapped eval run passed with evidenceRefs, auditReceiptRefs, and completedAt.',
      scenarios: getPilotProductionEvalSuite(),
    });
  });

  app.post('/promotion-check', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'check capability promotion readiness');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = PromotionCheckInput.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const capability = getCapabilityRecord(parsed.data.capabilityKey);
    if (!capability) return c.json({ error: 'Unknown capability' }, 404);

    const check = checkCapabilityPromotionReadiness({
      capability,
      runs: parsed.data.runs,
    });
    return c.json({ workspaceId, check }, 200);
  });

  return app;
}

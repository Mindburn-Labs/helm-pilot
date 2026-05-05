import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  capabilityPromotions,
  evalEvidenceLinks,
  evalResults,
  evalRuns,
  evalSteps,
  evaluations,
  tasks,
} from '@pilot/db/schema';
import {
  CapabilityKeySchema,
  getCapabilityRecord,
  type CapabilityKey,
  type CapabilityRecord,
} from '@pilot/shared/capabilities';
import {
  PilotEvalIdSchema,
  PilotEvalRunRecordSchema,
  PilotEvalStatusSchema,
  RecordPilotEvalRunInputSchema,
  checkCapabilityPromotionReadiness,
  getPilotProductionEvalSuite,
  type PilotEvalRunRecord,
} from '@pilot/shared/eval';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, requireWorkspaceRole, workspaceIdMismatch } from '../lib/workspace.js';

const ListEvalRunsQuery = z.object({
  evalId: PilotEvalIdSchema.optional(),
  capabilityKey: CapabilityKeySchema.optional(),
  status: PilotEvalStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const PromotionCheckInput = z.object({
  workspaceId: z.string().uuid().optional(),
  capabilityKey: CapabilityKeySchema,
  runs: z.array(PilotEvalRunRecordSchema).default([]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function toPilotEvalRunRecord(row: typeof evalRuns.$inferSelect): PilotEvalRunRecord {
  return PilotEvalRunRecordSchema.parse({
    evalId: row.evalId,
    workspaceId: row.workspaceId,
    status: row.status,
    capabilityKey: row.capabilityKey ?? undefined,
    evidenceRefs: stringArray(row.evidenceRefs),
    auditReceiptRefs: stringArray(row.auditReceiptRefs),
    runRef: row.runRef ?? undefined,
    failureReason: row.failureReason ?? undefined,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    completedAt: toIso(row.completedAt),
  });
}

function toEvalRunResponse(row: typeof evalRuns.$inferSelect) {
  return {
    id: row.id,
    ...toPilotEvalRunRecord(row),
    startedAt: toIso(row.startedAt),
    createdAt: toIso(row.createdAt),
  };
}

export function evalRoutes(deps: GatewayDeps) {
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

  app.get('/runs', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'list production eval runs');
    if (roleDenied) return roleDenied;

    const parsed = ListEvalRunsQuery.safeParse({
      evalId: c.req.query('evalId'),
      capabilityKey: c.req.query('capabilityKey'),
      status: c.req.query('status'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const clauses = [eq(evalRuns.workspaceId, workspaceId)];
    if (parsed.data.evalId) clauses.push(eq(evalRuns.evalId, parsed.data.evalId));
    if (parsed.data.capabilityKey) {
      clauses.push(eq(evalRuns.capabilityKey, parsed.data.capabilityKey));
    }
    if (parsed.data.status) clauses.push(eq(evalRuns.status, parsed.data.status));

    const rows = await deps.db
      .select()
      .from(evalRuns)
      .where(and(...clauses))
      .orderBy(desc(evalRuns.createdAt))
      .limit(parsed.data.limit);

    return c.json({ workspaceId, runs: rows.map(toEvalRunResponse) }, 200);
  });

  app.post('/runs', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'record production eval run');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = RecordPilotEvalRunInputSchema.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const scenario = getPilotProductionEvalSuite().find((item) => item.id === parsed.data.evalId);
    const defaultCapabilityKey = scenario?.capabilityKeys[0];
    const completedAt =
      parsed.data.completedAt ??
      (parsed.data.status === 'passed' || parsed.data.status === 'failed'
        ? new Date().toISOString()
        : undefined);

    if (scenario) {
      await deps.db
        .insert(evaluations)
        .values({
          evalId: scenario.id,
          name: scenario.name,
          capabilityKeys: scenario.capabilityKeys,
          scenario,
        })
        .onConflictDoUpdate({
          target: evaluations.evalId,
          set: {
            name: scenario.name,
            capabilityKeys: scenario.capabilityKeys,
            scenario,
          },
        });
    }

    const [created] = await deps.db
      .insert(evalRuns)
      .values({
        workspaceId,
        evalId: parsed.data.evalId,
        status: parsed.data.status,
        capabilityKey: parsed.data.capabilityKey ?? defaultCapabilityKey ?? null,
        runRef: parsed.data.runRef ?? null,
        failureReason: parsed.data.failureReason ?? parsed.data.summary ?? null,
        evidenceRefs: parsed.data.evidenceRefs,
        auditReceiptRefs: parsed.data.auditReceiptRefs,
        metadata: parsed.data.metadata,
        completedAt: completedAt ? new Date(completedAt) : null,
      })
      .returning();

    if (!created) return c.json({ error: 'eval run was not persisted' }, 500);

    if (parsed.data.steps.length > 0) {
      await deps.db.insert(evalSteps).values(
        parsed.data.steps.map((step) => ({
          evalRunId: created.id,
          stepKey: step.stepKey,
          status: step.status,
          evidenceRefs: step.evidenceRefs,
          auditReceiptRefs: step.auditReceiptRefs,
          metadata: step.metadata,
          completedAt: step.completedAt ? new Date(step.completedAt) : null,
        })),
      );
    }

    if (parsed.data.evidenceRefs.length > 0) {
      await deps.db.insert(evalEvidenceLinks).values(
        parsed.data.evidenceRefs.map((evidenceRef, index) => ({
          workspaceId,
          evalRunId: created.id,
          evidenceRef,
          auditReceiptRef: parsed.data.auditReceiptRefs[index] ?? null,
        })),
      );
    }

    const passed = parsed.data.status === 'passed';
    const blockers = passed
      ? []
      : [parsed.data.failureReason ?? parsed.data.summary ?? `${parsed.data.evalId} did not pass`];
    const [result] = await deps.db
      .insert(evalResults)
      .values({
        workspaceId,
        evalRunId: created.id,
        evalId: parsed.data.evalId,
        capabilityKey:
          created.capabilityKey ?? parsed.data.capabilityKey ?? defaultCapabilityKey ?? null,
        status: parsed.data.status,
        passed,
        summary: parsed.data.summary ?? parsed.data.failureReason ?? null,
        blockers,
      })
      .returning();

    let blockerTask: unknown;
    if (parsed.data.status === 'failed') {
      const [createdTask] = await deps.db
        .insert(tasks)
        .values({
          workspaceId,
          title: `[Eval Blocker] ${scenario?.name ?? parsed.data.evalId}`,
          description:
            parsed.data.failureReason ??
            parsed.data.summary ??
            `Production eval ${parsed.data.evalId} failed.`,
          mode: 'eval',
          status: 'pending',
          priority: 100,
          metadata: {
            kind: 'production_eval_blocker',
            productionReadyBlocked: true,
            evalId: parsed.data.evalId,
            evalRunId: created.id,
            capabilityKey: created.capabilityKey ?? parsed.data.capabilityKey ?? null,
          },
        })
        .returning();
      blockerTask = createdTask;
    }

    const runRecord = toPilotEvalRunRecord(created);
    const promotionChecks = passed
      ? (parsed.data.capabilityKey ? [parsed.data.capabilityKey] : (scenario?.capabilityKeys ?? []))
          .map((capabilityKey) => getCapabilityRecord(capabilityKey))
          .filter((capability): capability is CapabilityRecord => Boolean(capability))
          .map((capability) =>
            checkCapabilityPromotionReadiness({
              capability,
              runs: [{ ...runRecord, capabilityKey: capability.key }],
            }),
          )
      : [];
    const promotions = [];
    for (const check of promotionChecks) {
      if (!check.canPromote) continue;
      const [promotion] = await deps.db
        .insert(capabilityPromotions)
        .values({
          workspaceId,
          capabilityKey: check.capability.key,
          evalRunId: created.id,
          status: 'eligible',
          promotedState: 'production_ready',
          evidenceRefs: check.evidenceRefs,
          auditReceiptRefs: check.auditReceiptRefs,
        })
        .returning();
      if (promotion) promotions.push(promotion);
    }

    return c.json(
      {
        ...toEvalRunResponse(created),
        result,
        blockerTask,
        promotionChecks,
        promotions,
        productionReadyRegistryMutation: false,
      },
      201,
    );
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

    const persistedRows = await deps.db
      .select()
      .from(evalRuns)
      .where(
        and(
          eq(evalRuns.workspaceId, workspaceId),
          eq(evalRuns.capabilityKey, parsed.data.capabilityKey as CapabilityKey),
        ),
      )
      .orderBy(desc(evalRuns.createdAt))
      .limit(25);

    const persistedRuns = persistedRows.map(toPilotEvalRunRecord);
    const check = checkCapabilityPromotionReadiness({
      capability,
      runs: [...parsed.data.runs, ...persistedRuns],
    });
    return c.json({ workspaceId, check }, 200);
  });

  return app;
}

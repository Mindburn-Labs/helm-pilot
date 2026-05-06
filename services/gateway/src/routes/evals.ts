import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendEvidenceItem } from '@pilot/db';
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
  ExecutePilotEvalInputSchema,
  PilotEvalIdSchema,
  PilotEvalRunRecordSchema,
  PilotEvalStatusSchema,
  RecordPilotEvalRunInputSchema,
  checkCapabilityPromotionReadiness,
  executePilotProductionEval,
  getPilotProductionEvalSuite,
  type PilotEvalRunRecord,
  type RecordPilotEvalRunInput,
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

async function persistEvalRun(
  deps: GatewayDeps,
  workspaceId: string,
  input: RecordPilotEvalRunInput,
  extraResponse: Record<string, unknown> = {},
) {
  const scenario = getPilotProductionEvalSuite().find((item) => item.id === input.evalId);
  const defaultCapabilityKey = scenario?.capabilityKeys[0];
  const completedAt =
    input.completedAt ??
    (input.status === 'passed' || input.status === 'failed' ? new Date().toISOString() : undefined);

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
      evalId: input.evalId,
      status: input.status,
      capabilityKey: input.capabilityKey ?? defaultCapabilityKey ?? null,
      runRef: input.runRef ?? null,
      failureReason: input.failureReason ?? input.summary ?? null,
      evidenceRefs: input.evidenceRefs,
      auditReceiptRefs: input.auditReceiptRefs,
      metadata: input.metadata,
      completedAt: completedAt ? new Date(completedAt) : null,
    })
    .returning();

  if (!created) {
    return {
      status: 500 as const,
      body: { error: 'eval run was not persisted' },
    };
  }

  if (input.steps.length > 0) {
    await deps.db.insert(evalSteps).values(
      input.steps.map((step) => ({
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

  if (input.evidenceRefs.length > 0) {
    await deps.db.insert(evalEvidenceLinks).values(
      input.evidenceRefs.map((evidenceRef, index) => ({
        workspaceId,
        evalRunId: created.id,
        evidenceRef,
        auditReceiptRef: input.auditReceiptRefs[index] ?? null,
      })),
    );
  }

  const terminal = input.status === 'passed' || input.status === 'failed';
  const passed = input.status === 'passed';
  const blockers = passed
    ? []
    : [input.failureReason ?? input.summary ?? `${input.evalId} did not pass`];

  const evidenceItemIds: string[] = [];
  evidenceItemIds.push(
    await appendEvidenceItem(deps.db, {
      workspaceId,
      evidenceType: 'eval_run',
      sourceType: 'eval_harness',
      title: `Eval ${input.evalId}: ${input.status}`,
      summary: input.summary ?? input.failureReason ?? scenario?.name ?? input.evalId,
      redactionState: 'redacted',
      sensitivity: 'internal',
      replayRef: input.runRef ?? `eval:${created.id}`,
      observedAt: completedAt ? new Date(completedAt) : (created.createdAt ?? new Date()),
      metadata: {
        evalRunId: created.id,
        evalId: input.evalId,
        status: input.status,
        capabilityKey: created.capabilityKey ?? input.capabilityKey ?? defaultCapabilityKey ?? null,
        evidenceRefs: input.evidenceRefs,
        auditReceiptRefs: input.auditReceiptRefs,
        executionMode: extraResponse['executionMode'] ?? null,
      },
    }),
  );

  for (const [index, evidenceRef] of input.evidenceRefs.entries()) {
    evidenceItemIds.push(
      await appendEvidenceItem(deps.db, {
        workspaceId,
        evidenceType: 'eval_evidence_ref',
        sourceType: 'eval_harness',
        title: `Eval evidence: ${input.evalId}`,
        summary: evidenceRef,
        redactionState: 'redacted',
        sensitivity: 'internal',
        replayRef: evidenceRef,
        observedAt: completedAt ? new Date(completedAt) : (created.createdAt ?? new Date()),
        metadata: {
          evalRunId: created.id,
          evalId: input.evalId,
          capabilityKey:
            created.capabilityKey ?? input.capabilityKey ?? defaultCapabilityKey ?? null,
          evidenceRef,
          auditReceiptRef: input.auditReceiptRefs[index] ?? null,
        },
      }),
    );
  }

  let result: unknown;
  let blockerTask: unknown;
  const promotions = [];
  const runRecord = toPilotEvalRunRecord(created);
  const promotionChecks = [];
  if (passed) {
    const promotionCapabilities = (
      input.capabilityKey ? [input.capabilityKey] : (scenario?.capabilityKeys ?? [])
    )
      .map((capabilityKey) => getCapabilityRecord(capabilityKey))
      .filter((capability): capability is CapabilityRecord => Boolean(capability));

    for (const capability of promotionCapabilities) {
      const persistedRows = await deps.db
        .select()
        .from(evalRuns)
        .where(
          and(eq(evalRuns.workspaceId, workspaceId), eq(evalRuns.capabilityKey, capability.key)),
        )
        .orderBy(desc(evalRuns.createdAt))
        .limit(25);
      const persistedRuns = persistedRows
        .map(toPilotEvalRunRecord)
        .filter(
          (run) => run.evalId !== runRecord.evalId || run.completedAt !== runRecord.completedAt,
        );

      promotionChecks.push(
        checkCapabilityPromotionReadiness({
          capability,
          runs: [{ ...runRecord, capabilityKey: capability.key }, ...persistedRuns],
        }),
      );
    }
  }

  if (terminal) {
    const [createdResult] = await deps.db
      .insert(evalResults)
      .values({
        workspaceId,
        evalRunId: created.id,
        evalId: input.evalId,
        capabilityKey: created.capabilityKey ?? input.capabilityKey ?? defaultCapabilityKey ?? null,
        status: input.status,
        passed,
        summary: input.summary ?? input.failureReason ?? null,
        blockers,
      })
      .returning();
    result = createdResult;
    if (createdResult) {
      evidenceItemIds.push(
        await appendEvidenceItem(deps.db, {
          workspaceId,
          evidenceType: 'eval_result',
          sourceType: 'eval_harness',
          title: `Eval result ${input.evalId}: ${passed ? 'passed' : 'failed'}`,
          summary: input.summary ?? input.failureReason ?? null,
          redactionState: 'redacted',
          sensitivity: 'internal',
          replayRef: `eval-result:${createdResult.id}`,
          observedAt: created.completedAt ?? createdResult.createdAt ?? new Date(),
          metadata: {
            evalRunId: created.id,
            evalResultId: createdResult.id,
            evalId: input.evalId,
            status: input.status,
            passed,
            blockers,
            capabilityKey:
              created.capabilityKey ?? input.capabilityKey ?? defaultCapabilityKey ?? null,
          },
        }),
      );
    }
  }

  if (input.status === 'failed') {
    const [createdTask] = await deps.db
      .insert(tasks)
      .values({
        workspaceId,
        title: `[Eval Blocker] ${scenario?.name ?? input.evalId}`,
        description:
          input.failureReason ?? input.summary ?? `Production eval ${input.evalId} failed.`,
        mode: 'eval',
        status: 'pending',
        priority: 100,
        metadata: {
          kind: 'production_eval_blocker',
          productionReadyBlocked: true,
          evalId: input.evalId,
          evalRunId: created.id,
          capabilityKey: created.capabilityKey ?? input.capabilityKey ?? null,
        },
      })
      .returning();
    blockerTask = createdTask;
  }

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

  return {
    status: 201 as const,
    body: {
      ...toEvalRunResponse(created),
      result,
      blockerTask,
      promotionChecks,
      promotions,
      evidenceItemIds,
      productionReadyRegistryMutation: false,
      ...extraResponse,
    },
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
        'A capability cannot be promoted to production_ready unless every required eval run passed with evidenceRefs, auditReceiptRefs, and completedAt.',
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

    const persisted = await persistEvalRun(deps, workspaceId, parsed.data);
    return c.json(persisted.body, persisted.status);
  });

  app.post('/execute', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const roleDenied = requireWorkspaceRole(c, 'partner', 'execute production eval');
    if (roleDenied) return roleDenied;

    const raw = await c.req.json().catch(() => ({}));
    if (workspaceIdMismatch(c, (raw as { workspaceId?: string }).workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }

    const parsed = ExecutePilotEvalInputSchema.safeParse({
      ...(raw as Record<string, unknown>),
      workspaceId,
    });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const executed = executePilotProductionEval(parsed.data);
    const persisted = await persistEvalRun(deps, workspaceId, executed.run, {
      executionMode: executed.executionMode,
      executionBlockers: executed.blockers,
    });
    return c.json(persisted.body, persisted.status);
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

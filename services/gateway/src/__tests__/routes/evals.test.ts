import { describe, expect, it, vi } from 'vitest';
import {
  capabilityPromotions,
  evalEvidenceLinks,
  evalResults,
  evalRuns,
  evalSteps,
  evaluations,
  tasks,
} from '@pilot/db/schema';
import { getRequiredEvalForCapability } from '@pilot/shared/eval';
import { evalRoutes } from '../../routes/evals.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const foreignWorkspaceId = '00000000-0000-4000-8000-000000000099';
const wsHeader = { 'X-Workspace-Id': workspaceId };

function createEvalDb(selectResults: unknown[][] = []) {
  const inserts: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        const chain = {
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(async () => result),
          then: (resolve: (value: unknown[]) => void) => resolve(result),
        };
        return chain;
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        inserts.push({ table, value });
        return {
          onConflictDoUpdate: vi.fn(async () => []),
          returning: vi.fn(async () => {
            if (table === evalRuns) {
              return [
                {
                  id: 'eval-run-1',
                  workspaceId,
                  evalId: (value as { evalId?: string }).evalId,
                  status: (value as { status?: string }).status,
                  capabilityKey: (value as { capabilityKey?: string }).capabilityKey ?? null,
                  evidenceRefs: (value as { evidenceRefs?: string[] }).evidenceRefs ?? [],
                  auditReceiptRefs:
                    (value as { auditReceiptRefs?: string[] }).auditReceiptRefs ?? [],
                  metadata: (value as { metadata?: Record<string, unknown> }).metadata ?? {},
                  completedAt: (value as { completedAt?: Date | null }).completedAt ?? null,
                  startedAt: new Date('2026-05-05T00:00:00.000Z'),
                  createdAt: new Date('2026-05-05T00:00:00.000Z'),
                },
              ];
            }
            if (table === evalResults) {
              return [{ id: 'eval-result-1', ...(value as Record<string, unknown>) }];
            }
            if (table === tasks) {
              return [
                {
                  id: 'task-blocker-1',
                  title: (value as { title?: string }).title,
                  status: (value as { status?: string }).status,
                  metadata: (value as { metadata?: Record<string, unknown> }).metadata,
                },
              ];
            }
            if (table === capabilityPromotions) {
              return [{ id: 'promotion-1', ...(value as Record<string, unknown>) }];
            }
            return [];
          }),
        };
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
    execute: vi.fn(async () => [{ '?column?': 1 }]),
    _setResult: vi.fn(),
    _reset: vi.fn(),
  };

  return { db, inserts };
}

describe('evalRoutes', () => {
  it('requires workspace scope', async () => {
    const { fetch } = testApp(evalRoutes, createMockDeps());
    const res = await fetch('GET', '/production-suite');
    const body = await expectJson<{ error: string }>(res, 400);

    expect(body.error).toContain('workspaceId');
  });

  it('requires partner role', async () => {
    const { fetch } = testApp(evalRoutes, createMockDeps());
    const res = await fetch('GET', '/production-suite', undefined, {
      ...wsHeader,
      'X-Workspace-Role': 'member',
    });
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('partner');
  });

  it('returns the production autonomy eval suite', async () => {
    const { fetch } = testApp(evalRoutes, createMockDeps());
    const res = await fetch('GET', '/production-suite', undefined, wsHeader);
    const body = await expectJson<{
      productionReadyPromotionRule: string;
      scenarios: Array<{ id: string; name: string; evidenceRequirements: string[] }>;
    }>(res, 200);

    expect(body.productionReadyPromotionRule).toContain('passed with evidenceRefs');
    expect(body.scenarios.map((scenario) => scenario.name)).toContain('Full Startup Launch Eval');
    expect(body.scenarios.map((scenario) => scenario.name)).toContain(
      'YC Logged-In Browser Extraction Eval',
    );
    expect(body.scenarios.every((scenario) => scenario.evidenceRequirements.length > 0)).toBe(true);
  });

  it('lists persisted eval runs scoped to the workspace', async () => {
    const { db } = createEvalDb([
      [
        {
          evalId: 'helm_governance',
          workspaceId,
          status: 'passed',
          capabilityKey: 'helm_receipts',
          evidenceRefs: ['evidence:helm'],
          auditReceiptRefs: ['audit:helm'],
          metadata: {},
          completedAt: new Date('2026-05-05T00:00:00.000Z'),
        },
      ],
    ]);
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));

    const res = await fetch('GET', '/runs', undefined, wsHeader);
    const body = await expectJson<{ runs: Array<{ evalId: string; workspaceId: string }> }>(
      res,
      200,
    );

    expect(body.runs).toEqual([
      expect.objectContaining({
        evalId: 'helm_governance',
        workspaceId,
      }),
    ]);
  });

  it('records a failed eval and creates a blocker task', async () => {
    const { db, inserts } = createEvalDb();
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));

    const res = await fetch(
      'POST',
      '/runs',
      {
        evalId: 'helm_governance',
        status: 'failed',
        capabilityKey: 'helm_receipts',
        failureReason: 'receipt sink write failed under restricted action',
      },
      wsHeader,
    );
    const body = await expectJson<{
      result: { passed: boolean; blockers: string[] };
      blockerTask: { id: string; title: string };
      productionReadyRegistryMutation: boolean;
    }>(res, 201);

    expect(body.result.passed).toBe(false);
    expect(body.result.blockers.join(' ')).toContain('receipt sink');
    expect(body.blockerTask.title).toContain('HELM Governance Eval');
    expect(body.productionReadyRegistryMutation).toBe(false);
    expect(inserts.find((insert) => insert.table === evaluations)?.value).toMatchObject({
      evalId: 'helm_governance',
    });
    expect(inserts.find((insert) => insert.table === evalRuns)?.value).toMatchObject({
      workspaceId,
      evalId: 'helm_governance',
      status: 'failed',
    });
    expect(inserts.find((insert) => insert.table === evalResults)?.value).toMatchObject({
      passed: false,
    });
    expect(inserts.find((insert) => insert.table === tasks)?.value).toMatchObject({
      mode: 'eval',
      status: 'pending',
      priority: 100,
      metadata: expect.objectContaining({
        kind: 'production_eval_blocker',
        productionReadyBlocked: true,
      }),
    });
  });

  it('records a passed eval pack and writes promotion eligibility, not registry state', async () => {
    const { db, inserts } = createEvalDb();
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));

    const res = await fetch(
      'POST',
      '/runs',
      {
        evalId: 'helm_governance',
        status: 'passed',
        capabilityKey: 'helm_receipts',
        evidenceRefs: ['evidence:helm-governance'],
        auditReceiptRefs: ['audit:helm-governance'],
        steps: [
          {
            stepKey: 'restricted-action-denial',
            status: 'passed',
            evidenceRefs: ['evidence:restricted-denial'],
            auditReceiptRefs: ['audit:restricted-denial'],
            completedAt: '2026-05-05T00:00:00.000Z',
          },
        ],
      },
      wsHeader,
    );
    const body = await expectJson<{
      promotionChecks: Array<{ canPromote: boolean; capability: { key: string } }>;
      promotions: Array<{ capabilityKey: string; promotedState: string; status: string }>;
      productionReadyRegistryMutation: boolean;
    }>(res, 201);

    expect(body.promotionChecks).toEqual([
      expect.objectContaining({
        canPromote: true,
        capability: expect.objectContaining({ key: 'helm_receipts' }),
      }),
    ]);
    expect(body.promotions).toEqual([
      expect.objectContaining({
        capabilityKey: 'helm_receipts',
        promotedState: 'production_ready',
        status: 'eligible',
      }),
    ]);
    expect(body.productionReadyRegistryMutation).toBe(false);
    expect(inserts.find((insert) => insert.table === evalSteps)?.value).toEqual([
      expect.objectContaining({ stepKey: 'restricted-action-denial', status: 'passed' }),
    ]);
    expect(inserts.find((insert) => insert.table === evalEvidenceLinks)?.value).toEqual([
      expect.objectContaining({
        workspaceId,
        evalRunId: 'eval-run-1',
        evidenceRef: 'evidence:helm-governance',
        auditReceiptRef: 'audit:helm-governance',
      }),
    ]);
    expect(inserts.find((insert) => insert.table === capabilityPromotions)?.value).toMatchObject({
      capabilityKey: 'helm_receipts',
      promotedState: 'production_ready',
      status: 'eligible',
    });
  });

  it('executes a production eval proof check and fails closed when proof is missing', async () => {
    const { db, inserts } = createEvalDb();
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));

    const res = await fetch(
      'POST',
      '/execute',
      {
        evalId: 'helm_governance',
        capabilityKey: 'helm_receipts',
      },
      wsHeader,
    );
    const body = await expectJson<{
      executionMode: string;
      executionBlockers: string[];
      result: { passed: boolean; blockers: string[] };
      blockerTask: { id: string; title: string };
    }>(res, 201);

    expect(body.executionMode).toBe('control_plane_proof_check');
    expect(body.result.passed).toBe(false);
    expect(body.executionBlockers.join(' ')).toContain('No evidence references');
    expect(body.blockerTask.title).toContain('HELM Governance Eval');
    expect(inserts.find((insert) => insert.table === evalRuns)?.value).toMatchObject({
      status: 'failed',
      capabilityKey: 'helm_receipts',
    });
    expect(inserts.find((insert) => insert.table === tasks)?.value).toMatchObject({
      metadata: expect.objectContaining({
        kind: 'production_eval_blocker',
        productionReadyBlocked: true,
      }),
    });
  });

  it('executes a production eval proof check and writes eligibility only when coverage is complete', async () => {
    const scenario = getRequiredEvalForCapability('helm_receipts');
    if (!scenario) throw new Error('helm_receipts eval missing');
    const { db, inserts } = createEvalDb();
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));

    const res = await fetch(
      'POST',
      '/execute',
      {
        evalId: scenario.id,
        capabilityKey: 'helm_receipts',
        evidenceRefs: ['evidence:helm-governance'],
        auditReceiptRefs: ['audit:helm-governance'],
        evidenceCoverage: scenario.evidenceRequirements,
        auditCoverage: scenario.auditRequirements,
        completedAt: '2026-05-05T00:00:00.000Z',
      },
      wsHeader,
    );
    const body = await expectJson<{
      executionBlockers: string[];
      result: { passed: boolean };
      promotions: Array<{ capabilityKey: string; promotedState: string; status: string }>;
      productionReadyRegistryMutation: boolean;
    }>(res, 201);

    expect(body.executionBlockers).toEqual([]);
    expect(body.result.passed).toBe(true);
    expect(body.promotions).toEqual([
      expect.objectContaining({
        capabilityKey: 'helm_receipts',
        promotedState: 'production_ready',
        status: 'eligible',
      }),
    ]);
    expect(body.productionReadyRegistryMutation).toBe(false);
    expect(inserts.find((insert) => insert.table === evalEvidenceLinks)?.value).toEqual([
      expect.objectContaining({
        evidenceRef: 'evidence:helm-governance',
        auditReceiptRef: 'audit:helm-governance',
      }),
    ]);
  });

  it('blocks production promotion without a matching passed eval pack', async () => {
    const { fetch } = testApp(evalRoutes, createMockDeps());
    const res = await fetch(
      'POST',
      '/promotion-check',
      {
        capabilityKey: 'startup_lifecycle',
        runs: [],
      },
      wsHeader,
    );
    const body = await expectJson<{
      check: { canPromote: boolean; requiredEval: string; blockers: string[] };
    }>(res, 200);

    expect(body.check.canPromote).toBe(false);
    expect(body.check.requiredEval).toBe('Full Startup Launch Eval');
    expect(body.check.blockers.join(' ')).toContain('No eval run submitted');
  });

  it('uses persisted eval runs when promotion-check has no matching submitted run', async () => {
    const { db } = createEvalDb([
      [
        {
          evalId: 'full_startup_launch',
          workspaceId,
          status: 'passed',
          capabilityKey: 'startup_lifecycle',
          evidenceRefs: ['evidence:startup-launch'],
          auditReceiptRefs: ['audit:startup-launch'],
          metadata: {},
          completedAt: new Date('2026-05-05T00:00:00.000Z'),
        },
      ],
    ]);
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));
    const res = await fetch(
      'POST',
      '/promotion-check',
      {
        capabilityKey: 'startup_lifecycle',
      },
      wsHeader,
    );
    const body = await expectJson<{
      check: {
        canPromote: boolean;
        matchedEvalId: string;
        evidenceRefs: string[];
        auditReceiptRefs: string[];
      };
    }>(res, 200);

    expect(body.check.canPromote).toBe(true);
    expect(body.check.matchedEvalId).toBe('full_startup_launch');
    expect(body.check.evidenceRefs).toEqual(['evidence:startup-launch']);
    expect(body.check.auditReceiptRefs).toEqual(['audit:startup-launch']);
  });

  it('rejects foreign workspace ids on eval mutation', async () => {
    const { db } = createEvalDb();
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));

    const res = await fetch(
      'POST',
      '/runs',
      {
        workspaceId: foreignWorkspaceId,
        evalId: 'helm_governance',
        status: 'failed',
        failureReason: 'wrong workspace',
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 403);

    expect(body.error).toContain('workspaceId does not match');
  });

  it('rejects passed eval runs without evidence and audit receipts', async () => {
    const { db } = createEvalDb();
    const { fetch } = testApp(evalRoutes, createMockDeps({ db: db as never }));

    const res = await fetch(
      'POST',
      '/runs',
      {
        evalId: 'helm_governance',
        status: 'passed',
        capabilityKey: 'helm_receipts',
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 400);

    expect(body.error).toBe('Validation failed');
  });
});

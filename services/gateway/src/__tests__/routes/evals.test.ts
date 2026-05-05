import { describe, expect, it } from 'vitest';
import { evalRoutes } from '../../routes/evals.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const wsHeader = { 'X-Workspace-Id': workspaceId };

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

  it('allows promotion check only when eval passed with evidence and audit receipts', async () => {
    const { fetch } = testApp(evalRoutes, createMockDeps());
    const res = await fetch(
      'POST',
      '/promotion-check',
      {
        capabilityKey: 'startup_lifecycle',
        runs: [
          {
            evalId: 'full_startup_launch',
            workspaceId,
            status: 'passed',
            capabilityKey: 'startup_lifecycle',
            evidenceRefs: ['evidence:startup-launch'],
            auditReceiptRefs: ['audit:startup-launch'],
            completedAt: '2026-05-05T00:00:00.000Z',
          },
        ],
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
});

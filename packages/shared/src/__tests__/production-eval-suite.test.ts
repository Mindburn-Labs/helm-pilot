import { describe, expect, it } from 'vitest';
import { capabilityKeyValues, getCapabilityRecord } from '../capabilities/index.js';
import {
  checkCapabilityPromotionReadiness,
  getPilotProductionEvalSuite,
  getRequiredEvalForCapability,
  RecordPilotEvalRunInputSchema,
} from '../eval/index.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('production eval suite', () => {
  it('defines the required production autonomy evals with evidence and audit requirements', () => {
    const suite = getPilotProductionEvalSuite();
    const names = new Set(suite.map((scenario) => scenario.name));

    expect(names).toContain('Full Startup Launch Eval');
    expect(names).toContain('YC Logged-In Browser Extraction Eval');
    expect(names).toContain('Domain-to-Deployment Eval');
    expect(names).toContain('Stripe Setup Prep Eval');
    expect(names).toContain('Company Formation Prep Eval');
    expect(names).toContain('PMF Discovery Eval');
    expect(names).toContain('Multi-Agent Parallel Build Eval');
    expect(names).toContain('HELM Governance Eval');
    expect(names).toContain('Recovery Eval');
    expect(names).toContain('Founder-Off-Grid Eval');

    for (const scenario of suite) {
      expect(scenario.capabilityKeys.length).toBeGreaterThan(0);
      expect(scenario.requiredHelmPolicies.length).toBeGreaterThan(0);
      expect(scenario.successCriteria.length).toBeGreaterThan(0);
      expect(scenario.failureCriteria.length).toBeGreaterThan(0);
      expect(scenario.evidenceRequirements.length).toBeGreaterThan(0);
      expect(scenario.auditRequirements.length).toBeGreaterThan(0);
    }
  });

  it('maps every capability key to at least one production eval scenario', () => {
    for (const key of capabilityKeyValues) {
      expect(getRequiredEvalForCapability(key)?.id, key).toBeTruthy();
    }
  });

  it('blocks promotion without a matching passed eval run, evidence, and audit receipt', () => {
    const capability = getCapabilityRecord('startup_lifecycle');
    if (!capability) throw new Error('startup_lifecycle capability missing');

    expect(checkCapabilityPromotionReadiness({ capability, runs: [] }).canPromote).toBe(false);

    const failedEvidence = checkCapabilityPromotionReadiness({
      capability,
      runs: [
        {
          evalId: 'full_startup_launch',
          workspaceId,
          status: 'passed',
          capabilityKey: 'startup_lifecycle',
          evidenceRefs: [],
          auditReceiptRefs: ['audit:1'],
          metadata: {},
          completedAt: '2026-05-05T00:00:00.000Z',
        },
      ],
    });
    expect(failedEvidence.canPromote).toBe(false);
    expect(failedEvidence.blockers.join(' ')).toContain('evidence');

    const passed = checkCapabilityPromotionReadiness({
      capability,
      runs: [
        {
          evalId: 'full_startup_launch',
          workspaceId,
          status: 'passed',
          capabilityKey: 'startup_lifecycle',
          evidenceRefs: ['evidence:startup-launch'],
          auditReceiptRefs: ['audit:startup-launch'],
          metadata: {},
          completedAt: '2026-05-05T00:00:00.000Z',
        },
      ],
    });

    expect(passed.canPromote).toBe(true);
    expect(passed.matchedEvalId).toBe('full_startup_launch');
  });

  it('validates recordable eval runs before promotion checks can use them', () => {
    expect(
      RecordPilotEvalRunInputSchema.safeParse({
        evalId: 'helm_governance',
        status: 'passed',
        evidenceRefs: ['evidence:helm'],
        auditReceiptRefs: ['audit:helm'],
      }).success,
    ).toBe(true);

    const missingEvidence = RecordPilotEvalRunInputSchema.safeParse({
      evalId: 'helm_governance',
      status: 'passed',
      evidenceRefs: [],
      auditReceiptRefs: ['audit:helm'],
    });
    expect(missingEvidence.success).toBe(false);

    const failedWithoutReason = RecordPilotEvalRunInputSchema.safeParse({
      evalId: 'helm_governance',
      status: 'failed',
    });
    expect(failedWithoutReason.success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { capabilityKeyValues, getCapabilityRecord } from '../capabilities/index.js';
import {
  checkCapabilityPromotionReadiness,
  executePilotProductionEval,
  getPilotProductionEvalSuite,
  getRequiredEvalForCapability,
  getRequiredEvalsForCapability,
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

  it('uses explicit required eval mappings for ambiguous capability ownership', () => {
    expect(getRequiredEvalsForCapability('evidence_ledger').map((scenario) => scenario.id)).toEqual(
      ['helm_governance', 'recovery'],
    );
    expect(getRequiredEvalForCapability('computer_use')?.id).toBe('safe_computer_sandbox_action');
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

  it('requires every mapped eval before evidence ledger promotion is eligible', () => {
    const capability = getCapabilityRecord('evidence_ledger');
    if (!capability) throw new Error('evidence_ledger capability missing');

    const onlyHelm = checkCapabilityPromotionReadiness({
      capability,
      runs: [
        {
          evalId: 'helm_governance',
          workspaceId,
          status: 'passed',
          capabilityKey: 'evidence_ledger',
          evidenceRefs: ['evidence:helm'],
          auditReceiptRefs: ['audit:helm'],
          metadata: {},
          completedAt: '2026-05-05T00:00:00.000Z',
        },
      ],
    });

    expect(onlyHelm.canPromote).toBe(false);
    expect(onlyHelm.requiredEvals).toEqual(['HELM Governance Eval', 'Recovery Eval']);
    expect(onlyHelm.blockers.join(' ')).toContain('Recovery Eval');

    const bothRequired = checkCapabilityPromotionReadiness({
      capability,
      runs: [
        {
          evalId: 'helm_governance',
          workspaceId,
          status: 'passed',
          capabilityKey: 'evidence_ledger',
          evidenceRefs: ['evidence:helm'],
          auditReceiptRefs: ['audit:helm'],
          metadata: {},
          completedAt: '2026-05-05T00:00:00.000Z',
        },
        {
          evalId: 'recovery',
          workspaceId,
          status: 'passed',
          capabilityKey: 'evidence_ledger',
          evidenceRefs: ['evidence:recovery'],
          auditReceiptRefs: ['audit:recovery'],
          metadata: {},
          completedAt: '2026-05-05T00:00:01.000Z',
        },
      ],
    });

    expect(bothRequired.canPromote).toBe(true);
    expect(bothRequired.matchedEvalIds).toEqual(['helm_governance', 'recovery']);
    expect(bothRequired.evidenceRefs).toEqual(['evidence:helm', 'evidence:recovery']);
    expect(bothRequired.auditReceiptRefs).toEqual(['audit:helm', 'audit:recovery']);
  });

  it('does not promote mission runtime from the startup launch eval alone', () => {
    const capability = getCapabilityRecord('mission_runtime');
    if (!capability) throw new Error('mission_runtime capability missing');

    const check = checkCapabilityPromotionReadiness({
      capability,
      runs: [
        {
          evalId: 'full_startup_launch',
          workspaceId,
          status: 'passed',
          capabilityKey: 'mission_runtime',
          evidenceRefs: ['evidence:startup-launch'],
          auditReceiptRefs: ['audit:startup-launch'],
          metadata: {},
          completedAt: '2026-05-05T00:00:00.000Z',
        },
      ],
    });

    expect(check.canPromote).toBe(false);
    expect(check.requiredEvals).toEqual([
      'Full Startup Launch Eval',
      'Multi-Agent Parallel Build Eval',
    ]);
    expect(check.blockers.join(' ')).toContain('Multi-Agent Parallel Build Eval');
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

  it('executes a control-plane production eval and fails closed without proof coverage', () => {
    const executed = executePilotProductionEval({
      evalId: 'helm_governance',
      capabilityKey: 'helm_receipts',
      completedAt: '2026-05-05T00:00:00.000Z',
    });

    expect(executed.executionMode).toBe('control_plane_proof_check');
    expect(executed.run.status).toBe('failed');
    expect(executed.blockers.join(' ')).toContain('No evidence references');
    expect(executed.blockers.join(' ')).toContain('Missing evidence coverage');
  });

  it('executes a control-plane production eval and only passes with evidence and audit coverage', () => {
    const scenario = getRequiredEvalForCapability('helm_receipts');
    if (!scenario) throw new Error('helm_receipts eval missing');

    const executed = executePilotProductionEval({
      evalId: scenario.id,
      capabilityKey: 'helm_receipts',
      evidenceRefs: ['evidence:helm-governance'],
      auditReceiptRefs: ['audit:helm-governance'],
      evidenceCoverage: scenario.evidenceRequirements,
      auditCoverage: scenario.auditRequirements,
      completedAt: '2026-05-05T00:00:00.000Z',
    });

    expect(executed.run.status).toBe('passed');
    expect(executed.blockers).toEqual([]);
    expect(executed.run.metadata['executionMode']).toBe('control_plane_proof_check');
  });
});

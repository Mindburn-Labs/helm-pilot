import { describe, expect, it } from 'vitest';
import {
  ConformanceError,
  validateL1,
  validateL1Batch,
  validateL2,
  type EvidencePackLite,
} from '../conformance/index.js';

// ─── Conformance tests (Phase 15 Track M) ───

function pack(overrides: Partial<EvidencePackLite> = {}): EvidencePackLite {
  return {
    id: 'p-1',
    decisionId: 'dec-1',
    verdict: 'ALLOW',
    policyVersion: 'v1.0.0',
    action: 'TOOL_USE',
    resource: 'search_knowledge',
    principal: 'workspace:ws-1/operator:growth',
    receivedAt: '2026-04-20T12:00:00.000Z',
    decisionHash: 'a'.repeat(64),
    signedBlob: {},
    parentEvidencePackId: null,
    taskRunId: 'tr-1',
    ...overrides,
  };
}

describe('validateL1', () => {
  it('passes a well-formed pack', () => {
    const r = validateL1(pack());
    expect(r.level).toBe('L1');
    expect(r.passed).toBe(true);
    expect(r.findings.filter((f) => f.level === 'error')).toEqual([]);
  });

  it('fails on missing required field', () => {
    const r = validateL1(pack({ policyVersion: '' }));
    expect(r.passed).toBe(false);
    expect(
      r.findings.some((f) => f.code === 'l1.missing_field' && f.field === 'policyVersion'),
    ).toBe(true);
  });

  it('fails on invalid verdict', () => {
    const r = validateL1(pack({ verdict: 'MAYBE' as never }));
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'l1.invalid_verdict')).toBe(true);
  });

  it('fails on malformed decisionHash', () => {
    const r = validateL1(pack({ decisionHash: 'NOT-HEX' }));
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'l1.invalid_decision_hash')).toBe(true);
  });

  it('warns (not errors) when decisionHash is null', () => {
    const r = validateL1(pack({ decisionHash: null }));
    expect(r.passed).toBe(true);
    expect(
      r.findings.some((f) => f.code === 'l1.decision_hash_absent' && f.level === 'warn'),
    ).toBe(true);
  });

  it('enforces signature when requireSignature=true', () => {
    const r = validateL1(pack({ signedBlob: null }), { requireSignature: true });
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'l1.unsigned_pack')).toBe(true);
  });

  it('throws ConformanceError on non-object input', () => {
    expect(() => validateL1(null as unknown as EvidencePackLite)).toThrow(ConformanceError);
  });
});

describe('validateL1Batch', () => {
  it('aggregates pass/fail counts', () => {
    const good = pack({ id: 'p-1', decisionId: 'd-1' });
    const bad = pack({ id: 'p-2', decisionId: 'd-2', verdict: 'X' as never });
    const r = validateL1Batch([good, bad]);
    expect(r.total).toBe(2);
    expect(r.passedCount).toBe(1);
    expect(r.failedCount).toBe(1);
    expect(r.passed).toBe(false);
  });
});

describe('validateL2', () => {
  it('passes a clean parent chain', () => {
    const root = pack({ id: 'p-root', decisionId: 'd-root' });
    const child = pack({
      id: 'p-child',
      decisionId: 'd-child',
      parentEvidencePackId: 'p-root',
      receivedAt: '2026-04-20T12:01:00.000Z',
    });
    const r = validateL2([root, child]);
    expect(r.level).toBe('L2');
    expect(r.passed).toBe(true);
  });

  it('fails on orphan parent reference', () => {
    const p = pack({ id: 'p-1', parentEvidencePackId: 'nonexistent' });
    const r = validateL2([p]);
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'l2.orphan_parent_ref')).toBe(true);
  });

  it('fails on duplicate decisionId', () => {
    const a = pack({ id: 'p-a', decisionId: 'dup' });
    const b = pack({ id: 'p-b', decisionId: 'dup' });
    const r = validateL2([a, b]);
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'l2.duplicate_decision_id')).toBe(true);
  });

  it('detects parent-chain cycles', () => {
    const a = pack({ id: 'p-a', decisionId: 'd-a', parentEvidencePackId: 'p-b' });
    const b = pack({ id: 'p-b', decisionId: 'd-b', parentEvidencePackId: 'p-a' });
    const r = validateL2([a, b]);
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'l2.parent_cycle')).toBe(true);
  });

  it('warns on timestamp regression (child before parent)', () => {
    const parent = pack({
      id: 'p-parent',
      decisionId: 'd-parent',
      receivedAt: '2026-04-20T12:05:00.000Z',
    });
    const child = pack({
      id: 'p-child',
      decisionId: 'd-child',
      parentEvidencePackId: 'p-parent',
      receivedAt: '2026-04-20T12:00:00.000Z',
    });
    const r = validateL2([parent, child]);
    expect(r.passed).toBe(true); // warn, not error
    expect(r.findings.some((f) => f.code === 'l2.timestamp_regression')).toBe(true);
  });

  it('throws on non-array input', () => {
    expect(() => validateL2({} as unknown as EvidencePackLite[])).toThrow(ConformanceError);
  });
});

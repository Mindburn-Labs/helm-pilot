import {
  ConformanceError,
  type EvidencePackLite,
  type ValidationFinding,
  type ValidationResult,
} from './types.js';

// ─── L1 — structural integrity (Phase 15 Track M) ───
//
// Validates that an evidence pack row has the shape a downstream
// verifier can rely on. Runs synchronously over a single row; callers
// (orchestrator, certify-subagent script) apply it to every row they
// emit.
//
// L1 asserts:
//   - All required scalar fields are non-empty.
//   - `verdict` is one of ALLOW|DENY|ESCALATE.
//   - `decisionHash`, when present, is lowercase hex ≥ 32 chars.
//   - `receivedAt` parses to a valid Date.
//   - `signedBlob` present (when caller opts in with requireSignature).

const HEX32 = /^[0-9a-f]{32,}$/;

const REQUIRED_STRING_FIELDS: Array<
  keyof Pick<
    EvidencePackLite,
    'id' | 'decisionId' | 'policyVersion' | 'action' | 'resource' | 'principal'
  >
> = ['id', 'decisionId', 'policyVersion', 'action', 'resource', 'principal'];

const ALLOWED_VERDICTS: ReadonlyArray<string> = ['ALLOW', 'DENY', 'ESCALATE'];

export interface L1Options {
  /** When true, missing signedBlob produces an error finding. Default false. */
  requireSignature?: boolean;
}

export function validateL1(
  pack: EvidencePackLite,
  opts: L1Options = {},
): ValidationResult {
  if (!pack || typeof pack !== 'object') {
    throw new ConformanceError(
      'validateL1 requires an evidence pack object',
      'invalid_input',
    );
  }
  const findings: ValidationFinding[] = [];

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = pack[field];
    if (typeof value !== 'string' || value.length === 0) {
      findings.push({
        code: 'l1.missing_field',
        level: 'error',
        message: `${String(field)} must be a non-empty string`,
        field: String(field),
      });
    }
  }

  if (!ALLOWED_VERDICTS.includes(pack.verdict as string)) {
    findings.push({
      code: 'l1.invalid_verdict',
      level: 'error',
      message: `verdict must be one of ${ALLOWED_VERDICTS.join(', ')} (got ${String(
        pack.verdict,
      )})`,
      field: 'verdict',
    });
  }

  if (pack.decisionHash != null) {
    if (typeof pack.decisionHash !== 'string' || !HEX32.test(pack.decisionHash)) {
      findings.push({
        code: 'l1.invalid_decision_hash',
        level: 'error',
        message:
          'decisionHash must be lowercase hex of length ≥ 32 when present',
        field: 'decisionHash',
      });
    }
  } else {
    findings.push({
      code: 'l1.decision_hash_absent',
      level: 'warn',
      message: 'decisionHash is null — pack cannot be rehashed for replay',
      field: 'decisionHash',
    });
  }

  const receivedDate =
    pack.receivedAt instanceof Date
      ? pack.receivedAt
      : new Date(pack.receivedAt as string);
  if (Number.isNaN(receivedDate.getTime())) {
    findings.push({
      code: 'l1.invalid_received_at',
      level: 'error',
      message: 'receivedAt must be a valid Date or ISO-8601 string',
      field: 'receivedAt',
    });
  }

  if (
    opts.requireSignature &&
    (pack.signedBlob === null || pack.signedBlob === undefined)
  ) {
    findings.push({
      code: 'l1.unsigned_pack',
      level: 'error',
      message: 'signedBlob is required but absent',
      field: 'signedBlob',
    });
  }

  const passed = !findings.some((f) => f.level === 'error');
  return { level: 'L1', passed, findings };
}

/**
 * Aggregate L1 validation over an array of packs. Returns a summary
 * result plus the per-pack findings keyed by pack.id.
 */
export function validateL1Batch(
  packs: EvidencePackLite[],
  opts: L1Options = {},
): {
  passed: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  perPack: Record<string, ValidationResult>;
} {
  const perPack: Record<string, ValidationResult> = {};
  let passedCount = 0;
  for (const pack of packs) {
    const result = validateL1(pack, opts);
    perPack[pack.id ?? `__unknown_${Object.keys(perPack).length}`] = result;
    if (result.passed) passedCount++;
  }
  return {
    passed: passedCount === packs.length,
    total: packs.length,
    passedCount,
    failedCount: packs.length - passedCount,
    perPack,
  };
}

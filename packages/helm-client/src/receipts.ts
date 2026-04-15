import type { HelmReceipt, HelmVerdict } from './types.js';

/**
 * Parse governance receipt headers from a HELM response.
 *
 * HELM attaches these on every 2xx AND 4xx/403 response so the client can
 * record the decision regardless of outcome.
 */
export function parseReceiptHeaders(
  headers: Headers,
  ctx: { action: string; resource: string; principal: string; reason?: string },
): HelmReceipt | null {
  const decisionId = headers.get('x-helm-decision-id');
  const verdictRaw = headers.get('x-helm-verdict');
  const policyVersion = headers.get('x-helm-policy-version');
  const decisionHash = headers.get('x-helm-decision-hash') ?? undefined;

  if (!decisionId || !verdictRaw || !policyVersion) {
    return null;
  }

  const verdict = normalizeVerdict(verdictRaw);
  if (!verdict) return null;

  return {
    decisionId,
    verdict,
    policyVersion,
    decisionHash,
    receivedAt: new Date(),
    action: ctx.action,
    resource: ctx.resource,
    principal: ctx.principal,
    reason: ctx.reason,
  };
}

/**
 * HELM emits verdicts in multiple casings across responses. Normalize to the
 * canonical ALLOW/DENY/ESCALATE form used throughout HELM Pilot.
 */
export function normalizeVerdict(raw: string): HelmVerdict | null {
  const v = raw.trim().toUpperCase();
  if (v === 'ALLOW' || v === 'DENY' || v === 'ESCALATE') return v;
  return null;
}

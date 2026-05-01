import { type PolicyConfig, type TrustBoundaryResult, type Verdict } from '@helm-pilot/shared';
import { createHash } from 'node:crypto';

/**
 * Trust Boundary — fail-closed policy enforcement.
 *
 * Ported from money-engine/hooks/pretooluse.py.
 * Check chain: kill_switch → policy_valid → tool_blocklist → budget → connector → content → approval
 *
 * Invariant: if ANY check fails or errors, the verdict is DENY.
 * Missing/invalid policy config → blocks everything (fail-closed).
 */
export class TrustBoundary {
  constructor(private policy: PolicyConfig) {}

  setPolicy(policy: PolicyConfig) {
    this.policy = policy;
  }

  /**
   * Stable local-policy fingerprint used to bind approvals to the policy
   * snapshot that originally required the pause.
   */
  policyFingerprint(): string {
    return `local:${createHash('sha256').update(stableJson(this.policy)).digest('hex')}`;
  }

  /**
   * Evaluate whether an action should be allowed.
   */
  evaluate(action: ActionRequest): TrustBoundaryResult {
    const now = new Date();

    // Kill switch — blocks everything immediately
    if (this.policy.killSwitch) {
      return {
        verdict: 'deny',
        reason: 'Kill switch is active — all actions blocked',
        checkedAt: now,
      };
    }

    // Fail-closed: if policy is invalid, deny all
    if (this.policy.failClosed && !this.isPolicyValid()) {
      return { verdict: 'deny', reason: 'Policy validation failed (fail-closed)', checkedAt: now };
    }

    // Check chain (order matters — cheapest checks first)
    const checks: Array<() => CheckResult> = [
      () => this.checkToolBlocklist(action),
      () => this.checkBudget(action),
      () => this.checkConnectorAccess(action),
      () => this.checkContentBans(action),
      () => this.checkApprovalRequired(action),
    ];

    for (const check of checks) {
      const result = check();
      if (result.verdict !== 'allow') {
        return { ...result, checkedAt: now };
      }
    }

    return { verdict: 'allow', checkedAt: now };
  }

  /**
   * Validate that the policy has all required fields with sane values.
   * Tighter than before: checks budget structure, not just dailyTotalMax > 0.
   */
  private isPolicyValid(): boolean {
    const b = this.policy.budget;
    return (
      b.dailyTotalMax > 0 &&
      b.perTaskMax > 0 &&
      b.perOperatorMax > 0 &&
      b.emergencyKill > 0 &&
      b.perTaskMax <= b.dailyTotalMax &&
      b.perOperatorMax <= b.dailyTotalMax
    );
  }

  private checkToolBlocklist(action: ActionRequest): CheckResult {
    if (this.policy.toolBlocklist.includes(action.tool)) {
      return {
        verdict: 'deny',
        reason: `Tool "${action.tool}" is blocklisted`,
        policyRule: 'tool_blocklist',
      };
    }
    return { verdict: 'allow' };
  }

  private checkBudget(action: ActionRequest): CheckResult {
    if (action.estimatedCost && action.estimatedCost > this.policy.budget.perTaskMax) {
      return {
        verdict: 'deny',
        reason: `Estimated cost ${action.estimatedCost} exceeds per-task max ${this.policy.budget.perTaskMax}`,
        policyRule: 'budget.per_task_max',
      };
    }
    return { verdict: 'allow' };
  }

  private checkConnectorAccess(action: ActionRequest): CheckResult {
    if (
      action.connector &&
      this.policy.connectorAllowlist.length > 0 &&
      !this.policy.connectorAllowlist.includes(action.connector)
    ) {
      return {
        verdict: 'deny',
        reason: `Connector "${action.connector}" not in allowlist`,
        policyRule: 'connector_allowlist',
      };
    }
    return { verdict: 'allow' };
  }

  private checkContentBans(action: ActionRequest): CheckResult {
    if (action.content) {
      const lowerContent = action.content.toLowerCase();
      for (const ban of this.policy.contentBans) {
        if (lowerContent.includes(ban.toLowerCase())) {
          return {
            verdict: 'deny',
            reason: `Content contains banned term: "${ban}"`,
            policyRule: 'content_bans',
          };
        }
      }
    }
    return { verdict: 'allow' };
  }

  private checkApprovalRequired(action: ActionRequest): CheckResult {
    if (this.policy.requireApprovalFor.includes(action.tool)) {
      return {
        verdict: 'require_approval',
        reason: `Tool "${action.tool}" requires approval`,
        policyRule: 'require_approval',
      };
    }
    return { verdict: 'allow' };
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortJson);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

export interface ActionRequest {
  tool: string;
  connector?: string;
  content?: string;
  estimatedCost?: number;
  operatorId?: string;
  workspaceId?: string;
}

interface CheckResult {
  verdict: Verdict;
  reason?: string;
  policyRule?: string;
}

import { describe, it, expect } from 'vitest';
import { TrustBoundary, type ActionRequest } from '../trust.js';
import { type PolicyConfig } from '@helm-pilot/shared/schemas';

function makePolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    killSwitch: false,
    budget: {
      dailyTotalMax: 500,
      perTaskMax: 100,
      perOperatorMax: 200,
      emergencyKill: 1500,
      currency: 'EUR',
    },
    toolBlocklist: [],
    contentBans: [],
    connectorAllowlist: [],
    requireApprovalFor: [],
    failClosed: true,
    ...overrides,
  };
}

function makeAction(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return { tool: 'search_knowledge', ...overrides };
}

describe('TrustBoundary', () => {
  it('allows a normal action with valid policy', () => {
    const tb = new TrustBoundary(makePolicy());
    const result = tb.evaluate(makeAction());
    expect(result.verdict).toBe('allow');
  });

  it('denies everything when kill switch is active', () => {
    const tb = new TrustBoundary(makePolicy({ killSwitch: true }));
    const result = tb.evaluate(makeAction());
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('Kill switch');
  });

  it('denies when policy is invalid and failClosed is true', () => {
    const tb = new TrustBoundary(
      makePolicy({
        budget: { dailyTotalMax: 0, perTaskMax: 100, perOperatorMax: 200, emergencyKill: 1500, currency: 'EUR' },
      }),
    );
    const result = tb.evaluate(makeAction());
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('Policy validation failed');
  });

  it('denies when perTaskMax > dailyTotalMax (invalid policy)', () => {
    const tb = new TrustBoundary(
      makePolicy({
        budget: { dailyTotalMax: 50, perTaskMax: 100, perOperatorMax: 200, emergencyKill: 1500, currency: 'EUR' },
      }),
    );
    const result = tb.evaluate(makeAction());
    expect(result.verdict).toBe('deny');
  });

  it('denies a blocklisted tool', () => {
    const tb = new TrustBoundary(makePolicy({ toolBlocklist: ['dangerous_tool'] }));
    const result = tb.evaluate(makeAction({ tool: 'dangerous_tool' }));
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('blocklisted');
  });

  it('allows a tool not in blocklist', () => {
    const tb = new TrustBoundary(makePolicy({ toolBlocklist: ['other_tool'] }));
    const result = tb.evaluate(makeAction({ tool: 'safe_tool' }));
    expect(result.verdict).toBe('allow');
  });

  it('denies when estimated cost exceeds perTaskMax', () => {
    const tb = new TrustBoundary(makePolicy());
    const result = tb.evaluate(makeAction({ estimatedCost: 200 }));
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('exceeds per-task max');
  });

  it('allows when estimated cost is within budget', () => {
    const tb = new TrustBoundary(makePolicy());
    const result = tb.evaluate(makeAction({ estimatedCost: 50 }));
    expect(result.verdict).toBe('allow');
  });

  it('denies connector not in allowlist', () => {
    const tb = new TrustBoundary(makePolicy({ connectorAllowlist: ['github', 'slack'] }));
    const result = tb.evaluate(makeAction({ connector: 'stripe' }));
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('not in allowlist');
  });

  it('allows connector in allowlist', () => {
    const tb = new TrustBoundary(makePolicy({ connectorAllowlist: ['github', 'slack'] }));
    const result = tb.evaluate(makeAction({ connector: 'github' }));
    expect(result.verdict).toBe('allow');
  });

  it('allows any connector when allowlist is empty', () => {
    const tb = new TrustBoundary(makePolicy({ connectorAllowlist: [] }));
    const result = tb.evaluate(makeAction({ connector: 'anything' }));
    expect(result.verdict).toBe('allow');
  });

  it('denies content with banned terms', () => {
    const tb = new TrustBoundary(makePolicy({ contentBans: ['malware', 'exploit'] }));
    const result = tb.evaluate(makeAction({ content: 'Build a malware toolkit' }));
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('banned term');
  });

  it('content ban check is case-insensitive', () => {
    const tb = new TrustBoundary(makePolicy({ contentBans: ['EXPLOIT'] }));
    const result = tb.evaluate(makeAction({ content: 'This is an exploit test' }));
    expect(result.verdict).toBe('deny');
  });

  it('returns require_approval for tools requiring approval', () => {
    const tb = new TrustBoundary(makePolicy({ requireApprovalFor: ['deploy_production'] }));
    const result = tb.evaluate(makeAction({ tool: 'deploy_production' }));
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toContain('requires approval');
  });

  it('includes checkedAt timestamp in results', () => {
    const tb = new TrustBoundary(makePolicy());
    const before = new Date();
    const result = tb.evaluate(makeAction());
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.checkedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

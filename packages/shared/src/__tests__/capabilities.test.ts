import { describe, expect, it } from 'vitest';
import {
  capabilityKeyValues,
  getCapabilityRecord,
  getCapabilityRecords,
  getCapabilitySummary,
  renderCapabilityStatusMarkdown,
  validateCapabilityRecords,
  type CapabilityRecord,
} from '../capabilities/index.js';

describe('capability registry', () => {
  it('includes every Gate 0 blocker capability', () => {
    const keys = new Set(getCapabilityRecords().map((record) => record.key));

    for (const key of capabilityKeyValues) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it('does not report non-production capabilities as production_ready', () => {
    const capabilities = getCapabilityRecords();

    expect(capabilities.some((record) => record.state === 'prototype')).toBe(true);
    expect(capabilities.some((record) => record.state === 'blocked')).toBe(true);
    expect(capabilities.every((record) => record.state !== 'production_ready')).toBe(true);

    expect(getCapabilityRecord('decision_court')?.state).toBe('implemented');
    expect(getCapabilityRecord('skill_registry_runtime')?.state).toBe('implemented');
    expect(getCapabilityRecord('opportunity_scoring')?.state).toBe('implemented');
    expect(getCapabilityRecord('browser_execution')?.state).toBe('prototype');
    expect(getCapabilityRecord('computer_use')?.state).toBe('prototype');
  });

  it('requires eval metadata before a capability can become production_ready', () => {
    const records = getCapabilityRecords();
    const promotedWithoutEval: CapabilityRecord[] = records.map((record) =>
      record.key === 'browser_execution'
        ? {
            ...record,
            state: 'production_ready',
            eval: undefined,
          }
        : record,
    );

    expect(() => validateCapabilityRecords(promotedWithoutEval)).toThrow(
      /cannot be production_ready without eval metadata/,
    );
  });

  it('renders a status output with blocked and prototype states', () => {
    const markdown = renderCapabilityStatusMarkdown();

    expect(markdown).toContain('Production-ready capabilities: 0/');
    expect(markdown).toContain('decision_court | implemented');
    expect(markdown).toContain('helm_receipts | implemented');
    expect(markdown).toContain('skill_registry_runtime | implemented');
    expect(markdown).toContain('opportunity_scoring | implemented');
    expect(markdown).toContain('browser_execution | prototype');
  });

  it('summarizes blockers without inflating production readiness', () => {
    const summary = getCapabilitySummary();

    expect(summary.productionReady).toBe(0);
    expect(summary.total).toBe(capabilityKeyValues.length);
    expect(summary.blockers.map((blocker) => blocker.key)).toContain('polsia_outperformance');
  });
});

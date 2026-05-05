import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { capabilityKeyValues, type CapabilityRecord } from '@pilot/shared/capabilities';
import { capabilityRoutes } from '../../routes/capabilities.js';

interface CapabilityResponse {
  summary: {
    total: number;
    productionReady: number;
  };
  capabilities: CapabilityRecord[];
}

describe('capabilityRoutes', () => {
  it('exposes all known Gate 0 capability blockers', async () => {
    const { fetch } = createCapabilityTestApp();
    const res = await fetch('GET', '/');
    const json = await expectJson<CapabilityResponse>(res, 200);
    const keys = new Set(json.capabilities.map((capability) => capability.key));

    expect(json.summary.total).toBe(capabilityKeyValues.length);
    expect(json.summary.productionReady).toBe(0);

    for (const key of capabilityKeyValues) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it('does not expose stub or prototype capabilities as production_ready', async () => {
    const { fetch } = createCapabilityTestApp();
    const res = await fetch('GET', '/');
    const json = await expectJson<CapabilityResponse>(res, 200);

    expect(json.capabilities.find((capability) => capability.key === 'decision_court')?.state).toBe(
      'implemented',
    );
    expect(json.capabilities.find((capability) => capability.key === 'helm_receipts')?.state).toBe(
      'implemented',
    );
    expect(
      json.capabilities.find((capability) => capability.key === 'opportunity_scoring')?.state,
    ).toBe('implemented');
    expect(
      json.capabilities.find((capability) => capability.key === 'browser_execution')?.state,
    ).toBe('prototype');
  });

  it('returns one capability by key', async () => {
    const { fetch } = createCapabilityTestApp();
    const res = await fetch('GET', '/decision_court');
    const json = await expectJson<{ capability: CapabilityRecord }>(res, 200);

    expect(json.capability.key).toBe('decision_court');
    expect(json.capability.evalRequirement).toContain('Decision Court');
  });

  it('returns 404 for unknown capabilities', async () => {
    const { fetch } = createCapabilityTestApp();
    const res = await fetch('GET', '/not-real');
    const json = await expectJson<{ error: string }>(res, 404);

    expect(json.error).toBe('Unknown capability');
  });
});

function createCapabilityTestApp() {
  const app = new Hono();
  app.route('/', capabilityRoutes());

  return {
    fetch(method: string, path: string) {
      return app.fetch(new Request(`http://localhost${path}`, { method }));
    },
  };
}

async function expectJson<T>(res: Response, expectedStatus: number): Promise<T> {
  if (res.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus} but got ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

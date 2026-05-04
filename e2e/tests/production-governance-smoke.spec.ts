import { expect, test } from '@playwright/test';

test.describe('production governance smoke', () => {
  test.skip(
    process.env['PRODUCTION_GOVERNANCE_SMOKE'] !== '1',
    'Set PRODUCTION_GOVERNANCE_SMOKE=1 against a HELM-sidecar deployment.',
  );

  test('health, metrics, and auth boundary reflect fail-closed HELM production shape', async ({
    request,
  }) => {
    expect(process.env['HELM_FAIL_CLOSED']).toBe('1');
    expect(process.env['OPENROUTER_API_KEY']).toBeFalsy();
    expect(process.env['ANTHROPIC_API_KEY']).toBeFalsy();
    expect(process.env['OPENAI_API_KEY']).toBeFalsy();

    const health = await request.get('/health');
    expect(health.ok()).toBe(true);
    const body = await health.json();
    expect(body.checks.helm).toBe('ok');

    const metrics = await request.get('/metrics');
    expect(metrics.ok()).toBe(true);
    expect(await metrics.text()).toContain('pilot_http_requests_total');

    const protectedResponse = await request.get('/api/tasks');
    expect(protectedResponse.status()).toBe(401);
  });
});

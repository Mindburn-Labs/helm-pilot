import { test, expect } from '@playwright/test';

/**
 * Phase 13 Track C2 — governance proof-graph endpoint contract.
 *
 * All endpoints are tenancy-gated, so without a real auth token we
 * expect 401/403. The shape assertions only run when the gateway is
 * seeded + auth-wired in CI fixture mode.
 */
test.describe('Governance DAG + receipts', () => {
  test('GET /api/governance/status returns shape', async ({ request }) => {
    const response = await request.get('/api/governance/status');
    expect([200, 401, 403]).toContain(response.status());
    if (response.status() !== 200) return;
    const body = await response.json();
    expect(body).toHaveProperty('helmConfigured');
    expect(typeof body.helmConfigured).toBe('boolean');
  });

  test('GET /api/governance/receipts requires workspace + returns {receipts}', async ({
    request,
  }) => {
    const response = await request.get('/api/governance/receipts?limit=5', {
      headers: { 'X-Workspace-Id': '00000000-0000-0000-0000-000000000000' },
    });
    // 400 when workspace can't be resolved, 401/403 when auth is required,
    // or 200 with empty receipts list when hit cold.
    expect([200, 400, 401, 403]).toContain(response.status());
    if (response.status() !== 200) return;
    const body = await response.json();
    expect(body).toHaveProperty('receipts');
    expect(Array.isArray(body.receipts)).toBe(true);
  });

  test('GET /api/governance/proofgraph/:taskId returns {nodes, edges}', async ({
    request,
  }) => {
    const response = await request.get(
      '/api/governance/proofgraph/00000000-0000-0000-0000-000000000000',
      { headers: { 'X-Workspace-Id': '00000000-0000-0000-0000-000000000000' } },
    );
    expect([200, 400, 401, 403]).toContain(response.status());
    if (response.status() !== 200) return;
    const body = await response.json();
    expect(body).toHaveProperty('nodes');
    expect(body).toHaveProperty('edges');
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    // Empty DAG is fine for a cold workspace.
    for (const n of body.nodes) {
      expect(n).toHaveProperty('id');
      expect(n).toHaveProperty('verdict');
      expect(n).toHaveProperty('action');
    }
    for (const e of body.edges) {
      expect(e).toHaveProperty('from');
      expect(e).toHaveProperty('to');
    }
  });
});

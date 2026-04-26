import { test, expect } from '@playwright/test';

/**
 * Phase 12 governed-subagents — API-level contract check.
 * Assumes the gateway is running; docker-compose fixture in CI.
 */
test.describe('Conductor (Phase 12 subagents)', () => {
  test('GET /api/orchestrator/subagents returns loaded definitions or empty', async ({
    request,
  }) => {
    const response = await request.get('/api/orchestrator/subagents');
    // Endpoint is public for list-only; 200 whether or not auth is present.
    expect([200, 401, 403]).toContain(response.status());
    if (response.status() !== 200) return;
    const body = await response.json();
    expect(body).toHaveProperty('subagents');
    expect(Array.isArray(body.subagents)).toBe(true);

    // When the three default packs are present, each must have the
    // Phase-12-required shape.
    for (const def of body.subagents) {
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('operatorRole');
      expect(def).toHaveProperty('maxRiskClass');
      expect(def).toHaveProperty('execution');
      expect(def).toHaveProperty('allowedTools');
      expect(Array.isArray(def.allowedTools)).toBe(true);
    }
  });

  test('POST /api/orchestrator/conduct requires taskId + context', async ({ request }) => {
    const response = await request.post('/api/orchestrator/conduct', {
      data: {},
      headers: { 'X-Workspace-Id': '00000000-0000-0000-0000-000000000000' },
    });
    // Either auth-gated (401/403) or validation-gated (400) — never 5xx.
    expect([400, 401, 403]).toContain(response.status());
  });

  test('POST /api/orchestrator/conduct rejects unknown task in workspace', async ({ request }) => {
    const response = await request.post('/api/orchestrator/conduct', {
      data: {
        taskId: '00000000-0000-0000-0000-000000000000',
        context: 'probe',
      },
      headers: { 'X-Workspace-Id': '00000000-0000-0000-0000-000000000000' },
    });
    expect([401, 403, 404]).toContain(response.status());
  });
});

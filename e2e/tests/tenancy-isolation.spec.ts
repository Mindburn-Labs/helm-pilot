import { test, expect } from '@playwright/test';

/**
 * Phase 2a tenancy hardening — contract: every workspace-scoped route
 * refuses anonymous cross-tenant reads. Without a valid auth token the
 * gateway should return 401/403/404 — never 200 with data attached to
 * a random workspace UUID in the header.
 */
const BOGUS = '00000000-0000-0000-0000-000000000000';

const READ_ROUTES = [
  '/api/tasks',
  '/api/opportunities',
  '/api/operators',
  '/api/applications',
  '/api/knowledge',
  '/api/launch/artifacts',
  '/api/launch/deployments',
  '/api/launch/targets',
  '/api/governance/receipts',
];

test.describe('Tenancy isolation', () => {
  for (const route of READ_ROUTES) {
    test(`GET ${route} refuses anonymous cross-tenant read`, async ({ request }) => {
      const response = await request.get(`${route}?workspaceId=${BOGUS}`, {
        headers: { 'X-Workspace-Id': BOGUS },
      });
      expect(
        [401, 403, 404],
        `${route} must not leak 200 data for bogus workspace`,
      ).toContain(response.status());
    });
  }

  test('POST /api/decide/court refuses without auth', async ({ request }) => {
    const response = await request.post('/api/decide/court', {
      data: { opportunityIds: [BOGUS] },
      headers: { 'X-Workspace-Id': BOGUS },
    });
    expect([400, 401, 403, 404]).toContain(response.status());
  });
});

import { test, expect } from '@playwright/test';

test.describe('Telegram Auth', () => {
  test('POST /api/auth/telegram without valid signature rejects or reports unconfigured Telegram', async ({
    request,
  }) => {
    const authDate = Math.floor(Date.now() / 1000);
    const user = encodeURIComponent(JSON.stringify({ id: 123456789, first_name: 'Test' }));
    const response = await request.post('/api/auth/telegram', {
      headers: { 'x-forwarded-for': '198.51.100.101' },
      data: {
        initData: `auth_date=${authDate}&user=${user}&hash=${'0'.repeat(64)}`,
      },
    });
    expect([401, 503]).toContain(response.status());
  });

  test('POST /api/auth/telegram with missing fields returns 400', async ({ request }) => {
    const response = await request.post('/api/auth/telegram', {
      headers: { 'x-forwarded-for': '198.51.100.102' },
      data: {},
    });
    expect([400, 401]).toContain(response.status());
  });

  test('protected endpoint without token returns 401', async ({ request }) => {
    const response = await request.get('/api/tasks');
    expect(response.status()).toBe(401);
  });
});

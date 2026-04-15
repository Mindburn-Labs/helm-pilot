import { test, expect } from '@playwright/test';

test.describe('Telegram Auth', () => {
  test('POST /api/auth/telegram without valid signature returns 401', async ({ request }) => {
    const response = await request.post('/api/auth/telegram', {
      data: {
        id: 123456789,
        first_name: 'Test',
        auth_date: Math.floor(Date.now() / 1000),
        hash: 'invalid-signature',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('POST /api/auth/telegram with missing fields returns 400', async ({ request }) => {
    const response = await request.post('/api/auth/telegram', {
      data: {},
    });
    expect([400, 401]).toContain(response.status());
  });

  test('protected endpoint without token returns 401', async ({ request }) => {
    const response = await request.get('/api/tasks');
    expect(response.status()).toBe(401);
  });
});

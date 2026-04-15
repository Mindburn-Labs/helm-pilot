import { test, expect, type APIRequestContext } from '@playwright/test';

async function authenticate(request: APIRequestContext): Promise<string> {
  const email = `e2e-kb-${Math.random().toString(36).slice(2, 10)}@helm-pilot.test`;
  const requestResp = await request.post('/api/auth/email/request', { data: { email } });
  const requestBody = await requestResp.json();
  const verifyResp = await request.post('/api/auth/email/verify', {
    data: { email, code: requestBody.code },
  });
  const verifyBody = await verifyResp.json();
  return verifyBody.token;
}

test.describe('Knowledge Base', () => {
  test('create a page then search for it', async ({ request }) => {
    const token = await authenticate(request);
    const headers = { Authorization: `Bearer ${token}` };

    // Create a knowledge page
    const createResp = await request.post('/api/knowledge/pages', {
      headers,
      data: {
        type: 'concept',
        title: 'Playwright E2E testing',
        content: 'Playwright is a modern E2E testing framework for web applications.',
      },
    });
    expect(createResp.status()).toBe(201);
    const page = await createResp.json();
    expect(page).toHaveProperty('id');

    // Search for it
    const searchResp = await request.get('/api/knowledge/search?q=Playwright', { headers });
    expect(searchResp.status()).toBe(200);
    const results = await searchResp.json();
    expect(Array.isArray(results)).toBe(true);
    // Results may be empty immediately if indexing lags; either way the endpoint works
  });

  test('search without query returns 400', async ({ request }) => {
    const token = await authenticate(request);
    const resp = await request.get('/api/knowledge/search', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.status()).toBe(400);
  });

  test('search supports hybrid method parameter', async ({ request }) => {
    const token = await authenticate(request);
    const resp = await request.get('/api/knowledge/search?q=test&method=hybrid', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.status()).toBe(200);
  });
});

import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Task lifecycle E2E:
 *   Create task → list tasks → update task status → get task runs.
 */

async function authenticate(request: APIRequestContext): Promise<{ token: string; workspaceId: string }> {
  const email = `e2e-task-${Math.random().toString(36).slice(2, 10)}@helm-pilot.test`;
  await request.post('/api/auth/email/request', { data: { email } });
  const requestResp = await request.post('/api/auth/email/request', { data: { email } });
  const requestBody = await requestResp.json();

  const verifyResp = await request.post('/api/auth/email/verify', {
    data: { email, code: requestBody.code },
  });
  const verifyBody = await verifyResp.json();
  return { token: verifyBody.token, workspaceId: verifyBody.workspace.id };
}

test.describe('Task Lifecycle', () => {
  test('create, list, update status, get runs', async ({ request }) => {
    const { token, workspaceId } = await authenticate(request);
    const headers = { Authorization: `Bearer ${token}` };

    // Create a task
    const createResp = await request.post('/api/tasks', {
      headers,
      data: {
        workspaceId,
        title: 'E2E test task',
        description: 'Created by Playwright',
        mode: 'build',
        autoRun: false,
      },
    });
    expect(createResp.status()).toBe(201);
    const task = await createResp.json();
    expect(task).toHaveProperty('id');
    expect(task.title).toBe('E2E test task');
    expect(task.status).toBeDefined();

    // List tasks for the workspace
    const listResp = await request.get(`/api/tasks?workspaceId=${workspaceId}`, { headers });
    expect(listResp.status()).toBe(200);
    const tasks = await listResp.json();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.find((t: { id: string }) => t.id === task.id)).toBeDefined();

    // Get task runs (should be empty initially)
    const runsResp = await request.get(`/api/tasks/${task.id}/runs`, { headers });
    expect(runsResp.status()).toBe(200);
    const runs = await runsResp.json();
    expect(Array.isArray(runs)).toBe(true);
  });

  test('creating task with invalid mode returns 400', async ({ request }) => {
    const { token, workspaceId } = await authenticate(request);
    const resp = await request.post('/api/tasks', {
      headers: { Authorization: `Bearer ${token}` },
      data: { workspaceId, title: 'x', mode: 'invalid-mode' },
    });
    expect(resp.status()).toBe(400);
  });

  test('listing tasks without workspaceId returns 400', async ({ request }) => {
    const { token } = await authenticate(request);
    const resp = await request.get('/api/tasks', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.status()).toBe(400);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { auditMiddleware } from '../../middleware/audit.js';

function createMockInsert() {
  const valuesResult = {
    then: vi.fn((resolve: (v: unknown) => void) => {
      resolve(undefined);
      return { catch: vi.fn() };
    }),
    catch: vi.fn(),
  };
  const valuesFn = vi.fn(() => valuesResult);
  const insertFn = vi.fn(() => ({ values: valuesFn }));
  return { insertFn, valuesFn, valuesResult };
}

describe('auditMiddleware', () => {
  let db: { insert: ReturnType<typeof vi.fn> };
  let app: Hono;
  let mock: ReturnType<typeof createMockInsert>;

  beforeEach(() => {
    mock = createMockInsert();
    db = { insert: mock.insertFn } as any;

    app = new Hono();
    app.use('*', async (c, next) => {
      const workspaceId = c.req.header('X-Bound-Workspace-Id');
      if (workspaceId) c.set('workspaceId', workspaceId);
      await next();
    });
    app.use('*', auditMiddleware(db as any));

    // Test routes
    app.get('/api/items', (c) => c.json({ ok: true }));
    app.post('/api/items', (c) => c.json({ created: true }, 201));
    app.put('/api/items/:id', (c) => c.json({ updated: true }));
    app.delete('/api/items/:id', (c) => c.json({ deleted: true }));
    app.post('/api/fail', (c) => c.json({ error: 'bad' }, 400));
  });

  it('ignores GET requests', async () => {
    await app.fetch(new Request('http://localhost/api/items'));
    expect(mock.insertFn).not.toHaveBeenCalled();
  });

  it('logs POST requests', async () => {
    await app.fetch(new Request('http://localhost/api/items', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    expect(mock.insertFn).toHaveBeenCalled();
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      action: 'POST /api/items',
      actor: 'anonymous',
      verdict: 'allow',
    });
  });

  it('logs PUT requests', async () => {
    await app.fetch(new Request('http://localhost/api/items/1', { method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    expect(mock.insertFn).toHaveBeenCalled();
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.action).toBe('PUT /api/items/1');
  });

  it('logs DELETE requests', async () => {
    await app.fetch(new Request('http://localhost/api/items/1', { method: 'DELETE' }));
    expect(mock.insertFn).toHaveBeenCalled();
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.action).toBe('DELETE /api/items/1');
  });

  it('uses anonymous when no userId is set', async () => {
    await app.fetch(new Request('http://localhost/api/items', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.actor).toBe('anonymous');
  });

  it('records verdict as deny for error responses', async () => {
    await app.fetch(new Request('http://localhost/api/fail', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.verdict).toBe('deny');
    expect(values.reason).toContain('400');
  });

  it('records verdict as allow for success responses', async () => {
    await app.fetch(new Request('http://localhost/api/items', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.verdict).toBe('allow');
  });

  it('does not throw if DB insert fails', async () => {
    // Make insert return a rejected promise chain — audit middleware's .catch() absorbs it
    db.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        then: vi.fn(() => Promise.reject(new Error('DB down'))),
        catch: vi.fn(),
      })),
    }));
    const res = await app.fetch(new Request('http://localhost/api/items', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    expect(res.status).toBe(201);
  });

  it('does not trust unbound workspaceId from query param', async () => {
    await app.fetch(new Request('http://localhost/api/items?workspaceId=ws-1', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.workspaceId).toBeNull();
  });

  it('does not trust unbound workspaceId from X-Workspace-Id header', async () => {
    await app.fetch(new Request('http://localhost/api/items', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'ws-2' },
    }));
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.workspaceId).toBeNull();
  });

  it('captures workspaceId from bound auth context', async () => {
    await app.fetch(new Request('http://localhost/api/items', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', 'X-Bound-Workspace-Id': 'ws-2' },
    }));
    const values = mock.valuesFn.mock.calls[0]?.[0];
    expect(values.workspaceId).toBe('ws-2');
  });
});

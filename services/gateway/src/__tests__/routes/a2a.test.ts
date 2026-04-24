import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { a2aRoutes, __resetA2aTasks } from '../../routes/a2a.js';
import { createMockDeps, testApp } from '../helpers.js';

const BEARER = 'test123abc456def789012345';
const WS_ID = 'ws-a2a-1';

describe('a2aRoutes', () => {
  beforeEach(() => {
    __resetA2aTasks();
    process.env['PILOT_A2A_TOKEN'] = BEARER;
    process.env['PILOT_A2A_WORKSPACE_ID'] = WS_ID;
    process.env['PILOT_A2A_PUBLIC_URL'] = 'http://localhost:3100';
    process.env['PILOT_VERSION'] = '1.2.1';
  });
  afterEach(() => {
    delete process.env['PILOT_A2A_TOKEN'];
    delete process.env['PILOT_A2A_WORKSPACE_ID'];
    delete process.env['PILOT_A2A_PUBLIC_URL'];
    delete process.env['PILOT_VERSION'];
  });

  it('GET /.well-known/agent-card.json returns AgentCard', async () => {
    const { fetch } = testApp(a2aRoutes);
    const res = await fetch('GET', '/.well-known/agent-card.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocolVersion: string;
      skills: unknown[];
      authentication: { schemes: string[] };
    };
    expect(body.protocolVersion).toBe('0.3.0');
    expect(body.skills.length).toBeGreaterThan(0);
    expect(body.authentication.schemes).toEqual(['bearer']);
  });

  it('POST /a2a with no token env returns 503', async () => {
    delete process.env['PILOT_A2A_TOKEN'];
    const { fetch } = testApp(a2aRoutes);
    const res = await fetch('POST', '/a2a', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(res.status).toBe(503);
  });

  it('POST /a2a missing bearer header returns 401', async () => {
    const { fetch } = testApp(a2aRoutes);
    const res = await fetch('POST', '/a2a', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tasks/send',
    });
    expect(res.status).toBe(401);
  });

  it('POST /a2a wrong bearer returns 401', async () => {
    const { fetch } = testApp(a2aRoutes);
    const res = await fetch(
      'POST',
      '/a2a',
      { jsonrpc: '2.0', id: 1, method: 'tasks/send' },
      { authorization: 'Bearer wrong-token-xxxxxxxxxxxx' },
    );
    expect(res.status).toBe(401);
  });

  it('tasks/send happy path dispatches via orchestrator.runConduct', async () => {
    const deps = createMockDeps();
    deps.db.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'task-row-1' }]),
      })),
    })) as unknown as typeof deps.db.insert;
    const runConductMock = vi.fn(async () => ({
      status: 'completed',
      actions: [{ tool: 'finish', input: { summary: 'All done.' } }],
    }));
    (deps.orchestrator as unknown as { runConduct: typeof runConductMock }).runConduct =
      runConductMock;

    const { fetch } = testApp(a2aRoutes, deps);
    const res = await fetch(
      'POST',
      '/a2a',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/send',
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Find AI opportunities' }],
          },
        },
      },
      { authorization: `Bearer ${BEARER}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        task: {
          id: string;
          status: {
            state: string;
            message?: { parts: Array<{ type: string; text: string }> };
          };
        };
      };
    };
    expect(body.result.task.id).toBeDefined();
    expect(body.result.task.status.state).toBe('completed');
    expect(body.result.task.status.message?.parts[0]?.text).toBe('All done.');
    expect(runConductMock).toHaveBeenCalledTimes(1);
  });

  it('tasks/get for unknown id returns task_not_found', async () => {
    const { fetch } = testApp(a2aRoutes);
    const res = await fetch(
      'POST',
      '/a2a',
      { jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: 'ghost' } },
      { authorization: `Bearer ${BEARER}` },
    );
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32004);
  });

  it('malformed JSON returns -32700', async () => {
    const { app } = testApp(a2aRoutes);
    const res = await app.fetch(
      new Request('http://localhost/a2a', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${BEARER}`,
        },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it('unknown method returns -32601', async () => {
    const { fetch } = testApp(a2aRoutes);
    const res = await fetch(
      'POST',
      '/a2a',
      { jsonrpc: '2.0', id: 9, method: 'resources/list' },
      { authorization: `Bearer ${BEARER}` },
    );
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it('tasks/send with no workspace env returns -32000', async () => {
    delete process.env['PILOT_A2A_WORKSPACE_ID'];
    const { fetch } = testApp(a2aRoutes);
    const res = await fetch(
      'POST',
      '/a2a',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'hi' }] } },
      },
      { authorization: `Bearer ${BEARER}` },
    );
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32000);
  });
});

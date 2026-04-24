import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  buildPilotAgentCard,
  type A2AMessage,
  type Task,
  type TaskSendRequest,
} from '@helm-pilot/shared/a2a';
import { type GatewayDeps } from '../index.js';

// ─── A2A server routes (Phase 15 Track J) ───
//
// Pilot-as-server half of the A2A protocol. Exposes:
//   GET  /.well-known/agent-card.json  — public discovery doc
//   POST /a2a                          — JSON-RPC 2.0 task lifecycle
//
// v1 task storage is an in-memory Map — sufficient for smoke interop
// testing with Microsoft Agent Framework + Gemini CLI. Production-grade
// task persistence (DB-backed) follows in a 1.2.1 patch.
//
// Auth: requires `PILOT_A2A_TOKEN` env var set. Constant-time compare
// against the bearer header. Refuses all calls when the var is unset.

const tasks = new Map<string, Task>();

export function a2aRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/.well-known/agent-card.json', (c) => {
    const publicBase =
      process.env['PILOT_A2A_PUBLIC_URL'] ?? 'http://localhost:3100';
    const card = buildPilotAgentCard({
      url: `${publicBase}/a2a`,
      version: process.env['PILOT_VERSION'] ?? '1.2.0',
      organization: process.env['PILOT_A2A_ORGANIZATION'] ?? undefined,
      organizationUrl: process.env['PILOT_A2A_ORGANIZATION_URL'] ?? undefined,
    });
    return c.json(card);
  });

  app.post('/a2a', async (c) => {
    const expected = process.env['PILOT_A2A_TOKEN'];
    if (!expected) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'A2A not configured (no token)' },
          id: null,
        },
        503,
      );
    }
    const auth = c.req.header('authorization') ?? '';
    if (!auth.toLowerCase().startsWith('bearer ')) {
      return rpcError(c, null, -32001, 'Unauthorized', 401);
    }
    const presented = Buffer.from(auth.slice(7));
    const expectedBuf = Buffer.from(expected);
    const ok =
      presented.length === expectedBuf.length &&
      timingSafeEqual(presented, expectedBuf);
    if (!ok) return rpcError(c, null, -32001, 'Unauthorized', 401);

    let body: {
      jsonrpc?: string;
      id?: number | string | null;
      method?: string;
      params?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return rpcError(c, null, -32700, 'Parse error', 400);
    }
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return rpcError(c, body?.id ?? null, -32600, 'Invalid Request', 400);
    }
    const id = body.id ?? null;

    try {
      switch (body.method) {
        case 'tasks/send': {
          const req = (body.params ?? {}) as TaskSendRequest;
          if (!req.message || !Array.isArray(req.message.parts)) {
            return rpcError(c, id, -32602, 'message.parts required');
          }
          const workspaceId = process.env['PILOT_A2A_WORKSPACE_ID'];
          if (!workspaceId) {
            return rpcError(
              c,
              id,
              -32000,
              'PILOT_A2A_WORKSPACE_ID not configured; cannot dispatch',
            );
          }
          const taskId = req.id ?? `task-${randomUUID()}`;
          const text = extractText(req.message);
          if (!text) {
            return rpcError(c, id, -32602, 'message requires a text part');
          }

          // 1. Persist a tasks row so runConduct's tenancy gate accepts taskId.
          const { tasks: tasksTable } = await import('@helm-pilot/db/schema');
          const [taskRow] = await deps.db
            .insert(tasksTable)
            .values({
              workspaceId,
              title: text.slice(0, 60),
              description: text,
              mode: 'a2a',
              status: 'pending',
              priority: 0,
              metadata: { a2a: { taskId } },
            })
            .returning({ id: tasksTable.id });
          const pilotTaskId = taskRow?.id ?? '';

          // 2. Dispatch through the governed orchestrator.
          let result: { status: string; actions?: Array<{ tool: string; input?: unknown }> };
          try {
            result = (await deps.orchestrator.runConduct({
              taskId: pilotTaskId,
              workspaceId,
              context: text,
            })) as typeof result;
          } catch (err) {
            const failed: Task = {
              id: taskId,
              status: {
                state: 'failed',
                timestamp: new Date().toISOString(),
                message: agentText(
                  `Pilot failed to dispatch: ${err instanceof Error ? err.message : String(err)}`,
                ),
              },
              history: [req.message],
            };
            tasks.set(taskId, failed);
            return c.json({ jsonrpc: '2.0', id, result: { task: failed } });
          }

          // 3. Map AgentRunResult → A2A TaskState + build reply.
          const state: Task['status']['state'] =
            result.status === 'completed'
              ? 'completed'
              : result.status === 'awaiting_approval'
              ? 'input-required'
              : 'failed';
          const finish = (result.actions ?? [])
            .slice()
            .reverse()
            .find((a) => a.tool === 'finish');
          const summary =
            finish && typeof finish.input === 'object' && finish.input !== null
              ? String(
                  (finish.input as { summary?: unknown }).summary ??
                    `Conduct finished with status=${result.status}.`,
                )
              : `Conduct finished with status=${result.status}.`;

          const task: Task = {
            id: taskId,
            status: {
              state,
              timestamp: new Date().toISOString(),
              message: agentText(summary),
            },
            history: [req.message],
          };
          tasks.set(taskId, task);
          return c.json({ jsonrpc: '2.0', id, result: { task } });
        }
        case 'tasks/get': {
          const params = (body.params ?? {}) as { id?: string };
          if (typeof params.id !== 'string') {
            return rpcError(c, id, -32602, 'params.id required');
          }
          const task = tasks.get(params.id);
          if (!task) return rpcError(c, id, -32004, 'task_not_found');
          return c.json({ jsonrpc: '2.0', id, result: { task } });
        }
        case 'tasks/cancel': {
          const params = (body.params ?? {}) as { id?: string };
          if (typeof params.id !== 'string') {
            return rpcError(c, id, -32602, 'params.id required');
          }
          const task = tasks.get(params.id);
          if (!task) return rpcError(c, id, -32004, 'task_not_found');
          const canceled: Task = {
            ...task,
            status: { state: 'canceled', timestamp: new Date().toISOString() },
          };
          tasks.set(params.id, canceled);
          return c.json({ jsonrpc: '2.0', id, result: { task: canceled } });
        }
        default:
          return rpcError(c, id, -32601, `Method not found: ${body.method}`);
      }
    } catch (err) {
      return rpcError(
        c,
        id,
        -32603,
        err instanceof Error ? err.message : 'Internal error',
      );
    }
  });

  return app;
}

function rpcError(
  c: Context,
  id: number | string | null,
  code: number,
  message: string,
  httpStatus?: 400 | 401 | 500 | 503,
) {
  const body = { jsonrpc: '2.0', id, error: { code, message } };
  return httpStatus ? c.json(body, httpStatus) : c.json(body);
}

function extractText(user: A2AMessage): string {
  const firstText = user.parts.find((p) => p.type === 'text');
  return firstText?.type === 'text' ? firstText.text : '';
}

function agentText(text: string): A2AMessage {
  return { role: 'agent', parts: [{ type: 'text', text }] };
}

/** Test hook — drop in-memory task store. */
export function __resetA2aTasks(): void {
  tasks.clear();
}

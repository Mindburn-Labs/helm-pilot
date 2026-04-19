import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, desc, inArray } from 'drizzle-orm';
import { tasks } from '@helm-pilot/db/schema';
import { conductStream, type ConductEvent } from '@helm-pilot/orchestrator';
import { type GatewayDeps } from '../index.js';

export function eventRoutes(deps: GatewayDeps) {
  const app = new Hono();

  // GET /api/events/tasks?workspaceId=... — SSE stream of task status changes
  app.get('/tasks', async (c) => {
    const workspaceId = c.get('workspaceId') ?? c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    return streamSSE(c, async (stream) => {
      // Send initial snapshot
      const initial = await deps.db
        .select()
        .from(tasks)
        .where(eq(tasks.workspaceId, workspaceId))
        .orderBy(desc(tasks.updatedAt))
        .limit(20);

      await stream.writeSSE({
        event: 'snapshot',
        data: JSON.stringify(initial),
      });

      // If the event bus is connected, subscribe to real-time notifications.
      // Otherwise fall back to polling.
      if (deps.eventBus) {
        // Collect events in a queue; drain to client as they arrive.
        const queue: { event: string; data: string; id?: string }[] = [];
        let resolveQueue: (() => void) | null = null;
        let aborted = false;

        const unsubscribe = deps.eventBus.subscribeWorkspace(workspaceId, async (event) => {
          if (event.type.startsWith('task.') && event.id) {
            // Fetch the full task row and push it
            const [row] = await deps.db.select().from(tasks).where(inArray(tasks.id, [event.id])).limit(1);
            if (row) {
              queue.push({
                event: 'task.updated',
                data: JSON.stringify(row),
                id: row.id,
              });
              resolveQueue?.();
            }
          }
        });

        stream.onAbort(() => {
          aborted = true;
          unsubscribe();
          resolveQueue?.();
        });

        while (!aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              resolveQueue = resolve;
              // Periodic heartbeat to keep connection alive through proxies (30s)
              setTimeout(() => resolve(), 30_000);
            });
            resolveQueue = null;
            if (aborted) break;
            // Heartbeat comment (ignored by EventSource, keeps TCP alive)
            await stream.writeSSE({ event: 'ping', data: '' });
          }
          while (queue.length > 0) {
            const message = queue.shift()!;
            await stream.writeSSE(message);
          }
        }
        return;
      }

      // Fallback: 2-second polling for deployments without pg LISTEN support
      let lastCheck = new Date();
      while (true) {
        await stream.sleep(2000);
        const { gt, and } = await import('drizzle-orm');
        const updated = await deps.db
          .select()
          .from(tasks)
          .where(and(eq(tasks.workspaceId, workspaceId), gt(tasks.updatedAt, lastCheck)));
        if (updated.length > 0) {
          lastCheck = new Date();
          for (const task of updated) {
            await stream.writeSSE({
              event: 'task.updated',
              data: JSON.stringify(task),
              id: task.id,
            });
          }
        }
      }
    });
  });

  // ─── GET /api/events/conduct/:taskId (Phase 14 Track L) ───
  //
  // Live conductor iteration stream. Each SSE event carries a
  // ConductEvent JSON payload. Events fire for: iteration.started,
  // action.selected, action.completed, action.denied,
  // action.approval_required, subagent.spawned, subagent.completed,
  // task.verdict. The stream closes when the client disconnects.
  app.get('/conduct/:taskId', async (c) => {
    const taskId = c.req.param('taskId');
    if (!taskId) return c.json({ error: 'taskId required' }, 400);

    return streamSSE(c, async (stream) => {
      const queue: ConductEvent[] = [];
      let resolve: (() => void) | null = null;
      let aborted = false;

      const unsubscribe = conductStream.subscribe(taskId, (event) => {
        queue.push(event);
        resolve?.();
      });

      stream.onAbort(() => {
        aborted = true;
        unsubscribe();
        resolve?.();
      });

      await stream.writeSSE({
        event: 'subscribed',
        data: JSON.stringify({ taskId }),
      });

      while (!aborted) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r;
            // 30s heartbeat keeps TCP + proxies alive
            setTimeout(() => r(), 30_000);
          });
          resolve = null;
          if (aborted) break;
          if (queue.length === 0) {
            await stream.writeSSE({ event: 'ping', data: '' });
          }
        }
        while (queue.length > 0) {
          const ev = queue.shift()!;
          await stream.writeSSE({
            event: ev.type,
            data: JSON.stringify(ev),
          });
        }
      }
    });
  });

  return app;
}

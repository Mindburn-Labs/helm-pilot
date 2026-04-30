import { Hono } from 'hono';
import { CreateKnowledgePageInput, CreateTimelineEntryInput } from '@helm-pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId, workspaceIdMismatch } from '../lib/workspace.js';

export function knowledgeRoutes(deps: GatewayDeps) {
  const app = new Hono();

  // GET /api/knowledge/search?q=...&type=...&limit=... — Hybrid search
  app.get('/search', async (c) => {
    const query = c.req.query('q');
    if (!query) return c.json({ error: 'q parameter required' }, 400);

    const types = c.req.query('type')?.split(',');
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const results = await deps.memory.search(query, { types, limit, workspaceId });
    return c.json(results);
  });

  // POST /api/knowledge/pages — Create knowledge page
  app.post('/pages', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const raw = await c.req.json();
    if (workspaceIdMismatch(c, raw.workspaceId)) {
      return c.json({ error: 'workspaceId does not match authenticated workspace' }, 403);
    }
    const parsed = CreateKnowledgePageInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    const pageId = await deps.memory.upsertPage({
      workspaceId,
      type: body.type,
      title: body.title,
      compiledTruth: body.compiledTruth,
      tags: body.tags,
      content: body.content,
    });
    return c.json({ id: pageId }, 201);
  });

  // POST /api/knowledge/pages/:pageId/timeline — Add timeline entry
  app.post('/pages/:pageId/timeline', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const { pageId } = c.req.param();
    const page = await deps.memory.getPage(pageId);
    if (!page || page.workspaceId !== workspaceId) {
      return c.json({ error: 'Page not found' }, 404);
    }

    const raw = await c.req.json();
    const parsed = CreateTimelineEntryInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    await deps.memory.addTimeline(pageId, {
      eventType: body.eventType,
      content: body.content,
      source: body.source,
    });
    return c.json({ ok: true }, 201);
  });

  return app;
}

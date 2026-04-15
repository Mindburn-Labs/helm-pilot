import { Hono } from 'hono';
import { YcIntelService } from '@helm-pilot/yc-intel';
import {
  YcPrivateIngestionInput,
  YcPublicIngestionInput,
  YcReplayIngestionInput,
} from '@helm-pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

export function ycRoutes(deps: GatewayDeps) {
  const yc = new YcIntelService(deps.db);
  const app = new Hono();

  // GET /api/yc/companies?q=...&limit=...
  app.get('/companies', async (c) => {
    const q = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? '20');
    const results = await yc.searchCompanies(q, Math.min(limit, 100));
    return c.json(results);
  });

  // GET /api/yc/companies/:id
  app.get('/companies/:id', async (c) => {
    const result = await yc.getCompany(c.req.param('id'));
    if (!result) return c.json({ error: 'Not found' }, 404);
    return c.json(result);
  });

  // GET /api/yc/batches
  app.get('/batches', async (c) => {
    const batches = await yc.listBatches();
    return c.json(batches);
  });

  // GET /api/yc/advice?q=...
  app.get('/advice', async (c) => {
    const q = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? '20');
    const results = await yc.searchAdvice(q, Math.min(limit, 100));
    return c.json(results);
  });

  // GET /api/yc/stats
  app.get('/stats', async (c) => {
    const stats = await yc.getCompanyStats();
    return c.json(stats);
  });

  // GET /api/yc/tags/:tag/advice
  app.get('/tags/:tag/advice', async (c) => {
    const limit = Number(c.req.query('limit') ?? '20');
    const results = await yc.searchAdviceByTag(c.req.param('tag'), Math.min(limit, 100));
    return c.json(results);
  });

  // GET /api/yc/courses/:program
  app.get('/courses/:program', async (c) => {
    const modules = await yc.getCourseModules(c.req.param('program'));
    return c.json(modules);
  });

  // GET /api/yc/ingestion/history
  app.get('/ingestion/history', async (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const history = await yc.getIngestionHistory(Math.min(limit, 100));
    return c.json(history);
  });

  app.get('/ingestion/:id', async (c) => {
    const record = await yc.getIngestionRecord(c.req.param('id'));
    if (!record) return c.json({ error: 'Ingestion record not found' }, 404);
    return c.json(record);
  });

  app.post('/ingestion/public', async (c) => {
    if (!deps.orchestrator.boss) return c.json({ error: 'Background jobs unavailable' }, 503);
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = YcPublicIngestionInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const jobs: Array<{ queue: string; jobId: string | null }> = [];
    if (parsed.data.source === 'companies' || parsed.data.source === 'all') {
      const jobId = await deps.orchestrator.boss.send('pipeline.yc-scrape', {
        workspaceId,
        batch: parsed.data.batch,
        limit: parsed.data.limit,
      });
      jobs.push({ queue: 'pipeline.yc-scrape', jobId: jobId ?? null });
    }

    if (parsed.data.source === 'library' || parsed.data.source === 'all') {
      const jobId = await deps.orchestrator.boss.send('pipeline.startup-school', {
        workspaceId,
        limit: parsed.data.limit,
      });
      jobs.push({ queue: 'pipeline.startup-school', jobId: jobId ?? null });
    }

    return c.json({ queued: true, jobs }, 202);
  });

  app.post('/ingestion/private', async (c) => {
    if (!deps.orchestrator.boss) return c.json({ error: 'Background jobs unavailable' }, 503);
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = YcPrivateIngestionInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const jobId = await deps.orchestrator.boss.send('pipeline.yc-private', {
      workspaceId,
      grantId: parsed.data.grantId,
      action: parsed.data.action,
      limit: parsed.data.limit,
    });

    return c.json({ queued: true, queue: 'pipeline.yc-private', jobId }, 202);
  });

  app.post('/ingestion/replay', async (c) => {
    if (!deps.orchestrator.boss) return c.json({ error: 'Background jobs unavailable' }, 503);
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = YcReplayIngestionInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    let replayPath = parsed.data.replayPath;
    if (!replayPath && parsed.data.ingestionRecordId) {
      const record = await yc.getIngestionRecord(parsed.data.ingestionRecordId);
      replayPath = record?.rawStoragePath ?? undefined;
    }
    if (!replayPath) return c.json({ error: 'Replay source not found' }, 404);

    const queue = parsed.data.source === 'companies' ? 'pipeline.yc-scrape' : 'pipeline.startup-school';
    const jobId = await deps.orchestrator.boss.send(queue, { workspaceId, replayPath });
    return c.json({ queued: true, queue, jobId, replayPath }, 202);
  });

  return app;
}

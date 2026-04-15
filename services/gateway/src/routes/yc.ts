import { Hono } from 'hono';
import { YcIntelService } from '@helm-pilot/yc-intel';
import { type GatewayDeps } from '../index.js';

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

  // Note: POST /ingestion/trigger was removed — the YC scraper is scheduled via
  // pg-boss cron (see pipelines/yc-scraper and services/orchestrator/src/jobs.ts).
  // A proper admin trigger endpoint will be reintroduced in Phase 3 once the
  // scraper is wired through pg-boss.

  return app;
}

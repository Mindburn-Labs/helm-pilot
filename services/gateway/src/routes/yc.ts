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

  // POST /api/yc/ingestion/trigger
  app.post('/ingestion/trigger', async (c) => {
    // Only allow starting jobs if pgBoss is available in gateway deps. Currently we only have deps.db
    // For HELM Pilot architecture, to enqueue jobs from gateway, it needs access to pg-boss.
    // Assuming gateway has it or we just trigger python script? 
    // Actually `deps.db` can be used to insert into pg-boss queue if we had access, 
    // but the task just requested routing API. 
    // To trigger replays from gateway:
    await c.req.json().catch(() => ({}));

    // As a simple approach without pg-boss instantiated in Gateway, 
    // we can use standard child_process if pg-boss isn't available, 
    // or just return 501 Not Implemented if it's meant to be dispatched by orchestrator.
    // For now we'll do 501 and let Orchestrator handle it in production, or insert into pgboss.job table manually.
    return c.json({ error: 'Direct triggering requires pg-boss instance or Orchestrator API.' }, 501);
  });

  return app;
}

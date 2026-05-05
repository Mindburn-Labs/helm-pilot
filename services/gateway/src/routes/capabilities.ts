import { Hono } from 'hono';
import {
  CapabilityKeySchema,
  getCapabilityRecord,
  getCapabilityRecords,
  getCapabilitySummary,
} from '@pilot/shared/capabilities';

export function capabilityRoutes() {
  const app = new Hono();

  app.get('/', (c) => {
    const capabilities = getCapabilityRecords();
    const summary = getCapabilitySummary(capabilities);
    return c.json({
      generatedAt: summary.generatedAt,
      summary,
      capabilities,
    });
  });

  app.get('/:key', (c) => {
    const parsed = CapabilityKeySchema.safeParse(c.req.param('key'));
    if (!parsed.success) {
      return c.json({ error: 'Unknown capability' }, 404);
    }

    const capability = getCapabilityRecord(parsed.data);
    if (!capability) {
      return c.json({ error: 'Unknown capability' }, 404);
    }

    return c.json({ capability });
  });

  return app;
}

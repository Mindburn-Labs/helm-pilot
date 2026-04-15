import { describe, it, expect } from 'vitest';
import { eventRoutes } from '../../routes/events.js';
import { testApp, expectJson } from '../helpers.js';

describe('eventRoutes', () => {
  // ─── GET /tasks ───

  describe('GET /tasks', () => {
    it('returns 400 without workspaceId', async () => {
      const { fetch } = testApp(eventRoutes);
      const res = await fetch('GET', '/tasks');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns 200 with SSE content-type when workspaceId is provided', async () => {
      const { fetch } = testApp(eventRoutes);
      const res = await fetch('GET', '/tasks?workspaceId=ws-1');

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('text/event-stream');
    });
  });
});

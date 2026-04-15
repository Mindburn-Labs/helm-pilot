import { describe, it, expect, vi, beforeEach } from 'vitest';
import { opportunityRoutes } from '../../routes/opportunity.js';
import { testApp, expectJson, mockOpportunity, createMockDeps } from '../helpers.js';

describe('opportunityRoutes', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let fetch: ReturnType<typeof testApp>['fetch'];

  beforeEach(() => {
    const t = testApp(opportunityRoutes);
    deps = t.deps as ReturnType<typeof createMockDeps>;
    fetch = t.fetch;
    deps.db._reset();
  });

  // ── GET / ──

  describe('GET /', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const opps = [mockOpportunity(), mockOpportunity({ id: 'opp-2', title: 'Second' })];
      deps.db._setResult(opps);

      const res = await fetch('GET', '/');
      const json = await expectJson<{ error: string }>(res, 400);
      expect(json.error).toContain('workspaceId');
    });

    it('filters by workspaceId when provided', async () => {
      const opps = [mockOpportunity({ workspaceId: 'ws-42' })];
      deps.db._setResult(opps);

      const res = await fetch('GET', '/?workspaceId=ws-42');
      const json = await expectJson<unknown[]>(res, 200);

      expect(json).toHaveLength(1);
      expect(json[0]).toMatchObject({ workspaceId: 'ws-42' });
    });
  });

  // ── GET /:id ──

  describe('GET /:id', () => {
    it('returns opportunity with scores and tags', async () => {
      const opp = mockOpportunity();
      const scores = [{ id: 's-1', opportunityId: 'opp-1', dimension: 'market', score: 0.8 }];
      const tags = [{ id: 't-1', opportunityId: 'opp-1', tag: 'saas' }];

      // First query: opportunity lookup
      deps.db._setResult([opp]);

      // Override select to return different results on successive calls
      let selectCall = 0;
      const origSelect = deps.db.select;
      deps.db.select = vi.fn(() => {
        selectCall++;
        if (selectCall === 1) {
          deps.db._setResult([opp]);
        } else if (selectCall === 2) {
          deps.db._setResult(scores);
        } else {
          deps.db._setResult(tags);
        }
        return origSelect();
      }) as any;

      const res = await fetch('GET', '/opp-1');
      const json = await expectJson<Record<string, unknown>>(res, 200);

      expect(json.id).toBe('opp-1');
      expect(json.scores).toEqual(scores);
      expect(json.tags).toEqual(tags);
    });

    it('returns 404 when opportunity not found', async () => {
      deps.db._setResult([]);

      const res = await fetch('GET', '/nonexistent');
      const json = await expectJson<{ error: string }>(res, 404);

      expect(json.error).toBe('Not found');
    });
  });

  // ── POST / ──

  describe('POST /', () => {
    it('returns 400 on invalid body (missing source)', async () => {
      const res = await fetch('POST', '/', {
        title: 'Test',
        description: 'Desc',
        // source is missing
      });
      const json = await expectJson<{ error: string }>(res, 400);

      expect(json.error).toBe('Validation failed');
    });

    it('creates opportunity and returns 201', async () => {
      const created = mockOpportunity({ source: 'scraper', title: 'New Opp' });

      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [created]),
          then: (r: any) => r([created]),
        })),
      })) as any;

      const res = await fetch('POST', '/', {
        source: 'scraper',
        title: 'New Opp',
        description: 'A scraped opportunity',
      });
      const json = await expectJson<Record<string, unknown>>(res, 201);

      expect(json.id).toBe('opp-1');
      expect(json.source).toBe('scraper');
    });
  });
});

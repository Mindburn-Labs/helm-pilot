import { describe, it, expect, vi, beforeEach } from 'vitest';
import { knowledgeRoutes } from '../../routes/knowledge.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

describe('knowledgeRoutes', () => {
  // ─── GET /search ───

  describe('GET /search', () => {
    it('returns 400 when q is missing', async () => {
      const { fetch } = testApp(knowledgeRoutes);
      const res = await fetch('GET', '/search');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'q parameter required');
    });

    it('calls memory.search and returns results', async () => {
      const deps = createMockDeps();
      const mockResults = [
        { id: 'page-1', title: 'React Best Practices', score: 0.95 },
        { id: 'page-2', title: 'React Hooks Guide', score: 0.82 },
      ];
      vi.mocked(deps.memory.search).mockResolvedValueOnce(mockResults as any);

      const { fetch } = testApp(knowledgeRoutes, deps);
      const res = await fetch('GET', '/search?q=react');
      const json = await expectJson<typeof mockResults>(res, 200);

      expect(deps.memory.search).toHaveBeenCalledWith('react', {
        types: undefined,
        limit: 20,
      });
      expect(json).toEqual(mockResults);
    });

    it('respects type and limit params', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.memory.search).mockResolvedValueOnce([] as any);

      const { fetch } = testApp(knowledgeRoutes, deps);
      await fetch('GET', '/search?q=test&type=doc,note&limit=5');

      expect(deps.memory.search).toHaveBeenCalledWith('test', {
        types: ['doc', 'note'],
        limit: 5,
      });
    });
  });

  // ─── POST /pages ───

  describe('POST /pages', () => {
    it('returns 400 on invalid body', async () => {
      const { fetch } = testApp(knowledgeRoutes);
      const res = await fetch('POST', '/pages', { title: '' });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Validation failed');
      expect(json).toHaveProperty('details');
    });

    it('returns 201 with page id on success', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.memory.upsertPage).mockResolvedValueOnce('page-42');

      const { fetch } = testApp(knowledgeRoutes, deps);
      const res = await fetch('POST', '/pages', {
        type: 'doc',
        title: 'Getting Started',
        content: 'Welcome to HELM Pilot.',
      });
      const json = await expectJson<{ id: string }>(res, 201);

      expect(json.id).toBe('page-42');
      expect(deps.memory.upsertPage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'doc',
          title: 'Getting Started',
          content: 'Welcome to HELM Pilot.',
        }),
      );
    });
  });

  // ─── POST /pages/:pageId/timeline ───

  describe('POST /pages/:pageId/timeline', () => {
    it('returns 400 on invalid body', async () => {
      const { fetch } = testApp(knowledgeRoutes);
      const res = await fetch('POST', '/pages/page-1/timeline', {});
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Validation failed');
    });

    it('returns 201 on success', async () => {
      const deps = createMockDeps();
      const { fetch } = testApp(knowledgeRoutes, deps);

      const res = await fetch('POST', '/pages/page-1/timeline', {
        eventType: 'note',
        content: 'Updated the roadmap section.',
      });
      const json = await expectJson<{ ok: boolean }>(res, 201);

      expect(json.ok).toBe(true);
      expect(deps.memory.addTimeline).toHaveBeenCalledWith('page-1', {
        eventType: 'note',
        content: 'Updated the roadmap section.',
        source: 'api', // Zod default
      });
    });
  });
});

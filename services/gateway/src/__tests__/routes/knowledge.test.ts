import { describe, it, expect, vi, beforeEach } from 'vitest';
import { knowledgeRoutes } from '../../routes/knowledge.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

describe('knowledgeRoutes', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const wsHeader = { 'X-Workspace-Id': workspaceId };

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
      const res = await fetch('GET', '/search?q=react', undefined, wsHeader);
      const json = await expectJson<typeof mockResults>(res, 200);

      expect(deps.memory.search).toHaveBeenCalledWith('react', {
        types: undefined,
        limit: 20,
        workspaceId,
      });
      expect(json).toEqual(mockResults);
    });

    it('respects type and limit params', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.memory.search).mockResolvedValueOnce([] as any);

      const { fetch } = testApp(knowledgeRoutes, deps);
      await fetch('GET', '/search?q=test&type=doc,note&limit=5', undefined, wsHeader);

      expect(deps.memory.search).toHaveBeenCalledWith('test', {
        types: ['doc', 'note'],
        limit: 5,
        workspaceId,
      });
    });
  });

  // ─── POST /pages ───

  describe('POST /pages', () => {
    it('returns 400 on invalid body', async () => {
      const { fetch } = testApp(knowledgeRoutes);
      const res = await fetch('POST', '/pages', { title: '' }, wsHeader);
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Validation failed');
      expect(json).toHaveProperty('details');
    });

    it('returns 403 when body workspaceId mismatches the bound workspace', async () => {
      const { fetch } = testApp(knowledgeRoutes);
      const res = await fetch(
        'POST',
        '/pages',
        {
          workspaceId: '00000000-0000-4000-8000-000000000002',
          type: 'doc',
          title: 'Getting Started',
        },
        wsHeader,
      );
      const json = await expectJson<{ error: string }>(res, 403);
      expect(json.error).toContain('does not match');
    });

    it('returns 201 with page id on success', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.memory.upsertPage).mockResolvedValueOnce('page-42');

      const { fetch } = testApp(knowledgeRoutes, deps);
      const res = await fetch(
        'POST',
        '/pages',
        {
          type: 'doc',
          title: 'Getting Started',
          content: 'Welcome to Pilot.',
        },
        wsHeader,
      );
      const json = await expectJson<{ id: string }>(res, 201);

      expect(json.id).toBe('page-42');
      expect(deps.memory.upsertPage).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          type: 'doc',
          title: 'Getting Started',
          content: 'Welcome to Pilot.',
        }),
      );
    });
  });

  // ─── POST /pages/:pageId/timeline ───

  describe('POST /pages/:pageId/timeline', () => {
    it('returns 400 on invalid body', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.memory.getPage).mockResolvedValueOnce({ id: 'page-1', workspaceId } as any);
      const { fetch } = testApp(knowledgeRoutes, deps);
      const res = await fetch('POST', '/pages/page-1/timeline', {}, wsHeader);
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'Validation failed');
    });

    it('returns 201 on success', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.memory.getPage).mockResolvedValueOnce({ id: 'page-1', workspaceId } as any);
      const { fetch } = testApp(knowledgeRoutes, deps);

      const res = await fetch(
        'POST',
        '/pages/page-1/timeline',
        {
          eventType: 'note',
          content: 'Updated the roadmap section.',
        },
        wsHeader,
      );
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

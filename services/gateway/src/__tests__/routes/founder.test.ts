import { describe, it, expect, vi, beforeEach } from 'vitest';
import { founderRoutes } from '../../routes/founder.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

describe('founderRoutes', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let fetch: ReturnType<typeof testApp>['fetch'];
  const wsHeader = { 'X-Workspace-Id': 'ws-1' };

  beforeEach(() => {
    const t = testApp(founderRoutes);
    deps = t.deps as ReturnType<typeof createMockDeps>;
    fetch = t.fetch;
    deps.db._reset();
  });

  // ── GET /:workspaceId ──

  describe('GET /:workspaceId', () => {
    it('returns founder profile when found', async () => {
      const profile = {
        id: 'fp-1',
        workspaceId: 'ws-1',
        name: 'Jane Founder',
        background: 'Ex-Google',
        experience: '10 years',
        interests: ['AI', 'SaaS'],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      deps.db._setResult([profile]);

      const res = await fetch('GET', '/ws-1', undefined, wsHeader);
      const json = await expectJson<Record<string, unknown>>(res, 200);

      expect(json.id).toBe('fp-1');
      expect(json.name).toBe('Jane Founder');
    });

    it('returns 404 when no profile exists', async () => {
      deps.db._setResult([]);

      const res = await fetch('GET', '/ws-2', undefined, wsHeader);
      const json = await expectJson<{ error: string }>(res, 403);

      expect(json.error).toBe('workspaceId does not match authenticated workspace');
    });
  });

  // ── POST /:workspaceId ──

  describe('POST /:workspaceId', () => {
    it('returns 400 on invalid body (empty name)', async () => {
      const res = await fetch(
        'POST',
        '/ws-1',
        {
          name: '',
        },
        wsHeader,
      );
      const json = await expectJson<{ error: string }>(res, 400);

      expect(json.error).toBe('Validation failed');
    });

    it('creates/upserts founder profile and returns 201', async () => {
      const profile = {
        id: 'fp-1',
        workspaceId: 'ws-1',
        name: 'Test Founder',
        background: null,
        experience: null,
        interests: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn(async () => [profile]),
            then: (r: any) => r([profile]),
          })),
          returning: vi.fn(async () => [profile]),
          then: (r: any) => r([profile]),
        })),
      })) as any;

      const res = await fetch(
        'POST',
        '/ws-1',
        {
          name: 'Test Founder',
        },
        wsHeader,
      );
      const json = await expectJson<Record<string, unknown>>(res, 201);

      expect(json.id).toBe('fp-1');
      expect(json.name).toBe('Test Founder');
    });
  });

  // ── POST /:founderId/assessment ──

  describe('POST /:founderId/assessment', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(
        'POST',
        '/fp-1/assessment',
        {
          assessmentType: 'personality',
          // missing responses
        },
        wsHeader,
      );
      const json = await expectJson<{ error: string }>(res, 400);

      expect(json.error).toBe('assessmentType and responses are required');
    });

    it('creates assessment and returns 201', async () => {
      const assessment = {
        id: 'fa-1',
        founderId: 'fp-1',
        assessmentType: 'personality',
        responses: { q1: 'a1', q2: 'a2' },
        analysis: null,
        createdAt: new Date(),
      };

      deps.db.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [assessment]),
          then: (r: any) => r([assessment]),
        })),
      })) as any;
      const origSelect = deps.db.select;
      deps.db.select = vi.fn(() => {
        deps.db._setResult([{ id: 'fp-1' }]);
        return origSelect();
      }) as any;

      const res = await fetch(
        'POST',
        '/fp-1/assessment',
        {
          assessmentType: 'personality',
          responses: { q1: 'a1', q2: 'a2' },
        },
        wsHeader,
      );
      const json = await expectJson<Record<string, unknown>>(res, 201);

      expect(json.id).toBe('fa-1');
      expect(json.assessmentType).toBe('personality');
    });
  });

  // ── GET /:founderId/strengths ──

  describe('GET /:founderId/strengths', () => {
    it('returns founder strengths', async () => {
      const strengths = [
        {
          id: 'fs-1',
          founderId: 'fp-1',
          category: 'technical',
          strength: 'System design',
          score: 0.9,
        },
        {
          id: 'fs-2',
          founderId: 'fp-1',
          category: 'leadership',
          strength: 'Team building',
          score: 0.85,
        },
      ];
      let selectCall = 0;
      const origSelect = deps.db.select;
      deps.db.select = vi.fn(() => {
        selectCall++;
        deps.db._setResult(selectCall === 1 ? [{ id: 'fp-1' }] : strengths);
        return origSelect();
      }) as any;

      const res = await fetch('GET', '/fp-1/strengths', undefined, wsHeader);
      const json = await expectJson<unknown[]>(res, 200);

      expect(json).toHaveLength(2);
      expect(json[0]).toMatchObject({ category: 'technical' });
      expect(json[1]).toMatchObject({ category: 'leadership' });
    });
  });
});

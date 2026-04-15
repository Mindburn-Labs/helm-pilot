import { describe, it, expect, vi, beforeEach } from 'vitest';
import { founderRoutes } from '../../routes/founder.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

describe('founderRoutes', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let fetch: ReturnType<typeof testApp>['fetch'];

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

      const res = await fetch('GET', '/ws-1');
      const json = await expectJson<Record<string, unknown>>(res, 200);

      expect(json.id).toBe('fp-1');
      expect(json.name).toBe('Jane Founder');
    });

    it('returns 404 when no profile exists', async () => {
      deps.db._setResult([]);

      const res = await fetch('GET', '/ws-nonexistent');
      const json = await expectJson<{ error: string }>(res, 404);

      expect(json.error).toBe('No founder profile found');
    });
  });

  // ── POST /:workspaceId ──

  describe('POST /:workspaceId', () => {
    it('returns 400 on invalid body (empty name)', async () => {
      const res = await fetch('POST', '/ws-1', {
        name: '',
      });
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

      const res = await fetch('POST', '/ws-1', {
        name: 'Test Founder',
      });
      const json = await expectJson<Record<string, unknown>>(res, 201);

      expect(json.id).toBe('fp-1');
      expect(json.name).toBe('Test Founder');
    });
  });

  // ── POST /:founderId/assessment ──

  describe('POST /:founderId/assessment', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await fetch('POST', '/fp-1/assessment', {
        assessmentType: 'personality',
        // missing responses
      });
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

      const res = await fetch('POST', '/fp-1/assessment', {
        assessmentType: 'personality',
        responses: { q1: 'a1', q2: 'a2' },
      });
      const json = await expectJson<Record<string, unknown>>(res, 201);

      expect(json.id).toBe('fa-1');
      expect(json.assessmentType).toBe('personality');
    });
  });

  // ── GET /:founderId/strengths ──

  describe('GET /:founderId/strengths', () => {
    it('returns founder strengths', async () => {
      const strengths = [
        { id: 'fs-1', founderId: 'fp-1', category: 'technical', strength: 'System design', score: 0.9 },
        { id: 'fs-2', founderId: 'fp-1', category: 'leadership', strength: 'Team building', score: 0.85 },
      ];
      deps.db._setResult(strengths);

      const res = await fetch('GET', '/fp-1/strengths');
      const json = await expectJson<unknown[]>(res, 200);

      expect(json).toHaveLength(2);
      expect(json[0]).toMatchObject({ category: 'technical' });
      expect(json[1]).toMatchObject({ category: 'leadership' });
    });
  });
});

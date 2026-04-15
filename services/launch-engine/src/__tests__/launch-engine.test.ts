import { describe, it, expect } from 'vitest';
import { LaunchEngine } from '../index.js';

// ─── Mock helpers ───

/**
 * Build a chainable mock for read queries:
 * db.select().from().where().orderBy() → results
 * db.select().from().where().limit() → results
 * db.select().from().where() → results
 */
const mockSelectQuery = (results: unknown[]) => ({
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve(results),
        limit: () => Promise.resolve(results),
      }),
    }),
  }),
});

function makeService(queryResults: unknown[]) {
  const db = mockSelectQuery(queryResults) as any;
  return new LaunchEngine(db);
}

// ─── Tests ───

describe('LaunchEngine', () => {
  describe('listArtifacts', () => {
    it('returns artifacts for the workspace', async () => {
      const artifacts = [
        { id: 'a1', workspaceId: 'ws1', name: 'api-server', updatedAt: new Date() },
        { id: 'a2', workspaceId: 'ws1', name: 'web-app', updatedAt: new Date() },
      ];
      const svc = makeService(artifacts);
      const result = await svc.listArtifacts('ws1');
      expect(result).toEqual(artifacts);
    });

    it('returns empty array when no artifacts exist', async () => {
      const svc = makeService([]);
      const result = await svc.listArtifacts('ws-empty');
      expect(result).toEqual([]);
    });

    it('returns artifacts ordered by updatedAt descending', async () => {
      const older = new Date('2026-01-01');
      const newer = new Date('2026-04-01');
      const artifacts = [
        { id: 'a1', name: 'newer', updatedAt: newer },
        { id: 'a2', name: 'older', updatedAt: older },
      ];
      const svc = makeService(artifacts);
      const result = await svc.listArtifacts('ws1');
      // Mock returns in given order (DB ordering is mocked)
      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('newer');
    });
  });

  describe('getArtifact', () => {
    it('returns artifact with versions when found', async () => {
      const artifact = { id: 'a1', name: 'api-server', type: 'docker' };
      const versions = [
        { id: 'v2', artifactId: 'a1', version: 2, tag: 'v0.2.0' },
        { id: 'v1', artifactId: 'a1', version: 1, tag: 'v0.1.0' },
      ];

      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                // First call: artifact query with .limit(1)
                return { limit: () => Promise.resolve([artifact]) };
              }
              // Second call: versions query with .orderBy()
              return { orderBy: () => Promise.resolve(versions) };
            },
          }),
        }),
      } as any;

      const svc = new LaunchEngine(db);
      const result = await svc.getArtifact('a1');
      expect(result).toEqual({ ...artifact, versions });
    });

    it('returns null when artifact not found', async () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as any;

      const svc = new LaunchEngine(db);
      const result = await svc.getArtifact('nonexistent');
      expect(result).toBeNull();
    });

    it('returns artifact with empty versions array', async () => {
      const artifact = { id: 'a1', name: 'fresh-app' };
      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                return { limit: () => Promise.resolve([artifact]) };
              }
              return { orderBy: () => Promise.resolve([]) };
            },
          }),
        }),
      } as any;

      const svc = new LaunchEngine(db);
      const result = await svc.getArtifact('a1');
      expect(result).toEqual({ ...artifact, versions: [] });
    });

    it('includes all artifact fields in result', async () => {
      const artifact = {
        id: 'a1',
        name: 'service',
        type: 'docker',
        workspaceId: 'ws1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                return { limit: () => Promise.resolve([artifact]) };
              }
              return { orderBy: () => Promise.resolve([]) };
            },
          }),
        }),
      } as any;

      const svc = new LaunchEngine(db);
      const result = await svc.getArtifact('a1');
      expect(result).toHaveProperty('id', 'a1');
      expect(result).toHaveProperty('name', 'service');
      expect(result).toHaveProperty('type', 'docker');
      expect(result).toHaveProperty('versions');
    });
  });

  describe('listDeployments', () => {
    it('returns deployments for the workspace', async () => {
      const deployments = [
        { id: 'd1', workspaceId: 'ws1', status: 'succeeded', startedAt: new Date() },
        { id: 'd2', workspaceId: 'ws1', status: 'failed', startedAt: new Date() },
      ];
      const svc = makeService(deployments);
      const result = await svc.listDeployments('ws1');
      expect(result).toEqual(deployments);
    });

    it('returns empty array when no deployments exist', async () => {
      const svc = makeService([]);
      const result = await svc.listDeployments('ws-empty');
      expect(result).toEqual([]);
    });

    it('returns deployments with various statuses', async () => {
      const deployments = [
        { id: 'd1', status: 'succeeded' },
        { id: 'd2', status: 'failed' },
        { id: 'd3', status: 'in_progress' },
        { id: 'd4', status: 'cancelled' },
      ];
      const svc = makeService(deployments);
      const result = await svc.listDeployments('ws1');
      expect(result).toHaveLength(4);
    });
  });

  describe('listDeployTargets', () => {
    it('returns deploy targets for the workspace', async () => {
      const targets = [
        { id: 'dt1', workspaceId: 'ws1', name: 'production', provider: 'aws' },
        { id: 'dt2', workspaceId: 'ws1', name: 'staging', provider: 'do' },
      ];

      // listDeployTargets: select().from().where() — no orderBy
      const db = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(targets),
          }),
        }),
      } as any;

      const svc = new LaunchEngine(db);
      const result = await svc.listDeployTargets('ws1');
      expect(result).toEqual(targets);
    });

    it('returns empty array when no targets exist', async () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      } as any;

      const svc = new LaunchEngine(db);
      const result = await svc.listDeployTargets('ws-empty');
      expect(result).toEqual([]);
    });

    it('returns multiple targets with different providers', async () => {
      const targets = [
        { id: 'dt1', name: 'prod', provider: 'aws' },
        { id: 'dt2', name: 'staging', provider: 'digitalocean' },
        { id: 'dt3', name: 'preview', provider: 'vercel' },
      ];

      const db = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(targets),
          }),
        }),
      } as any;

      const svc = new LaunchEngine(db);
      const result = await svc.listDeployTargets('ws1');
      expect(result).toHaveLength(3);
      expect(result[0]!.provider).toBe('aws');
      expect(result[2]!.provider).toBe('vercel');
    });
  });
});

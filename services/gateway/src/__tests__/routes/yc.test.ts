import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ycRoutes } from '../../routes/yc.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const mockYc = {
  searchCompanies: vi.fn(async () => []),
  getCompany: vi.fn(async () => null),
  listBatches: vi.fn(async () => []),
  searchAdvice: vi.fn(async () => []),
  getCompanyStats: vi.fn(async () => ({})),
  searchAdviceByTag: vi.fn(async () => []),
  getCourseModules: vi.fn(async () => []),
  getIngestionHistory: vi.fn(async () => []),
  getIngestionRecord: vi.fn(async () => null),
};

vi.mock('@helm-pilot/yc-intel', () => ({
  YcIntelService: vi.fn().mockImplementation(() => mockYc),
}));

beforeEach(() => {
  Object.values(mockYc).forEach((fn) => fn.mockClear());
});

describe('ycRoutes', () => {
  // ─── GET /companies ───

  describe('GET /companies', () => {
    it('returns array with empty query', async () => {
      const { fetch } = testApp(ycRoutes);
      const res = await fetch('GET', '/companies');
      const json = await expectJson(res, 200);

      expect(mockYc.searchCompanies).toHaveBeenCalledWith('', 20);
      expect(json).toEqual([]);
    });

    it('returns matching companies', async () => {
      const companies = [
        { id: 'c-1', name: 'Stripe', batch: 'S09' },
        { id: 'c-2', name: 'Stripe Atlas', batch: 'W16' },
      ];
      mockYc.searchCompanies.mockResolvedValueOnce(companies);

      const { fetch } = testApp(ycRoutes);
      const res = await fetch('GET', '/companies?q=stripe&limit=5');
      const json = await expectJson(res, 200);

      expect(mockYc.searchCompanies).toHaveBeenCalledWith('stripe', 5);
      expect(json).toEqual(companies);
    });
  });

  // ─── GET /companies/:id ───

  describe('GET /companies/:id', () => {
    it('returns 404 when company not found', async () => {
      mockYc.getCompany.mockResolvedValueOnce(null);

      const { fetch } = testApp(ycRoutes);
      const res = await fetch('GET', '/companies/c-999');
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Not found');
    });

    it('returns 200 when company found', async () => {
      const company = { id: 'c-1', name: 'Stripe', batch: 'S09', description: 'Payments' };
      mockYc.getCompany.mockResolvedValueOnce(company);

      const { fetch } = testApp(ycRoutes);
      const res = await fetch('GET', '/companies/c-1');
      const json = await expectJson(res, 200);
      expect(json).toEqual(company);
    });
  });

  // ─── GET /batches ───

  describe('GET /batches', () => {
    it('returns array of batches', async () => {
      const batches = [
        { id: 'b-1', name: 'S24', startDate: '2024-06-01' },
        { id: 'b-2', name: 'W25', startDate: '2025-01-01' },
      ];
      mockYc.listBatches.mockResolvedValueOnce(batches);

      const { fetch } = testApp(ycRoutes);
      const res = await fetch('GET', '/batches');
      const json = await expectJson(res, 200);

      expect(mockYc.listBatches).toHaveBeenCalled();
      expect(json).toEqual(batches);
    });
  });

  // ─── GET /advice ───

  describe('GET /advice', () => {
    it('returns array with empty query', async () => {
      const { fetch } = testApp(ycRoutes);
      const res = await fetch('GET', '/advice');
      const json = await expectJson(res, 200);

      expect(mockYc.searchAdvice).toHaveBeenCalledWith('', 20);
      expect(json).toEqual([]);
    });

    it('returns matching advice', async () => {
      const advice = [
        { id: 'a-1', topic: 'fundraising', content: 'Raise when you can, not when you need to.' },
      ];
      mockYc.searchAdvice.mockResolvedValueOnce(advice);

      const { fetch } = testApp(ycRoutes);
      const res = await fetch('GET', '/advice?q=fundraising&limit=10');
      const json = await expectJson(res, 200);

      expect(mockYc.searchAdvice).toHaveBeenCalledWith('fundraising', 10);
      expect(json).toEqual(advice);
    });
  });

  describe('POST /ingestion/public', () => {
    it('queues public ingestion jobs', async () => {
      const deps = createMockDeps();
      const { fetch } = testApp(ycRoutes, deps);

      const res = await fetch(
        'POST',
        '/ingestion/public',
        { source: 'all', limit: 25 },
        { 'X-Workspace-Id': 'ws-1' },
      );
      const json = await expectJson<{ queued: boolean; jobs: Array<{ queue: string }> }>(res, 202);

      expect(json.queued).toBe(true);
      expect(json.jobs.map((job) => job.queue)).toEqual(['pipeline.yc-scrape', 'pipeline.startup-school']);
    });
  });

  describe('POST /ingestion/private', () => {
    it('queues private yc sync job', async () => {
      const grantId = '00000000-0000-4000-8000-000000000001';
      const deps = createMockDeps({
        connectors: {
          getGrantByWorkspaceConnector: vi.fn(async () => ({ id: grantId, workspaceId: 'ws-1' })),
        } as any,
      });
      const { fetch } = testApp(ycRoutes, deps);

      const res = await fetch(
        'POST',
        '/ingestion/private',
        { grantId, action: 'sync', limit: 5 },
        { 'X-Workspace-Id': 'ws-1' },
      );
      const json = await expectJson<{ queued: boolean; queue: string }>(res, 202);

      expect(json).toMatchObject({ queued: true, queue: 'pipeline.yc-private' });
      expect(deps.orchestrator.boss.send).toHaveBeenCalledWith('pipeline.yc-private', {
        workspaceId: 'ws-1',
        grantId,
        action: 'sync',
        limit: 5,
      });
    });
  });

  describe('POST /ingestion/replay', () => {
    it('queues replay from an existing ingestion record', async () => {
      const ingestionRecordId = '00000000-0000-4000-8000-000000000002';
      mockYc.getIngestionRecord.mockResolvedValueOnce({
        id: ingestionRecordId,
        rawStoragePath: '/tmp/yc-companies.json',
      });
      const deps = createMockDeps();
      const { fetch } = testApp(ycRoutes, deps);

      const res = await fetch(
        'POST',
        '/ingestion/replay',
        { source: 'companies', ingestionRecordId },
        { 'X-Workspace-Id': 'ws-1' },
      );
      const json = await expectJson<{ queued: boolean; replayPath: string }>(res, 202);

      expect(json).toMatchObject({ queued: true, replayPath: '/tmp/yc-companies.json' });
      expect(deps.orchestrator.boss.send).toHaveBeenCalledWith('pipeline.yc-scrape', {
        workspaceId: 'ws-1',
        replayPath: '/tmp/yc-companies.json',
      });
    });
  });
});

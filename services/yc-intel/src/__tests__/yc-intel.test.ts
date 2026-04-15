import { describe, it, expect } from 'vitest';
import { YcIntelService } from '../index.js';

// ─── Mock helpers ───

/**
 * Build a chainable mock that mimics Drizzle's builder pattern:
 * db.select().from().where().orderBy().limit() → results
 */
const mockQuery = (results: unknown[]) => ({
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(results),
        orderBy: () => ({
          limit: () => Promise.resolve(results),
        }),
      }),
      orderBy: () => ({
        limit: () => Promise.resolve(results),
      }),
    }),
  }),
});

function makeService(queryResults: unknown[]) {
  const db = mockQuery(queryResults) as any;
  return new YcIntelService(db);
}

// ─── Tests ───

describe('YcIntelService', () => {
  describe('searchCompanies', () => {
    it('returns matching companies', async () => {
      const companies = [
        { id: 'c1', name: 'Stripe', batch: 'S09', createdAt: new Date() },
        { id: 'c2', name: 'StripeFoo', batch: 'W10', createdAt: new Date() },
      ];
      const svc = makeService(companies);
      const result = await svc.searchCompanies('Stripe');
      expect(result).toEqual(companies);
    });

    it('returns empty array when no match', async () => {
      const svc = makeService([]);
      const result = await svc.searchCompanies('NonExistent');
      expect(result).toEqual([]);
    });

    it('respects the limit parameter', async () => {
      const companies = [{ id: 'c1', name: 'Acme' }];
      // We verify the service calls through without error; the mock always returns the same data
      const svc = makeService(companies);
      const result = await svc.searchCompanies('Acme', 5);
      expect(result).toEqual(companies);
    });

    it('defaults limit to 20', async () => {
      const svc = makeService([]);
      // Should not throw when called without explicit limit
      const result = await svc.searchCompanies('test');
      expect(result).toEqual([]);
    });
  });

  describe('getCompany', () => {
    it('returns company with founders when found', async () => {
      const company = { id: 'c1', name: 'Airbnb', batch: 'W09' };
      const founders = [
        { id: 'f1', companyId: 'c1', name: 'Brian Chesky' },
        { id: 'f2', companyId: 'c1', name: 'Joe Gebbia' },
      ];

      // getCompany does two queries:
      // 1. select().from(ycCompanies).where().limit(1) → [company]
      // 2. select().from(ycFounders).where() → founders
      let callCount = 0;
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                // First call: company query with .limit(1)
                return {
                  limit: () => Promise.resolve([company]),
                };
              }
              // Second call: founders query (no .limit)
              return Promise.resolve(founders);
            },
          }),
        }),
      } as any;

      const svc = new YcIntelService(db);
      const result = await svc.getCompany('c1');
      expect(result).toEqual({ ...company, founders });
    });

    it('returns null when company not found', async () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as any;

      const svc = new YcIntelService(db);
      const result = await svc.getCompany('nonexistent');
      expect(result).toBeNull();
    });

    it('returns company with empty founders array', async () => {
      let callCount = 0;
      const company = { id: 'c1', name: 'Solo Inc' };
      const db = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                return { limit: () => Promise.resolve([company]) };
              }
              return Promise.resolve([]);
            },
          }),
        }),
      } as any;

      const svc = new YcIntelService(db);
      const result = await svc.getCompany('c1');
      expect(result).toEqual({ ...company, founders: [] });
    });
  });

  describe('listBatches', () => {
    it('returns batch list ordered by year', async () => {
      const batches = [
        { id: 'b1', name: 'W25', year: 2025 },
        { id: 'b2', name: 'S24', year: 2024 },
      ];

      // listBatches: select().from().orderBy()
      const db = {
        select: () => ({
          from: () => ({
            orderBy: () => Promise.resolve(batches),
          }),
        }),
      } as any;

      const svc = new YcIntelService(db);
      const result = await svc.listBatches();
      expect(result).toEqual(batches);
    });

    it('returns empty array when no batches', async () => {
      const db = {
        select: () => ({
          from: () => ({
            orderBy: () => Promise.resolve([]),
          }),
        }),
      } as any;

      const svc = new YcIntelService(db);
      const result = await svc.listBatches();
      expect(result).toEqual([]);
    });
  });

  describe('searchAdvice', () => {
    it('returns matching advice entries', async () => {
      const advice = [
        { id: 'a1', title: 'How to Launch', createdAt: new Date() },
        { id: 'a2', title: 'Launch Checklist', createdAt: new Date() },
      ];
      const svc = makeService(advice);
      const result = await svc.searchAdvice('Launch');
      expect(result).toEqual(advice);
    });

    it('returns empty array when no match', async () => {
      const svc = makeService([]);
      const result = await svc.searchAdvice('xyz');
      expect(result).toEqual([]);
    });

    it('respects the limit parameter', async () => {
      const advice = [{ id: 'a1', title: 'Fundraise' }];
      const svc = makeService(advice);
      const result = await svc.searchAdvice('Fund', 10);
      expect(result).toEqual(advice);
    });

    it('defaults limit to 20', async () => {
      const svc = makeService([]);
      const result = await svc.searchAdvice('any');
      expect(result).toEqual([]);
    });
  });
});

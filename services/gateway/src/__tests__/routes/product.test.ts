import { describe, it, expect, vi, beforeEach } from 'vitest';
import { productRoutes } from '../../routes/product.js';
import { testApp, expectJson } from '../helpers.js';

const mockFactory = {
  listPlans: vi.fn(async () => []),
  getPlan: vi.fn(async () => null),
  createPlan: vi.fn(async () => ({ id: 'plan-1', title: 'MVP', description: 'Build MVP' })),
  addMilestone: vi.fn(async () => ({ id: 'ms-1', title: 'Alpha', planId: 'plan-1' })),
  getWorkspaceSummary: vi.fn(async () => ({ plans: 0, milestones: 0, completedMilestones: 0 })),
};

vi.mock('@helm-pilot/product-factory', () => ({
  ProductFactory: vi.fn().mockImplementation(() => mockFactory),
}));

beforeEach(() => {
  Object.values(mockFactory).forEach((fn) => fn.mockClear());
});

describe('productRoutes', () => {
  // ─── GET /plans ───

  describe('GET /plans', () => {
    it('returns 400 without workspaceId', async () => {
      const { fetch } = testApp(productRoutes);
      const res = await fetch('GET', '/plans');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns list of plans', async () => {
      const plans = [{ id: 'plan-1', title: 'MVP' }];
      mockFactory.listPlans.mockResolvedValueOnce(plans);

      const { fetch } = testApp(productRoutes);
      const res = await fetch('GET', '/plans?workspaceId=ws-1');
      const json = await expectJson(res, 200);

      expect(mockFactory.listPlans).toHaveBeenCalledWith('ws-1');
      expect(json).toEqual(plans);
    });
  });

  // ─── GET /plans/:id ───

  describe('GET /plans/:id', () => {
    it('returns 404 when plan not found', async () => {
      mockFactory.getPlan.mockResolvedValueOnce(null);

      const { fetch } = testApp(productRoutes);
      const res = await fetch('GET', '/plans/plan-999');
      const json = await expectJson(res, 404);
      expect(json).toHaveProperty('error', 'Not found');
    });

    it('returns 200 when plan found', async () => {
      const plan = { id: 'plan-1', title: 'MVP', description: 'Build MVP' };
      mockFactory.getPlan.mockResolvedValueOnce(plan);

      const { fetch } = testApp(productRoutes);
      const res = await fetch('GET', '/plans/plan-1');
      const json = await expectJson(res, 200);
      expect(json).toEqual(plan);
    });
  });

  // ─── POST /plans ───

  describe('POST /plans', () => {
    it('returns 400 without workspaceId', async () => {
      const { fetch } = testApp(productRoutes);
      const res = await fetch('POST', '/plans', { title: 'MVP', description: 'Build it' });
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns 201 on success', async () => {
      const { fetch } = testApp(productRoutes);
      const res = await fetch('POST', '/plans?workspaceId=ws-1', {
        title: 'MVP',
        description: 'Build MVP',
      });
      const json = await expectJson(res, 201);

      expect(mockFactory.createPlan).toHaveBeenCalledWith('ws-1', 'MVP', 'Build MVP');
      expect(json).toEqual({ id: 'plan-1', title: 'MVP', description: 'Build MVP' });
    });
  });

  // ─── POST /plans/:id/milestones ───

  describe('POST /plans/:id/milestones', () => {
    it('returns 201 on success', async () => {
      const { fetch } = testApp(productRoutes);
      const res = await fetch('POST', '/plans/plan-1/milestones', {
        title: 'Alpha',
        description: 'First alpha release',
      });
      const json = await expectJson(res, 201);

      expect(mockFactory.addMilestone).toHaveBeenCalledWith('plan-1', 'Alpha', 'First alpha release');
      expect(json).toEqual({ id: 'ms-1', title: 'Alpha', planId: 'plan-1' });
    });
  });

  // ─── GET /summary ───

  describe('GET /summary', () => {
    it('returns 400 without workspaceId', async () => {
      const { fetch } = testApp(productRoutes);
      const res = await fetch('GET', '/summary');
      const json = await expectJson(res, 400);
      expect(json).toHaveProperty('error', 'workspaceId required');
    });

    it('returns workspace summary', async () => {
      const summary = { plans: 3, milestones: 12, completedMilestones: 5 };
      mockFactory.getWorkspaceSummary.mockResolvedValueOnce(summary);

      const { fetch } = testApp(productRoutes);
      const res = await fetch('GET', '/summary?workspaceId=ws-1');
      const json = await expectJson(res, 200);

      expect(mockFactory.getWorkspaceSummary).toHaveBeenCalledWith('ws-1');
      expect(json).toEqual(summary);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  CohortAnalyzer,
  FinanceEngine,
  RevenueMetricsCalculator,
  UnitEconomicsCalculator,
} from '../index.js';
import type { Transaction } from '../types.js';

const PERIOD = {
  start: new Date('2026-03-01T00:00:00Z'),
  end: new Date('2026-03-31T23:59:59Z'),
};

const recurringRevenue = (
  id: string,
  customerId: string,
  amount: number,
  date: Date,
): Transaction => ({
  id,
  date,
  amount,
  currency: 'USD',
  type: 'revenue',
  customerId,
  subscriptionId: `sub-${customerId}`,
  isRecurring: true,
});

describe('RevenueMetricsCalculator', () => {
  it('calculates MRR from 3 active subscribers', () => {
    const txns: Transaction[] = [
      recurringRevenue('t1', 'c1', 9900, new Date('2026-03-05')),
      recurringRevenue('t2', 'c2', 9900, new Date('2026-03-10')),
      recurringRevenue('t3', 'c3', 9900, new Date('2026-03-15')),
    ];
    const result = new RevenueMetricsCalculator().calculate(txns, PERIOD);
    expect(result.mrr).toBe(29700);
  });

  it('computes ARR as MRR × 12', () => {
    const txns: Transaction[] = [
      recurringRevenue('t1', 'c1', 9900, new Date('2026-03-05')),
      recurringRevenue('t2', 'c2', 9900, new Date('2026-03-10')),
    ];
    const result = new RevenueMetricsCalculator().calculate(txns, PERIOD);
    expect(result.arr).toBe(result.mrr * 12);
  });

  it('returns refund rate of 0.02 for 2 refunds across 100 revenue txns', () => {
    const revenues: Transaction[] = Array.from({ length: 100 }, (_, i) => ({
      id: `rev-${i}`,
      date: new Date('2026-03-10'),
      amount: 1000,
      currency: 'USD',
      type: 'revenue' as const,
      customerId: `c${i}`,
    }));
    const refunds: Transaction[] = [
      { id: 'ref-1', date: new Date('2026-03-11'), amount: 1000, currency: 'USD', type: 'refund' },
      { id: 'ref-2', date: new Date('2026-03-12'), amount: 1000, currency: 'USD', type: 'refund' },
    ];
    const result = new RevenueMetricsCalculator().calculate([...revenues, ...refunds], PERIOD);
    expect(result.refundRate).toBeCloseTo(0.02, 5);
  });

  it('reports positive growth rate when MRR increases period-over-period', () => {
    const prev: Transaction[] = [recurringRevenue('p1', 'c1', 5000, new Date('2026-02-05'))];
    const curr: Transaction[] = [
      recurringRevenue('c1', 'c1', 5000, new Date('2026-03-05')),
      recurringRevenue('c2', 'c2', 5000, new Date('2026-03-10')),
    ];
    const result = new RevenueMetricsCalculator().calculate([...prev, ...curr], PERIOD);
    expect(result.growthRate).toBeGreaterThan(0);
  });
});

describe('UnitEconomicsCalculator', () => {
  it('computes LTV as revenue × lifespan × margin', () => {
    const result = new UnitEconomicsCalculator().calculate({
      totalMarketingSpend: 100_000,
      customersAcquired: 10,
      avgRevenuePerCustomer: 10_000,
      avgCustomerLifespanMonths: 24,
      grossMarginPercent: 80,
    });
    // 10_000 × 24 × 0.80 = 192_000
    expect(result.ltv).toBe(192_000);
  });

  it('reports a healthy LTV:CAC ratio at 3+', () => {
    const result = new UnitEconomicsCalculator().calculate({
      totalMarketingSpend: 30_000,
      customersAcquired: 10,
      avgRevenuePerCustomer: 10_000,
      avgCustomerLifespanMonths: 12,
      grossMarginPercent: 90,
    });
    // CAC = 3_000, LTV = 10_000 × 12 × 0.9 = 108_000, ratio = 36
    expect(result.ltvCacRatio).toBeGreaterThanOrEqual(3);
  });

  it('computes payback period as CAC / monthly contribution', () => {
    const result = new UnitEconomicsCalculator().calculate({
      totalMarketingSpend: 60_000,
      customersAcquired: 10,
      avgRevenuePerCustomer: 2_000,
      avgCustomerLifespanMonths: 24,
      grossMarginPercent: 50,
    });
    // CAC = 6_000, monthly contribution = 2_000 × 0.5 = 1_000, payback = 6
    expect(result.paybackPeriod).toBe(6);
  });
});

describe('CohortAnalyzer', () => {
  it('reports month-0 retention of 100% and declines over time', () => {
    const txns: Transaction[] = [
      // Two customers acquired in 2026-01
      recurringRevenue('a1', 'c1', 1000, new Date('2026-01-05')),
      recurringRevenue('a2', 'c2', 1000, new Date('2026-01-12')),
      // Only c1 returns in 2026-02
      recurringRevenue('a3', 'c1', 1000, new Date('2026-02-08')),
    ];
    const cohorts = new CohortAnalyzer().analyze(txns);
    const jan = cohorts.find((c) => c.cohortMonth === '2026-01');
    expect(jan).toBeDefined();
    expect(jan!.retentionCurve[0]).toBe(1);
    expect(jan!.retentionCurve[1]).toBeLessThan(1);
  });
});

describe('FinanceEngine.generateReport', () => {
  it('emits a critical alert when LTV:CAC is below 1', async () => {
    const report = await new FinanceEngine().generateReport({
      workspaceId: 'ws-1',
      transactions: [recurringRevenue('t1', 'c1', 1000, new Date('2026-03-05'))],
      period: PERIOD,
      unitEconomicsInputs: {
        totalMarketingSpend: 1_000_000,
        customersAcquired: 10,
        avgRevenuePerCustomer: 1_000,
        avgCustomerLifespanMonths: 6,
        grossMarginPercent: 50,
      },
    });
    const critical = report.alerts.find(
      (a) => a.severity === 'critical' && a.category === 'unit_econ',
    );
    expect(critical).toBeDefined();
    expect(report.unitEconomics!.ltvCacRatio).toBeLessThan(1);
  });

  it('includes a nextAction in every report', async () => {
    const report = await new FinanceEngine().generateReport({
      workspaceId: 'ws-1',
      transactions: [recurringRevenue('t1', 'c1', 9900, new Date('2026-03-05'))],
      period: PERIOD,
    });
    expect(report.nextAction).toBeDefined();
    expect(report.nextAction.title).toBeTruthy();
    expect(report.nextAction.description).toBeTruthy();
    expect(report.nextAction.cta).toBeTruthy();
  });
});

import type { RevenueMetrics, Transaction } from './types.js';

/**
 * RevenueMetricsCalculator — computes MRR, ARR, gross/net revenue, refund and
 * chargeback rates, and month-over-month growth from a flat list of
 * HELM-receipted transactions.
 *
 * All amounts are in integer cents to avoid floating-point drift.
 */
export class RevenueMetricsCalculator {
  calculate(transactions: Transaction[], period: { start: Date; end: Date }): RevenueMetrics {
    const inPeriod = transactions.filter((t) => t.date >= period.start && t.date <= period.end);

    const grossRevenue = sumByType(inPeriod, 'revenue');
    const refunds = sumByType(inPeriod, 'refund');
    const chargebacks = sumByType(inPeriod, 'chargeback');
    const netRevenue = grossRevenue - refunds - chargebacks;

    const revenueCount = countByType(inPeriod, 'revenue');
    const refundCount = countByType(inPeriod, 'refund');
    const chargebackCount = countByType(inPeriod, 'chargeback');

    const refundRate = revenueCount === 0 ? 0 : refundCount / revenueCount;
    const chargebackRate = revenueCount === 0 ? 0 : chargebackCount / revenueCount;

    const mrr = computeMrr(inPeriod, period);
    const arr = mrr * 12;

    const growthRate = computeGrowthRate(transactions, period);

    return {
      mrr,
      arr,
      grossRevenue,
      netRevenue,
      refundRate,
      chargebackRate,
      growthRate,
      period,
      calculatedAt: new Date(),
    };
  }
}

const sumByType = (txns: Transaction[], type: Transaction['type']): number =>
  txns.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0);

const countByType = (txns: Transaction[], type: Transaction['type']): number =>
  txns.filter((t) => t.type === type).length;

/**
 * MRR = sum of active recurring subscription revenue, normalized per month.
 *
 * We count calendar months spanned by the period (rounded up to min 1),
 * so any single calendar month (28-31 days) yields `months = 1` and
 * MRR = sum of recurring revenue in the period.
 */
const computeMrr = (txns: Transaction[], period: { start: Date; end: Date }): number => {
  const recurring = txns.filter((t) => t.type === 'revenue' && t.isRecurring === true);
  const recurringTotal = recurring.reduce((acc, t) => acc + t.amount, 0);
  const months = calendarMonthsSpanned(period.start, period.end);
  return recurringTotal / months;
};

const calendarMonthsSpanned = (start: Date, end: Date): number => {
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const months = end.getUTCMonth() - start.getUTCMonth();
  return Math.max(1, years * 12 + months + 1);
};

/**
 * Growth rate = (this_period_mrr - prev_period_mrr) / prev_period_mrr.
 *
 * Previous period is the window of equal length immediately preceding the
 * current period. Returns 0 when both are zero, 1 when prev is zero but
 * current is positive.
 */
const computeGrowthRate = (all: Transaction[], period: { start: Date; end: Date }): number => {
  const periodMs = period.end.getTime() - period.start.getTime();
  const prevPeriod = {
    start: new Date(period.start.getTime() - periodMs),
    end: new Date(period.start.getTime()),
  };

  const current = all.filter((t) => t.date >= period.start && t.date <= period.end);
  const previous = all.filter((t) => t.date >= prevPeriod.start && t.date < prevPeriod.end);

  const currentMrr = computeMrr(current, period);
  const previousMrr = computeMrr(previous, prevPeriod);

  if (previousMrr === 0) return currentMrr === 0 ? 0 : 1;
  return (currentMrr - previousMrr) / previousMrr;
};

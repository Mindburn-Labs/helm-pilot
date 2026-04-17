import { CohortAnalyzer } from './cohorts.js';
import { RevenueMetricsCalculator } from './metrics.js';
import { UnitEconomicsCalculator } from './unit-economics.js';
import type {
  FinanceAlert,
  FinanceReport,
  RevenueMetrics,
  Transaction,
  UnitEconomics,
} from './types.js';

export type {
  CohortAnalysis,
  FinanceAlert,
  FinanceReport,
  RevenueMetrics,
  Transaction,
  UnitEconomics,
} from './types.js';
export { CohortAnalyzer } from './cohorts.js';
export { RevenueMetricsCalculator } from './metrics.js';
export { UnitEconomicsCalculator } from './unit-economics.js';

interface GenerateReportParams {
  workspaceId: string;
  transactions: Transaction[];
  period: { start: Date; end: Date };
  unitEconomicsInputs?: {
    totalMarketingSpend: number;
    customersAcquired: number;
    avgRevenuePerCustomer?: number;
    avgCustomerLifespanMonths?: number;
    grossMarginPercent?: number;
  };
}

/**
 * FinanceEngine — composes revenue, unit-economics, and cohort calculators
 * into a single `FinanceReport`. Thresholded alerts and a composite health
 * score are derived from calculator outputs; no data is persisted here.
 *
 * Everything is deterministic given the same inputs (aside from timestamps),
 * so reports can be re-derived from HELM-receipted transactions for full
 * reproducibility.
 */
export class FinanceEngine {
  private readonly revenue = new RevenueMetricsCalculator();
  private readonly unitEcon = new UnitEconomicsCalculator();
  private readonly cohorts = new CohortAnalyzer();

  async generateReport(params: GenerateReportParams): Promise<FinanceReport> {
    const { workspaceId, transactions, period, unitEconomicsInputs } = params;

    const revenueMetrics = this.revenue.calculate(transactions, period);

    const unitEconomics = unitEconomicsInputs
      ? this.unitEcon.calculate({
          totalMarketingSpend: unitEconomicsInputs.totalMarketingSpend,
          customersAcquired: unitEconomicsInputs.customersAcquired,
          avgRevenuePerCustomer:
            unitEconomicsInputs.avgRevenuePerCustomer ??
            deriveAvgRevenuePerCustomer(transactions),
          avgCustomerLifespanMonths: unitEconomicsInputs.avgCustomerLifespanMonths ?? 12,
          grossMarginPercent: unitEconomicsInputs.grossMarginPercent ?? 70,
        })
      : undefined;

    const cohorts = this.cohorts.analyze(transactions);

    const alerts = buildAlerts(revenueMetrics, unitEconomics);
    const healthScore = computeHealthScore(revenueMetrics, unitEconomics);
    const nextAction = selectNextAction(revenueMetrics, unitEconomics);

    return {
      workspaceId,
      revenueMetrics,
      unitEconomics,
      cohorts,
      healthScore,
      alerts,
      nextAction,
      generatedAt: new Date(),
    };
  }
}

const deriveAvgRevenuePerCustomer = (txns: Transaction[]): number => {
  const byCustomer = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== 'revenue' || t.customerId === undefined) continue;
    byCustomer.set(t.customerId, (byCustomer.get(t.customerId) ?? 0) + t.amount);
  }
  if (byCustomer.size === 0) return 0;
  const total = Array.from(byCustomer.values()).reduce((acc, v) => acc + v, 0);
  return total / byCustomer.size;
};

const buildAlerts = (
  revenue: RevenueMetrics,
  unit: UnitEconomics | undefined,
): FinanceAlert[] => {
  const alerts: FinanceAlert[] = [];

  // ── Critical ───────────────────────────────────────
  if (revenue.growthRate <= -0.2) {
    alerts.push({
      severity: 'critical',
      category: 'revenue',
      title: 'MRR declined 20%+ MoM',
      description: `Growth rate is ${(revenue.growthRate * 100).toFixed(1)}%. Investigate churn and acquisition.`,
    });
  }
  if (unit && unit.ltvCacRatio > 0 && unit.ltvCacRatio < 1) {
    alerts.push({
      severity: 'critical',
      category: 'unit_econ',
      title: 'LTV:CAC below 1',
      description: `Each customer costs more to acquire than they return. Ratio: ${unit.ltvCacRatio.toFixed(2)}.`,
    });
  }
  if (revenue.chargebackRate > 0.01) {
    alerts.push({
      severity: 'critical',
      category: 'revenue',
      title: 'Chargeback rate above 1%',
      description: `Chargeback rate is ${(revenue.chargebackRate * 100).toFixed(2)}%. Risk of processor penalties.`,
    });
  }

  // ── Warning ────────────────────────────────────────
  if (revenue.growthRate < -0.05 && revenue.growthRate > -0.2) {
    alerts.push({
      severity: 'warning',
      category: 'revenue',
      title: 'MRR declined 5-20% MoM',
      description: `Growth rate is ${(revenue.growthRate * 100).toFixed(1)}%. Trend is worsening.`,
    });
  }
  if (unit && unit.ltvCacRatio >= 1 && unit.ltvCacRatio < 3) {
    alerts.push({
      severity: 'warning',
      category: 'unit_econ',
      title: 'LTV:CAC between 1 and 3',
      description: `Ratio is ${unit.ltvCacRatio.toFixed(2)}. Healthy SaaS benchmark is 3+.`,
    });
  }
  if (unit && unit.paybackPeriod > 12) {
    alerts.push({
      severity: 'warning',
      category: 'unit_econ',
      title: 'Payback period exceeds 12 months',
      description: `CAC recovers in ${unit.paybackPeriod.toFixed(1)} months. Cash cycle is slow.`,
    });
  }

  // ── Info ───────────────────────────────────────────
  if (revenue.mrr > 0 && revenue.mrr < 100_000) {
    alerts.push({
      severity: 'info',
      category: 'revenue',
      title: 'First MRR milestone',
      description: `MRR is ${formatCents(revenue.mrr)}. Keep compounding.`,
    });
  }
  if (revenue.growthRate > 0) {
    alerts.push({
      severity: 'info',
      category: 'revenue',
      title: 'Positive growth',
      description: `MRR is up ${(revenue.growthRate * 100).toFixed(1)}% period-over-period.`,
    });
  }

  return alerts;
};

/**
 * Health score: weighted composite 0-100.
 *   growth      40%
 *   unit econ   30%
 *   margin      20%
 *   churn       10%
 */
const computeHealthScore = (
  revenue: RevenueMetrics,
  unit: UnitEconomics | undefined,
): number => {
  const growthScore = clamp01((revenue.growthRate + 0.2) / 0.4) * 100;
  const ltvCacScore = unit ? clamp01(unit.ltvCacRatio / 5) * 100 : 50;
  const marginScore = unit ? clamp01(unit.grossMarginPercent / 100) * 100 : 50;
  const churnScore = (1 - clamp01(revenue.refundRate + revenue.chargebackRate)) * 100;

  const composite =
    growthScore * 0.4 + ltvCacScore * 0.3 + marginScore * 0.2 + churnScore * 0.1;

  return Math.round(clamp01(composite / 100) * 100);
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const selectNextAction = (
  revenue: RevenueMetrics,
  unit: UnitEconomics | undefined,
): { title: string; description: string; cta: string } => {
  if (unit && unit.ltvCacRatio > 0 && unit.ltvCacRatio < 1) {
    return {
      title: 'Reduce CAC immediately',
      description: `LTV:CAC is ${unit.ltvCacRatio.toFixed(2)} — every new customer destroys value. Pause paid acquisition or optimize ads.`,
      cta: 'Review acquisition channels',
    };
  }
  if (unit && unit.ltvCacRatio >= 5) {
    return {
      title: 'Increase prices',
      description: `LTV:CAC is ${unit.ltvCacRatio.toFixed(1)} — you have pricing headroom to absorb a raise.`,
      cta: 'Test a price increase',
    };
  }
  if (revenue.growthRate < -0.05) {
    return {
      title: 'Diagnose churn',
      description: `MRR is shrinking (${(revenue.growthRate * 100).toFixed(1)}%). Pull a cohort retention report and interview recent churns.`,
      cta: 'Run churn diagnostic',
    };
  }
  if (revenue.chargebackRate > 0.01) {
    return {
      title: 'Address chargebacks',
      description: `Chargeback rate is ${(revenue.chargebackRate * 100).toFixed(2)}%. Tighten fraud rules and refund policy.`,
      cta: 'Review chargebacks',
    };
  }
  if (unit && unit.paybackPeriod > 12) {
    return {
      title: 'Shorten payback period',
      description: `CAC takes ${unit.paybackPeriod.toFixed(1)} months to recover. Consider annual plans or deposits.`,
      cta: 'Offer annual plan',
    };
  }
  return {
    title: 'Keep compounding',
    description: 'Metrics are healthy. Focus on the next growth lever.',
    cta: 'Plan next experiment',
  };
};

const formatCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

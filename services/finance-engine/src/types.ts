export interface Transaction {
  id: string;
  date: Date;
  amount: number; // in cents
  currency: string; // ISO 4217
  type: 'revenue' | 'refund' | 'chargeback' | 'expense';
  category?: string;
  customerId?: string;
  subscriptionId?: string;
  isRecurring?: boolean;
}

export interface RevenueMetrics {
  mrr: number; // monthly recurring revenue in cents
  arr: number; // annual recurring revenue
  grossRevenue: number;
  netRevenue: number;
  refundRate: number; // 0-1
  chargebackRate: number;
  growthRate: number; // month-over-month, 0-1
  period: { start: Date; end: Date };
  calculatedAt: Date;
}

export interface UnitEconomics {
  cac: number; // customer acquisition cost (cents)
  ltv: number; // lifetime value (cents)
  ltvCacRatio: number; // ltv/cac — healthy >3
  paybackPeriod: number; // months to recoup CAC
  grossMarginPercent: number; // 0-100
  calculatedAt: Date;
}

export interface CohortAnalysis {
  cohortMonth: string; // YYYY-MM
  size: number;
  retained: number[]; // retained at month 0, 1, 2, ...
  retentionCurve: number[]; // 0-1 at each month
}

export interface FinanceReport {
  workspaceId: string;
  revenueMetrics: RevenueMetrics;
  unitEconomics?: UnitEconomics;
  cohorts?: CohortAnalysis[];
  healthScore: number; // 0-100 composite
  alerts: FinanceAlert[];
  nextAction: { title: string; description: string; cta: string };
  generatedAt: Date;
}

export interface FinanceAlert {
  severity: 'info' | 'warning' | 'critical';
  category: 'revenue' | 'churn' | 'margin' | 'runway' | 'unit_econ';
  title: string;
  description: string;
}

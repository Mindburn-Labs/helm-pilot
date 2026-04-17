import type { UnitEconomics } from './types.js';

/**
 * UnitEconomicsCalculator — CAC, LTV, LTV:CAC ratio, and payback period.
 *
 * All monetary inputs and outputs are in integer cents.
 * `grossMarginPercent` is 0-100 (not 0-1).
 */
export class UnitEconomicsCalculator {
  calculate(params: {
    totalMarketingSpend: number;
    customersAcquired: number;
    avgRevenuePerCustomer: number;
    avgCustomerLifespanMonths: number;
    grossMarginPercent: number;
  }): UnitEconomics {
    const {
      totalMarketingSpend,
      customersAcquired,
      avgRevenuePerCustomer,
      avgCustomerLifespanMonths,
      grossMarginPercent,
    } = params;

    const cac = customersAcquired === 0 ? 0 : totalMarketingSpend / customersAcquired;

    const marginRatio = grossMarginPercent / 100;
    const ltv = avgRevenuePerCustomer * avgCustomerLifespanMonths * marginRatio;

    const ltvCacRatio = cac === 0 ? 0 : ltv / cac;

    const monthlyContribution = avgRevenuePerCustomer * marginRatio;
    const paybackPeriod = monthlyContribution === 0 ? 0 : cac / monthlyContribution;

    return {
      cac,
      ltv,
      ltvCacRatio,
      paybackPeriod,
      grossMarginPercent,
      calculatedAt: new Date(),
    };
  }
}

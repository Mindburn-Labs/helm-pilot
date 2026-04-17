import type { CohortAnalysis, Transaction } from './types.js';

/**
 * CohortAnalyzer — groups customers by first-purchase month and tracks
 * retention (whether they made another revenue purchase) at month+0, +1, +2, …
 *
 * Month-0 retention is always 100% (every cohort member is present at t=0).
 * A customer is "retained" at month N if they have any revenue transaction
 * in that month relative to their first-purchase month.
 */
export class CohortAnalyzer {
  analyze(transactions: Transaction[]): CohortAnalysis[] {
    const revenueTxns = transactions
      .filter((t) => t.type === 'revenue' && t.customerId !== undefined)
      .slice()
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const firstPurchase = new Map<string, Date>();
    for (const t of revenueTxns) {
      const cid = t.customerId!;
      if (!firstPurchase.has(cid)) firstPurchase.set(cid, t.date);
    }

    const cohortMembers = new Map<string, string[]>();
    for (const [customerId, firstDate] of firstPurchase.entries()) {
      const key = monthKey(firstDate);
      const existing = cohortMembers.get(key) ?? [];
      existing.push(customerId);
      cohortMembers.set(key, existing);
    }

    const now = new Date();
    const results: CohortAnalysis[] = [];

    for (const [cohortMonthKey, members] of cohortMembers.entries()) {
      const cohortStart = parseMonthKey(cohortMonthKey);
      const horizon = Math.max(0, monthsBetween(cohortStart, now));

      const retained = Array.from({ length: horizon + 1 }, (_, m) =>
        countRetainedAtMonth(revenueTxns, members, cohortStart, m),
      );
      const retentionCurve = retained.map((count) =>
        members.length === 0 ? 0 : count / members.length,
      );

      results.push({
        cohortMonth: cohortMonthKey,
        size: members.length,
        retained,
        retentionCurve,
      });
    }

    return results.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));
  }
}

const monthKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const parseMonthKey = (key: string): Date => {
  const parts = key.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  return new Date(Date.UTC(year, month - 1, 1));
};

const monthsBetween = (start: Date, end: Date): number => {
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const months = end.getUTCMonth() - start.getUTCMonth();
  return years * 12 + months;
};

const countRetainedAtMonth = (
  txns: Transaction[],
  members: string[],
  cohortStart: Date,
  monthOffset: number,
): number => {
  const windowStart = new Date(
    Date.UTC(cohortStart.getUTCFullYear(), cohortStart.getUTCMonth() + monthOffset, 1),
  );
  const windowEnd = new Date(
    Date.UTC(cohortStart.getUTCFullYear(), cohortStart.getUTCMonth() + monthOffset + 1, 1),
  );

  const memberSet = new Set(members);
  const active = new Set<string>();
  for (const t of txns) {
    if (t.customerId === undefined) continue;
    if (!memberSet.has(t.customerId)) continue;
    if (t.date >= windowStart && t.date < windowEnd) active.add(t.customerId);
  }
  return active.size;
};

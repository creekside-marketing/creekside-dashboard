import type { MonthlyProjection, ScenarioValues } from './types';
import type { LtvResult } from './ltv-calculator';

export interface CustomerMetrics {
  avgCac: number;
  ltvCacRatio: ScenarioValues;
  breakEvenMonth: { low: number | null; bench: number | null; high: number | null };
}

function findBreakEvenMonth(results: MonthlyProjection[], scenario: 'low' | 'bench' | 'high'): number | null {
  for (const p of results) {
    if (p.cumulativeProfit[scenario] > 0) return p.month;
  }
  return null;
}

export function calculateCustomerMetrics(
  results: MonthlyProjection[],
  ltv: LtvResult,
  totalAdSpend: number
): CustomerMetrics {
  const last = results[results.length - 1];
  const totalCustomersBench = last?.cumulativeCustomers.bench ?? 0;
  const avgCac = totalCustomersBench > 0 ? totalAdSpend / totalCustomersBench : 0;
  return {
    avgCac,
    ltvCacRatio: {
      low: avgCac > 0 ? ltv.conservative / avgCac : 0,
      bench: avgCac > 0 ? ltv.base / avgCac : 0,
      high: avgCac > 0 ? ltv.optimistic / avgCac : 0,
    },
    breakEvenMonth: {
      low: findBreakEvenMonth(results, 'low'),
      bench: findBreakEvenMonth(results, 'bench'),
      high: findBreakEvenMonth(results, 'high'),
    },
  };
}

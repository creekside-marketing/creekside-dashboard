import type { CalculatorInputs, CalculatorResults, ScenarioValues } from './types';
import { generateSpendAllocation } from './spend-models';
import { generatePhases, calculateMonthlyProjections } from './roas-calculator';
import { calculateLtv } from './ltv-calculator';
import { calculateCustomerMetrics } from './customer-model';

export function runScenarios(inputs: CalculatorInputs): CalculatorResults {
  const spendAllocation = generateSpendAllocation(inputs.spendModel, inputs.totalBudget, inputs.duration, inputs.customSpendAllocation);
  const phases = generatePhases(inputs.duration);
  const monthly = calculateMonthlyProjections(inputs, spendAllocation, phases);
  const ltv = calculateLtv(inputs);
  const totalAdSpend = spendAllocation.reduce((sum, v) => sum + v, 0);
  const metrics = calculateCustomerMetrics(monthly, ltv, totalAdSpend);
  const last = monthly[monthly.length - 1];

  const sumScenario = (key: 'revenue' | 'profit'): ScenarioValues => ({
    low: monthly.reduce((s, m) => s + m[key].low, 0),
    bench: monthly.reduce((s, m) => s + m[key].bench, 0),
    high: monthly.reduce((s, m) => s + m[key].high, 0),
  });

  return {
    monthly,
    totals: {
      totalAdSpend,
      totalRevenue: sumScenario('revenue'),
      totalProfit: { low: last?.cumulativeProfit.low ?? 0, bench: last?.cumulativeProfit.bench ?? 0, high: last?.cumulativeProfit.high ?? 0 },
      totalCustomers: { low: last?.cumulativeCustomers.low ?? 0, bench: last?.cumulativeCustomers.bench ?? 0, high: last?.cumulativeCustomers.high ?? 0 },
      avgCac: metrics.avgCac,
      estimatedLtv: { low: ltv.conservative, bench: ltv.base, high: ltv.optimistic },
      ltvCacRatio: metrics.ltvCacRatio,
      breakEvenMonth: metrics.breakEvenMonth,
    },
    phases,
  };
}

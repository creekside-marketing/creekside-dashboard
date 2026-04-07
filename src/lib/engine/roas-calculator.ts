import type { CalculatorInputs, MonthlyProjection, Phase, ScenarioValues } from './types';

export function generatePhases(duration: number): Phase[] {
  if (duration <= 3) {
    return [{ label: 'Pilot', startMonth: 1, endMonth: duration, roasMultiplier: 0.7 }];
  }
  if (duration <= 6) {
    const mid = Math.ceil(duration / 2);
    return [
      { label: 'Pilot', startMonth: 1, endMonth: mid, roasMultiplier: 0.7 },
      { label: 'Scale', startMonth: mid + 1, endMonth: duration, roasMultiplier: 1.0 },
    ];
  }
  if (duration <= 18) {
    const third = Math.floor(duration / 3);
    const twoThirds = third * 2;
    return [
      { label: 'Pilot', startMonth: 1, endMonth: third, roasMultiplier: 0.7 },
      { label: 'Scale', startMonth: third + 1, endMonth: twoThirds, roasMultiplier: 1.0 },
      { label: 'Optimize', startMonth: twoThirds + 1, endMonth: duration, roasMultiplier: 1.2 },
    ];
  }
  const quarter = Math.floor(duration / 4);
  const half = quarter * 2;
  const threeQuarters = quarter * 3;
  return [
    { label: 'Pilot', startMonth: 1, endMonth: quarter, roasMultiplier: 0.7 },
    { label: 'Scale', startMonth: quarter + 1, endMonth: half, roasMultiplier: 1.0 },
    { label: 'Optimize', startMonth: half + 1, endMonth: threeQuarters, roasMultiplier: 1.2 },
    { label: 'Scale', startMonth: threeQuarters + 1, endMonth: duration, roasMultiplier: 1.3 },
  ];
}

function getPhaseForMonth(month: number, phases: Phase[]): Phase {
  for (const phase of phases) {
    if (month >= phase.startMonth && month <= phase.endMonth) return phase;
  }
  return phases[phases.length - 1];
}

function scenarioMap(fn: (scenario: 'low' | 'bench' | 'high') => number): ScenarioValues {
  return { low: fn('low'), bench: fn('bench'), high: fn('high') };
}

export function calculateMonthlyProjections(
  inputs: CalculatorInputs,
  spendAllocation: number[],
  phases: Phase[]
): MonthlyProjection[] {
  const projections: MonthlyProjection[] = [];
  const cumProfit: ScenarioValues = { low: 0, bench: 0, high: 0 };
  const cumCustomers: ScenarioValues = { low: 0, bench: 0, high: 0 };

  for (let i = 0; i < spendAllocation.length; i++) {
    const month = i + 1;
    const adSpend = spendAllocation[i];
    const phase = getPhaseForMonth(month, phases);

    const revenue = scenarioMap((s) => adSpend * inputs.roasAssumptions[s] * phase.roasMultiplier);

    const customers = scenarioMap((s) => {
      if (inputs.businessType === 'product' && inputs.productInputs) {
        return inputs.productInputs.aov > 0 ? revenue[s] / inputs.productInputs.aov : 0;
      }
      if (inputs.businessType === 'service' && inputs.serviceInputs) {
        return inputs.serviceInputs.avgContractValue > 0
          ? (revenue[s] / inputs.serviceInputs.avgContractValue) * inputs.serviceInputs.closeRateFromLead
          : 0;
      }
      return 0;
    });

    const cac = customers.bench > 0 ? adSpend / customers.bench : 0;

    const profit = scenarioMap((s) => {
      const costOfGoods =
        inputs.businessType === 'product' && inputs.productInputs
          ? customers[s] * inputs.productInputs.cogs
          : 0;
      return revenue[s] - adSpend - costOfGoods;
    });

    cumProfit.low += profit.low;
    cumProfit.bench += profit.bench;
    cumProfit.high += profit.high;
    cumCustomers.low += customers.low;
    cumCustomers.bench += customers.bench;
    cumCustomers.high += customers.high;

    projections.push({
      month, phase: phase.label, adSpend, revenue, customers, cac, profit,
      cumulativeProfit: { ...cumProfit },
      cumulativeCustomers: { ...cumCustomers },
    });
  }
  return projections;
}

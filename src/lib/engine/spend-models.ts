import type { SpendModel } from './types';

export function generateSpendAllocation(
  model: SpendModel,
  totalBudget: number,
  months: number,
  custom?: number[]
): number[] {
  switch (model) {
    case 'uniform':
      return uniformAllocation(totalBudget, months);
    case 'ramp':
      return rampAllocation(totalBudget, months);
    case 'front_load':
      return frontLoadAllocation(totalBudget, months);
    case 'seasonal':
      return seasonalAllocation(totalBudget, months);
    case 'pilot':
      return pilotAllocation(totalBudget, months);
    case 'custom':
      return customAllocation(totalBudget, months, custom);
  }
}

function uniformAllocation(totalBudget: number, months: number): number[] {
  const monthly = totalBudget / months;
  return Array.from({ length: months }, () => monthly);
}

function rampAllocation(totalBudget: number, months: number): number[] {
  const weights = Array.from({ length: months }, (_, i) => {
    const t = months === 1 ? 0.5 : i / (months - 1);
    return 0.4 + 1.2 * t;
  });
  return normalizeToTotal(weights, totalBudget);
}

function frontLoadAllocation(totalBudget: number, months: number): number[] {
  const weights = Array.from({ length: months }, (_, i) => {
    const t = months === 1 ? 0.5 : i / (months - 1);
    return 1.6 - 1.2 * t;
  });
  return normalizeToTotal(weights, totalBudget);
}

function seasonalAllocation(totalBudget: number, months: number): number[] {
  const weights = Array.from({ length: months }, (_, i) => {
    const t = months === 1 ? 0 : (i - (months - 1) / 2) / ((months - 1) / 2 || 1);
    return Math.exp(-2 * t * t);
  });
  return normalizeToTotal(weights, totalBudget);
}

function pilotAllocation(totalBudget: number, months: number): number[] {
  if (months <= 2) {
    return uniformAllocation(totalBudget, months);
  }

  const pilotMonths = 2;
  const remainingMonths = months - pilotMonths;
  const avgMonthly = totalBudget / months;
  const pilotSpend = avgMonthly * 0.2;
  const totalPilotSpend = pilotSpend * pilotMonths;
  const remainingBudget = totalBudget - totalPilotSpend;
  const remainingMonthly = remainingBudget / remainingMonths;

  return [
    ...Array.from({ length: pilotMonths }, () => pilotSpend),
    ...Array.from({ length: remainingMonths }, () => remainingMonthly),
  ];
}

function customAllocation(totalBudget: number, months: number, custom?: number[]): number[] {
  if (!custom || custom.length === 0) {
    return uniformAllocation(totalBudget, months);
  }

  const adjusted = custom.length >= months ? custom.slice(0, months) : [
    ...custom,
    ...Array.from({ length: months - custom.length }, () => custom[custom.length - 1]),
  ];

  return normalizeToTotal(adjusted, totalBudget);
}

function normalizeToTotal(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    return Array.from({ length: weights.length }, () => total / weights.length);
  }
  return weights.map((w) => (w / sum) * total);
}

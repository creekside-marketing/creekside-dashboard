import type { CalculatorInputs } from './types';

export interface LtvResult {
  conservative: number;
  base: number;
  optimistic: number;
}

export function calculateLtv(inputs: CalculatorInputs): LtvResult {
  let baseLtv: number;
  if (inputs.businessType === 'product' && inputs.productInputs) {
    baseLtv = inputs.productInputs.estimatedLtv;
  } else if (inputs.businessType === 'service' && inputs.serviceInputs) {
    baseLtv = inputs.serviceInputs.monthlyRecurringValue * inputs.serviceInputs.clientRetentionMonths;
  } else {
    baseLtv = 0;
  }
  return {
    conservative: baseLtv * inputs.ltvMultipliers.conservative,
    base: baseLtv * inputs.ltvMultipliers.base,
    optimistic: baseLtv * inputs.ltvMultipliers.optimistic,
  };
}

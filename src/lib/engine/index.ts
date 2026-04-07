export type {
  BusinessType, Industry, SpendModel, ScenarioType, RiskLevel,
  IndustryBenchmark, ProductInputs, ServiceInputs, RoasAssumptions, LtvVariants,
  Phase, CalculatorInputs, ScenarioValues, MonthlyProjection, CalculatorTotals, CalculatorResults,
} from './types';
export { INDUSTRY_BENCHMARKS, getDefaultRoasAssumptions } from './benchmarks';
export { generateSpendAllocation } from './spend-models';
export { generatePhases, calculateMonthlyProjections } from './roas-calculator';
export { calculateLtv } from './ltv-calculator';
export type { LtvResult } from './ltv-calculator';
export { calculateCustomerMetrics } from './customer-model';
export type { CustomerMetrics } from './customer-model';
export { runScenarios } from './scenario-engine';

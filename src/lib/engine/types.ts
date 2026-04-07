export type BusinessType = 'product' | 'service';

export type Industry =
  | 'dental_medical'
  | 'home_services'
  | 'ecommerce'
  | 'legal'
  | 'mortgage_financial'
  | 'med_spa'
  | 'saas_b2b'
  | 'meal_prep_food'
  | 'other';

export type SpendModel = 'uniform' | 'ramp' | 'front_load' | 'seasonal' | 'pilot' | 'custom';

export type ScenarioType = 'conservative' | 'base' | 'optimistic';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface IndustryBenchmark {
  industry: Industry;
  label: string;
  cpcRange: [number, number];
  cpaRange: [number, number];
  benchmarkRoas: number;
  riskLevel: RiskLevel;
  recommendedMinBudget: number;
}

export interface ProductInputs {
  price: number;
  cogs: number;
  aov: number;
  estimatedLtv: number;
  grossMargin: number;
}

export interface ServiceInputs {
  avgContractValue: number;
  closeRateFromLead: number;
  clientRetentionMonths: number;
  monthlyRecurringValue: number;
}

export interface RoasAssumptions {
  low: number;
  bench: number;
  high: number;
}

export interface LtvVariants {
  conservative: number;
  base: number;
  optimistic: number;
}

export interface Phase {
  label: string;
  startMonth: number;
  endMonth: number;
  roasMultiplier: number;
}

export interface CalculatorInputs {
  businessType: BusinessType;
  industry: Industry;
  productInputs?: ProductInputs;
  serviceInputs?: ServiceInputs;
  totalBudget: number;
  duration: number;
  spendModel: SpendModel;
  customSpendAllocation?: number[];
  roasAssumptions: RoasAssumptions;
  ltvMultipliers: LtvVariants;
}

export interface ScenarioValues {
  low: number;
  bench: number;
  high: number;
}

export interface MonthlyProjection {
  month: number;
  phase: string;
  adSpend: number;
  revenue: ScenarioValues;
  customers: ScenarioValues;
  cac: number;
  profit: ScenarioValues;
  cumulativeProfit: ScenarioValues;
  cumulativeCustomers: ScenarioValues;
}

export interface CalculatorTotals {
  totalAdSpend: number;
  totalRevenue: ScenarioValues;
  totalProfit: ScenarioValues;
  totalCustomers: ScenarioValues;
  avgCac: number;
  estimatedLtv: ScenarioValues;
  ltvCacRatio: ScenarioValues;
  breakEvenMonth: { low: number | null; bench: number | null; high: number | null };
}

export interface CalculatorResults {
  monthly: MonthlyProjection[];
  totals: CalculatorTotals;
  phases: Phase[];
}

import type { Industry, BusinessType } from '../types';

export type RevenueTimeframe = 'monthly' | 'annual';
export type BudgetTier = 'conservative' | 'moderate' | 'aggressive';

export interface BudgetCalculatorInputs {
  revenueGoal: number;
  revenueTimeframe: RevenueTimeframe;
  industry: Industry;
  businessType: BusinessType;
  avgDealValue: number;
  conversionRate: number;
  targetGrowthRate: number;
  currentMonthlySpend: number;
}

export interface BudgetRecommendation {
  tier: BudgetTier;
  monthlyBudget: number;
  annualBudget: number;
  budgetAsPercentOfRevenue: number;
  expectedLeadsPerMonth: number;
  expectedCustomersPerMonth: number;
  expectedCpa: number;
  expectedRoas: number;
  monthsToBreakEven: number | null;
}

/** Allocation percentages (0-100, sum to 100) */
export interface BudgetBreakdown {
  search: number;
  social: number;
  retargeting: number;
  creative: number;
}

export interface SpendAssessment {
  status: 'underspending' | 'on-track' | 'overspending';
  gap: number;
  message: string;
}

export interface PlatformSplit {
  google: number;
  meta: number;
  other: number;
  rationale: string;
}

export interface BudgetLimitation {
  icon: 'warning' | 'info' | 'block';
  text: string;
}

export interface SpendLevelRow {
  label: string;
  monthlyBudget: number;
  dailyBudget: number;
  expectedLeads: number;
  expectedCustomers: number;
  costPerCustomer: number;
  isCurrentSpend?: boolean;
  isRecommended?: boolean;
}

export interface DiminishingReturnsPoint {
  monthlyBudget: number;
  effectiveCpa: number;
  marginalCpa: number;
  leads: number;
  customers: number;
  roas: number;
  efficiency: number; // 0-100%, where 100% = linear returns
}

export interface BudgetCalculatorResults {
  monthlyRevenueGoal: number;
  customersNeeded: number;
  leadsNeeded: number;
  recommendations: Record<BudgetTier, BudgetRecommendation>;
  industryAvgBudgetPercent: [number, number];
  industryBenchmarkCpa: [number, number];
  budgetBreakdown: BudgetBreakdown;
  spendAssessment: SpendAssessment | null;
  industryMinBudget: number;
  platformSplit: PlatformSplit;
  budgetLimitations: BudgetLimitation[];
  spendLevelTable: SpendLevelRow[];
  costPerLead: number;
  costPerCustomer: number;
  diminishingReturns: DiminishingReturnsPoint[];
}

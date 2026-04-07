import type { Industry, IndustryBenchmark, RoasAssumptions } from './types';

// Industry benchmarks sourced from WordStream, LocaliQ, Focus Digital, Triple Whale,
// First Page Sage, SaaS Capital, and other authoritative 2024-2025 reports.
export const INDUSTRY_BENCHMARKS: Record<Industry, IndustryBenchmark> = {
  dental_medical: {
    industry: 'dental_medical',
    label: 'Dental & Medical',
    cpcRange: [4.0, 10.0],
    cpaRange: [50, 150],
    benchmarkRoas: 3.5,
    riskLevel: 'low',
    recommendedMinBudget: 2000,
  },
  home_services: {
    industry: 'home_services',
    label: 'Home Services',
    cpcRange: [6, 14],
    cpaRange: [70, 230],
    benchmarkRoas: 3.5,
    riskLevel: 'medium',
    recommendedMinBudget: 2500,
  },
  ecommerce: {
    industry: 'ecommerce',
    label: 'E-Commerce',
    cpcRange: [0.75, 3.5],
    cpaRange: [15, 50],
    benchmarkRoas: 3.0,
    riskLevel: 'medium',
    recommendedMinBudget: 1000,
  },
  legal: {
    industry: 'legal',
    label: 'Legal',
    cpcRange: [5, 25],
    cpaRange: [100, 500],
    benchmarkRoas: 4.0,
    riskLevel: 'high',
    recommendedMinBudget: 5000,
  },
  mortgage_financial: {
    industry: 'mortgage_financial',
    label: 'Mortgage & Financial',
    cpcRange: [3, 15],
    cpaRange: [70, 350],
    benchmarkRoas: 2.5,
    riskLevel: 'high',
    recommendedMinBudget: 5000,
  },
  med_spa: {
    industry: 'med_spa',
    label: 'Med Spa',
    cpcRange: [2.5, 10],
    cpaRange: [50, 200],
    benchmarkRoas: 3.5,
    riskLevel: 'medium',
    recommendedMinBudget: 2500,
  },
  saas_b2b: {
    industry: 'saas_b2b',
    label: 'SaaS / B2B',
    cpcRange: [4, 12],
    cpaRange: [50, 200],
    benchmarkRoas: 2.5,
    riskLevel: 'high',
    recommendedMinBudget: 3000,
  },
  meal_prep_food: {
    industry: 'meal_prep_food',
    label: 'Meal Prep & Food',
    cpcRange: [1.0, 3.5],
    cpaRange: [20, 80],
    benchmarkRoas: 4.0,
    riskLevel: 'medium',
    recommendedMinBudget: 1000,
  },
  other: {
    industry: 'other',
    label: 'Other',
    cpcRange: [2, 8],
    cpaRange: [35, 100],
    benchmarkRoas: 3.5,
    riskLevel: 'medium',
    recommendedMinBudget: 2000,
  },
};

export function getDefaultRoasAssumptions(industry: Industry): RoasAssumptions {
  const bench = INDUSTRY_BENCHMARKS[industry].benchmarkRoas;
  return {
    low: Math.round(bench * 0.6 * 10) / 10,
    bench,
    high: Math.round(bench * 1.5 * 10) / 10,
  };
}

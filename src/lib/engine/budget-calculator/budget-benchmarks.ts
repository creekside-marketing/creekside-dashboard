import type { Industry } from '../types';

export interface BudgetBenchmark {
  avgBudgetAsPercentOfRevenue: [number, number];
  avgCloseRate: number;
  avgDealValue: number;
}

// Budget benchmarks sourced from VIZIsites, Growth-onomics, Practice Proof,
// SaaS Capital, CMO Survey, and other 2024-2025 industry reports.
export const BUDGET_BENCHMARKS: Record<Industry, BudgetBenchmark> = {
  dental_medical: {
    avgBudgetAsPercentOfRevenue: [4, 8],
    avgCloseRate: 0.30,
    avgDealValue: 500,
  },
  home_services: {
    avgBudgetAsPercentOfRevenue: [5, 10],
    avgCloseRate: 0.20,
    avgDealValue: 3000,
  },
  ecommerce: {
    avgBudgetAsPercentOfRevenue: [8, 15],
    avgCloseRate: 0.03,
    avgDealValue: 140,
  },
  legal: {
    avgBudgetAsPercentOfRevenue: [5, 10],
    avgCloseRate: 0.08,
    avgDealValue: 5000,
  },
  mortgage_financial: {
    avgBudgetAsPercentOfRevenue: [5, 10],
    avgCloseRate: 0.04,
    avgDealValue: 4000,
  },
  med_spa: {
    avgBudgetAsPercentOfRevenue: [8, 15],
    avgCloseRate: 0.25,
    avgDealValue: 500,
  },
  saas_b2b: {
    avgBudgetAsPercentOfRevenue: [8, 15],
    avgCloseRate: 0.03,
    avgDealValue: 20000,
  },
  meal_prep_food: {
    avgBudgetAsPercentOfRevenue: [8, 15],
    avgCloseRate: 0.05,
    avgDealValue: 120,
  },
  other: {
    avgBudgetAsPercentOfRevenue: [7, 10],
    avgCloseRate: 0.08,
    avgDealValue: 500,
  },
};

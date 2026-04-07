'use client';

import { useMemo } from 'react';
import type { CalculatorResults } from '@/lib/engine';
import { formatCurrency, formatPercent } from '@/lib/utils/formatters';

export interface DerivedMetrics {
  projectedRevenue: string;
  netProfit: string;
  totalAdSpend: string;
  avgCac: string;
  estimatedLtv: string;
  breakEvenMonth: string;
  ltvCacRatio: string;
  roiPercent: string;
}

export function useDerivedMetrics(results: CalculatorResults | null): DerivedMetrics | null {
  return useMemo(() => {
    if (!results) return null;
    const { totals } = results;
    const roi = totals.totalAdSpend > 0
      ? ((totals.totalRevenue.bench - totals.totalAdSpend) / totals.totalAdSpend) * 100
      : 0;
    return {
      projectedRevenue: formatCurrency(totals.totalRevenue.bench),
      netProfit: formatCurrency(totals.totalProfit.bench),
      totalAdSpend: formatCurrency(totals.totalAdSpend),
      avgCac: formatCurrency(totals.avgCac),
      estimatedLtv: formatCurrency(totals.estimatedLtv.bench),
      breakEvenMonth: totals.breakEvenMonth.bench !== null ? `Month ${totals.breakEvenMonth.bench}` : 'N/A',
      ltvCacRatio: totals.avgCac > 0 ? `${(totals.ltvCacRatio.bench).toFixed(1)}x` : 'N/A',
      roiPercent: formatPercent(roi),
    };
  }, [results]);
}

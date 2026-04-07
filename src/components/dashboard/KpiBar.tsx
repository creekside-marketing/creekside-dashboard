'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { useDerivedMetrics } from '@/hooks/useDerivedMetrics';
import { KpiCard } from '@/components/ui/KpiCard';

export function KpiBar() {
  const { results } = useCalculator();
  const metrics = useDerivedMetrics(results);

  if (!metrics) {
    return <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 h-20 animate-pulse" />
      ))}
    </div>;
  }

  const kpis = [
    { label: 'Projected Revenue', value: metrics.projectedRevenue, trend: 'up' as const },
    { label: 'Net Profit', value: metrics.netProfit, trend: parseFloat(metrics.netProfit.replace(/[^0-9.-]/g, '')) >= 0 ? 'up' as const : 'down' as const },
    { label: 'Total Ad Spend', value: metrics.totalAdSpend, trend: 'neutral' as const },
    { label: 'Avg CAC', value: metrics.avgCac, trend: 'neutral' as const },
    { label: 'Est. LTV', value: metrics.estimatedLtv, trend: 'up' as const },
    { label: 'Break-even', value: metrics.breakEvenMonth, trend: metrics.breakEvenMonth === 'N/A' ? 'down' as const : 'up' as const },
    { label: 'LTV:CAC', value: metrics.ltvCacRatio, trend: 'up' as const },
    { label: 'ROI', value: metrics.roiPercent, trend: parseFloat(metrics.roiPercent) >= 0 ? 'up' as const : 'down' as const },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}

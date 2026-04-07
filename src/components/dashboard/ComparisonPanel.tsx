'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { formatCurrency, formatPercent } from '@/lib/utils/formatters';
import type { CalculatorResults } from '@/lib/engine';
import type { CalculatorState } from '@/lib/context/calculator-reducer';

interface MetricRow {
  label: string;
  savedValue: number;
  currentValue: number;
  format: (n: number) => string;
  higherIsBetter: boolean;
}

function getMetricRows(
  savedResults: CalculatorResults,
  currentResults: CalculatorResults
): MetricRow[] {
  const s = savedResults.totals;
  const c = currentResults.totals;
  return [
    {
      label: 'Revenue',
      savedValue: s.totalRevenue.bench,
      currentValue: c.totalRevenue.bench,
      format: formatCurrency,
      higherIsBetter: true,
    },
    {
      label: 'Net Profit',
      savedValue: s.totalProfit.bench,
      currentValue: c.totalProfit.bench,
      format: formatCurrency,
      higherIsBetter: true,
    },
    {
      label: 'Ad Spend',
      savedValue: s.totalAdSpend,
      currentValue: c.totalAdSpend,
      format: formatCurrency,
      higherIsBetter: false,
    },
    {
      label: 'Avg CAC',
      savedValue: s.avgCac,
      currentValue: c.avgCac,
      format: formatCurrency,
      higherIsBetter: false,
    },
    {
      label: 'Est. LTV',
      savedValue: s.estimatedLtv.bench,
      currentValue: c.estimatedLtv.bench,
      format: formatCurrency,
      higherIsBetter: true,
    },
    {
      label: 'LTV:CAC',
      savedValue: s.ltvCacRatio.bench,
      currentValue: c.ltvCacRatio.bench,
      format: (n: number) => `${n.toFixed(1)}x`,
      higherIsBetter: true,
    },
    {
      label: 'ROI',
      savedValue:
        s.totalAdSpend > 0
          ? ((s.totalRevenue.bench - s.totalAdSpend) / s.totalAdSpend) * 100
          : 0,
      currentValue:
        c.totalAdSpend > 0
          ? ((c.totalRevenue.bench - c.totalAdSpend) / c.totalAdSpend) * 100
          : 0,
      format: (n: number) => formatPercent(n),
      higherIsBetter: true,
    },
    {
      label: 'Customers',
      savedValue: s.totalCustomers.bench,
      currentValue: c.totalCustomers.bench,
      format: (n: number) => Math.round(n).toLocaleString(),
      higherIsBetter: true,
    },
  ];
}

function describeChange(saved: CalculatorState, current: CalculatorState): string[] {
  const changes: string[] = [];
  if (saved.totalBudget !== current.totalBudget)
    changes.push(`Budget: ${formatCurrency(saved.totalBudget)} → ${formatCurrency(current.totalBudget)}`);
  if (saved.duration !== current.duration)
    changes.push(`Duration: ${saved.duration}mo → ${current.duration}mo`);
  if (saved.spendModel !== current.spendModel)
    changes.push(`Spend model: ${saved.spendModel} → ${current.spendModel}`);
  if (saved.industry !== current.industry)
    changes.push(`Industry: ${saved.industry.replace(/_/g, ' ')} → ${current.industry.replace(/_/g, ' ')}`);
  if (saved.businessType !== current.businessType)
    changes.push(`Type: ${saved.businessType} → ${current.businessType}`);
  if (saved.roasAssumptions.bench !== current.roasAssumptions.bench)
    changes.push(`ROAS: ${saved.roasAssumptions.bench}x → ${current.roasAssumptions.bench}x`);
  return changes;
}

export function ComparisonPanel() {
  const { results, savedScenario, clearSavedScenario, state } = useCalculator();

  if (!savedScenario || !results) return null;

  const rows = getMetricRows(savedScenario.results, results);
  const changes = describeChange(savedScenario.state, state);

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--accent)]/20 rounded-xl p-4 sm:p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[var(--text-primary)] font-semibold">Scenario Comparison</h3>
        <button
          onClick={clearSavedScenario}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
        >
          Clear comparison
        </button>
      </div>

      {changes.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {changes.map((c) => (
            <span
              key={c}
              className="text-xs px-2 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)]"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
              <th className="text-left py-2 px-3">Metric</th>
              <th className="text-right py-2 px-3">Scenario A</th>
              <th className="text-right py-2 px-3">Current (B)</th>
              <th className="text-right py-2 px-3">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const diff = row.currentValue - row.savedValue;
              const pctChange =
                row.savedValue !== 0 ? (diff / Math.abs(row.savedValue)) * 100 : 0;
              const isPositive = row.higherIsBetter ? diff > 0 : diff < 0;
              const isNeutral = Math.abs(diff) < 0.01;

              const changeColor = isNeutral
                ? 'text-[var(--text-muted)]'
                : isPositive
                  ? 'text-[var(--success)]'
                  : 'text-[var(--danger)]';

              const arrow = isNeutral ? '' : diff > 0 ? '+' : '';

              return (
                <tr
                  key={row.label}
                  className="border-t border-[var(--border)]/50"
                >
                  <td className="py-2.5 px-3 text-[var(--text-secondary)]">{row.label}</td>
                  <td className="py-2.5 px-3 text-right text-[var(--text-muted)]">
                    {row.format(row.savedValue)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--text-primary)] font-medium">
                    {row.format(row.currentValue)}
                  </td>
                  <td className={`py-2.5 px-3 text-right font-medium ${changeColor}`}>
                    {isNeutral ? (
                      <span className="text-[var(--text-muted)]">--</span>
                    ) : (
                      <>
                        {arrow}
                        {row.format(diff)}{' '}
                        <span className="text-xs opacity-70">
                          ({arrow}{pctChange.toFixed(1)}%)
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

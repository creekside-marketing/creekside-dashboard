'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { formatCurrency, formatNumber } from '@/lib/utils/formatters';

export function MonthlyProjectionsTable() {
  const { results } = useCalculator();

  if (!results) return null;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-4">Monthly Projections</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
              <th className="text-left py-2 px-3">Month</th>
              <th className="text-left py-2 px-3">Phase</th>
              <th className="text-right py-2 px-3">Ad Spend</th>
              <th className="text-right py-2 px-3">Revenue</th>
              <th className="text-right py-2 px-3">Customers</th>
              <th className="text-right py-2 px-3">CAC</th>
              <th className="text-right py-2 px-3">Profit</th>
              <th className="text-right py-2 px-3">Cum. Profit</th>
            </tr>
          </thead>
          <tbody>
            {results.monthly.map((m) => (
              <tr key={m.month} className="border-t border-[var(--border)]/50 hover:bg-[var(--bg-tertiary)]/50">
                <td className="py-2 px-3 text-[var(--text-primary)]">{m.month}</td>
                <td className="py-2 px-3 text-[var(--text-secondary)]">{m.phase}</td>
                <td className="py-2 px-3 text-right text-[var(--text-primary)]">{formatCurrency(m.adSpend)}</td>
                <td className="py-2 px-3 text-right text-[var(--accent)]">{formatCurrency(m.revenue.bench)}</td>
                <td className="py-2 px-3 text-right text-[var(--text-primary)]">
                  {m.customers.bench < 10 ? m.customers.bench.toFixed(1) : formatNumber(Math.round(m.customers.bench))}
                </td>
                <td className="py-2 px-3 text-right text-[var(--text-primary)]">{formatCurrency(m.cac)}</td>
                <td className={`py-2 px-3 text-right font-medium ${m.profit.bench >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {formatCurrency(m.profit.bench)}
                </td>
                <td className={`py-2 px-3 text-right font-medium ${m.cumulativeProfit.bench >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {formatCurrency(m.cumulativeProfit.bench)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

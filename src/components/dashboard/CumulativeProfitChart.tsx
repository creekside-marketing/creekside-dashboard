'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatCurrency } from '@/lib/utils/formatters';

export function CumulativeProfitChart() {
  const { results } = useCalculator();
  if (!results) return null;

  const data = results.monthly.map((m) => ({
    month: `M${m.month}`,
    low: Math.round(m.cumulativeProfit.low),
    bench: Math.round(m.cumulativeProfit.bench),
    high: Math.round(m.cumulativeProfit.high),
  }));

  const breakEven = results.totals.breakEvenMonth.bench;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[var(--text-primary)] text-sm font-medium">Cumulative Profit</h3>
        {breakEven && (
          <span className="text-[var(--accent)] text-xs font-medium bg-[var(--accent-glow)] px-2 py-0.5 rounded-full">
            Break-even: Month {breakEven}
          </span>
        )}
      </div>
      <p className="text-[var(--text-muted)] text-xs mb-4">Running total profit/loss over time</p>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="profitBench" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-bench)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-bench)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} />
          <YAxis stroke="var(--text-muted)" fontSize={12} tickFormatter={(v) => formatCurrency(v)} />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }}
            formatter={(value, name) => [formatCurrency(Number(value ?? 0)), String(name ?? '').charAt(0).toUpperCase() + String(name ?? '').slice(1)]}
          />
          <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
          {breakEven && <ReferenceLine x={`M${breakEven}`} stroke="var(--accent)" strokeDasharray="5 5" label={{ value: 'Break-even', fill: 'var(--accent)', fontSize: 10, position: 'top' }} />}
          <Area type="monotone" dataKey="high" stroke="var(--chart-high)" fill="none" strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="bench" stroke="var(--chart-bench)" fill="url(#profitBench)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="low" stroke="var(--chart-low)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

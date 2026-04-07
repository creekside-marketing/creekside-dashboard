'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatNumber } from '@/lib/utils/formatters';

export function CustomerGrowthChart() {
  const { results } = useCalculator();
  if (!results) return null;

  const data = results.monthly.map((m) => ({
    month: `M${m.month}`,
    low: parseFloat(m.cumulativeCustomers.low.toFixed(1)),
    bench: parseFloat(m.cumulativeCustomers.bench.toFixed(1)),
    high: parseFloat(m.cumulativeCustomers.high.toFixed(1)),
  }));

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 mb-6">
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-1">Cumulative Customer Growth</h3>
      <p className="text-[var(--text-muted)] text-xs mb-4">Total customers acquired over time</p>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="custHigh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-high)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="var(--chart-high)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="custBench" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-bench)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--chart-bench)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} />
          <YAxis stroke="var(--text-muted)" fontSize={12} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }}
            formatter={(value, name) => [Number(value ?? 0).toFixed(1), String(name ?? '').charAt(0).toUpperCase() + String(name ?? '').slice(1)]}
          />
          <Area type="monotone" dataKey="high" stroke="var(--chart-high)" fill="url(#custHigh)" strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="bench" stroke="var(--chart-bench)" fill="url(#custBench)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="low" stroke="var(--chart-low)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

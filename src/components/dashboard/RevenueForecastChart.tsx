'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { formatCurrency } from '@/lib/utils/formatters';

export function RevenueForecastChart() {
  const { results } = useCalculator();

  if (!results) return null;

  const data = results.monthly.map((m) => ({
    month: `M${m.month}`,
    low: Math.round(m.revenue.low),
    bench: Math.round(m.revenue.bench),
    high: Math.round(m.revenue.high),
    adSpend: Math.round(m.adSpend),
  }));

  const phaseBoundaries = results.phases.slice(1).map((p) => p.startMonth);

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 mb-6">
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-1">Revenue Forecast Envelope</h3>
      <div className="flex gap-4 mb-3">
        {results.phases.map((phase, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${
              phase.label === 'Pilot' ? 'bg-[var(--warning)]' :
              phase.label === 'Scale' ? 'bg-[var(--accent)]' :
              'bg-[var(--success)]'
            }`} />
            <span className="text-[var(--text-muted)] text-xs">
              {phase.label} (M{phase.startMonth}-{phase.endMonth})
            </span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="colorHigh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-high)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="var(--chart-high)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorBench" x1="0" y1="0" x2="0" y2="1">
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
          {results.phases.map((phase, i) => (
            <ReferenceArea
              key={i}
              x1={`M${phase.startMonth}`}
              x2={`M${phase.endMonth}`}
              fill={phase.label === 'Pilot' ? 'var(--warning)' : phase.label === 'Scale' ? 'var(--accent)' : 'var(--success)'}
              fillOpacity={0.03}
              label={{ value: phase.label, position: 'insideTopLeft', fill: 'var(--text-muted)', fontSize: 10 }}
            />
          ))}
          {phaseBoundaries.map((month) => (
            <ReferenceLine key={month} x={`M${month}`} stroke="var(--text-muted)" strokeDasharray="5 5" strokeOpacity={0.5} />
          ))}
          <Area type="monotone" dataKey="high" stroke="var(--chart-high)" fill="url(#colorHigh)" strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="bench" stroke="var(--chart-bench)" fill="url(#colorBench)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="low" stroke="var(--chart-low)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          <Area type="monotone" dataKey="adSpend" stroke="var(--text-muted)" fill="none" strokeWidth={1} strokeDasharray="2 2" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCurrency } from '@/lib/utils/formatters';

export function CacVsLtvChart() {
  const { results } = useCalculator();
  if (!results) return null;

  const { avgCac, estimatedLtv, ltvCacRatio } = results.totals;

  const data = [
    { name: 'Conservative', cac: avgCac, ltv: estimatedLtv.low, ratio: ltvCacRatio.low },
    { name: 'Base', cac: avgCac, ltv: estimatedLtv.bench, ratio: ltvCacRatio.bench },
    { name: 'Optimistic', cac: avgCac, ltv: estimatedLtv.high, ratio: ltvCacRatio.high },
  ];

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 mb-6">
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-1">CAC vs LTV</h3>
      <p className="text-[var(--text-muted)] text-xs mb-4">Customer Acquisition Cost compared to Lifetime Value across scenarios</p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} barGap={8} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
          <YAxis stroke="var(--text-muted)" fontSize={12} tickFormatter={(v) => formatCurrency(v)} />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }}
            formatter={(value, name) => [formatCurrency(Number(value ?? 0)), name === 'cac' ? 'CAC' : 'LTV']}
          />
          <Legend formatter={(value) => (value === 'cac' ? 'CAC' : 'LTV')} />
          <Bar dataKey="cac" fill="var(--danger)" radius={[4, 4, 0, 0]} barSize={40} />
          <Bar dataKey="ltv" fill="var(--chart-bench)" radius={[4, 4, 0, 0]} barSize={40} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-center gap-6 mt-3">
        {data.map((d) => (
          <div key={d.name} className="text-center">
            <p className="text-[var(--text-muted)] text-xs">{d.name}</p>
            <p className={`text-sm font-semibold ${d.ratio >= 3 ? 'text-[var(--success)]' : d.ratio >= 1 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}>
              {d.ratio.toFixed(1)}x
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

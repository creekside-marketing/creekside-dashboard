'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { formatCurrency } from '@/lib/utils/formatters';

type MonthlyTrend = {
  month: string; // 'YYYY-MM'
  revenue: number;
  total_expenses: number;
  profit: number;
  margin_pct: number;
  marketing_spend: number;
  new_clients_count: number;
  cac: number | null;
  expenses_by_category: Record<string, number>;
};

type TrendsData = { months: MonthlyTrend[] };

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

const CATEGORY_COLORS: Record<string, string> = {
  Labor: '#3b82f6',
  Software: '#8b5cf6',
  Marketing: '#10b981',
  'Processing Fee': '#f59e0b',
  Others: '#6b7280',
  Taxes: '#ef4444',
  Advertising: '#ec4899',
};

export default function FinanceTrendCharts() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/finance/trends')
      .then(r => r.json())
      .then((d: TrendsData | { error: string }) => {
        if ('error' in d) {
          setErr(d.error);
        } else {
          setData(d);
        }
      })
      .catch(e => setErr(String(e)));
  }, []);

  if (err) return <div className="text-xs text-red-500">Trends error: {err}</div>;
  if (!data) return null;

  const months = data.months.map(m => ({ ...m, label: monthLabel(m.month) }));

  // Build stacked-expenses dataset
  const allCategories = Array.from(
    new Set(data.months.flatMap(m => Object.keys(m.expenses_by_category)))
  );
  const stackedData = months.map(m => {
    const row: Record<string, number | string> = { label: m.label };
    for (const cat of allCategories) {
      row[cat] = m.expenses_by_category[cat] ?? 0;
    }
    return row;
  });

  return (
    <div className="space-y-6 pt-4">
      <h2 className="text-base font-semibold text-slate-900">Month-over-Month Trends</h2>

      {/* Revenue + Expenses + Profit */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Revenue, Expenses & Profit</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={months} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="revenue" fill="#10b981" name="Revenue" />
            <Bar dataKey="total_expenses" fill="#ef4444" name="Expenses" />
            <Line type="monotone" dataKey="profit" stroke="#1e40af" strokeWidth={2} name="Profit" dot />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Expenses by Category — stacked */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Expenses by Category</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={stackedData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {allCategories.map(cat => (
              <Bar key={cat} dataKey={cat} stackId="expenses" fill={CATEGORY_COLORS[cat] ?? '#94a3b8'} name={cat} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Marketing spend + New clients + CAC */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Marketing Spend, New Clients & CAC
        </h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={months} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="left" tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 12 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(v, name) => {
                if (name === 'New clients') return [v, name];
                return [formatCurrency(Number(v)), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="marketing_spend" fill="#10b981" name="Marketing spend" />
            <Line yAxisId="left" type="monotone" dataKey="cac" stroke="#dc2626" strokeWidth={2} name="CAC" dot />
            <Line yAxisId="right" type="monotone" dataKey="new_clients_count" stroke="#7c3aed" strokeWidth={2} name="New clients" dot />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

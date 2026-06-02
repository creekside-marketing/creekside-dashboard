'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { formatCurrency } from '@/lib/utils/formatters';

type ArrSummary = {
  current_mrr: number;
  current_arr: number;
  prior_month_mrr: number;
  mrr_change: number;
  mrr_change_pct: number | null;
  mrr_by_source: Record<string, number>;
  arr_by_source: Record<string, number>;
  trailing_6_months: Array<{
    month: string;
    total_mrr: number;
    net_change_pct: number | null;
  }>;
  forecast: {
    avg_monthly_growth_pct: number;
    projected_mrr_12mo: number;
    projected_arr_12mo: number;
    projected_mrr_24mo: number;
    projected_arr_24mo: number;
    confidence: 'low' | 'medium' | 'high';
    based_on_months: number;
  };
};

const SOURCE_LABELS: Record<string, string> = {
  upwork: 'Upwork',
  partner: 'Partner',
  other: 'Other',
  unknown: 'Unknown',
};

const SOURCE_COLORS: Record<string, string> = {
  upwork: 'text-emerald-700',
  partner: 'text-blue-700',
  other: 'text-purple-700',
  unknown: 'text-slate-500',
};

function formatMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function ConfidencePill({ confidence, basedOn }: { confidence: 'low' | 'medium' | 'high'; basedOn: number }) {
  const styles: Record<string, string> = {
    high: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    medium: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    low: 'bg-slate-50 text-slate-600 ring-slate-600/20',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${styles[confidence]}`}>
      {confidence.toUpperCase()} confidence · {basedOn} mo of data
    </span>
  );
}

export default function ArrSummarySection() {
  const [data, setData] = useState<ArrSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/finance/arr-summary')
      .then(r => r.json())
      .then(d => {
        if (d?.error) setErr(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch(e => {
        setErr(String(e));
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-sm text-slate-500">Loading MRR overview…</div>;
  if (err) return <div className="text-sm text-red-600">MRR overview failed: {err}</div>;
  if (!data) return null;

  const growthSign = data.mrr_change_pct !== null && data.mrr_change_pct >= 0 ? '+' : '';
  const growthColor = data.mrr_change_pct !== null && data.mrr_change_pct >= 0 ? 'text-emerald-700' : 'text-red-600';

  // Filter trailing months that have any data (skip leading zeros that are gaps)
  const visibleTrailing = data.trailing_6_months.filter(m => m.total_mrr > 0);
  const chartData = visibleTrailing.map(m => ({
    label: formatMonthLabel(m.month),
    mrr: m.total_mrr,
  }));

  const sourceEntries = Object.entries(data.mrr_by_source)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4 pt-4">
      <h2 className="text-base font-semibold text-slate-900">MRR Overview</h2>

      {/* ARR + MoM growth + Run-rate forecast row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ARR tile */}
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">ARR (annualized)</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{formatCurrency(data.current_arr)}</p>
          <p className="text-xs text-slate-500 mt-1">
            Current MRR <span className="font-semibold text-slate-700">{formatCurrency(data.current_mrr)}</span>
          </p>
        </div>

        {/* MoM growth tile */}
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">MoM growth</p>
          <p className={`text-2xl font-semibold mt-1 ${growthColor}`}>
            {data.mrr_change_pct !== null ? `${growthSign}${data.mrr_change_pct.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {growthSign}{formatCurrency(data.mrr_change)} vs last month ({formatCurrency(data.prior_month_mrr)})
          </p>
        </div>

        {/* Run-rate forecast tile */}
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">12-mo ARR forecast</p>
            <ConfidencePill confidence={data.forecast.confidence} basedOn={data.forecast.based_on_months} />
          </div>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{formatCurrency(data.forecast.projected_arr_12mo)}</p>
          <p className="text-xs text-slate-500 mt-1">
            At avg{' '}
            <span className="font-semibold text-slate-700">
              {data.forecast.avg_monthly_growth_pct >= 0 ? '+' : ''}
              {data.forecast.avg_monthly_growth_pct.toFixed(1)}%/mo
            </span>{' '}
            · 24mo {formatCurrency(data.forecast.projected_arr_24mo)}
          </p>
        </div>
      </div>

      {/* Per-source MRR breakdown */}
      {sourceEntries.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Current MRR by acquisition source</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 mt-2">
            {sourceEntries.map(([src, mrr]) => {
              const arr = data.arr_by_source[src] ?? mrr * 12;
              const pct = data.current_mrr > 0 ? (mrr / data.current_mrr) * 100 : 0;
              return (
                <div key={src} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className={`font-semibold ${SOURCE_COLORS[src] ?? 'text-slate-900'}`}>
                      {SOURCE_LABELS[src] ?? src}
                    </span>
                    <span className="text-xs text-slate-400">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{formatCurrency(mrr)}/mo</div>
                  <div className="text-xs text-slate-500">{formatCurrency(arr)} ARR</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trailing 6-month MRR chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
            Trailing MRR ({chartData.length} months)
          </p>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  formatter={value => formatCurrency(typeof value === 'number' ? value : Number(value) || 0)}
                  labelStyle={{ color: '#0f172a', fontWeight: 600 }}
                />
                <Bar dataKey="mrr" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

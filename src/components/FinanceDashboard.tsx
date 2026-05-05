'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/formatters';

type CategoryProjection = {
  last_actual: number;
  projected: number;
  overridden: boolean;
  notes?: string;
};

type FinanceData = {
  last_month: {
    month_date: string;
    revenue: number;
    expenses_by_category: Record<string, number>;
    total_expenses: number;
    profit: number;
    margin_pct: number;
  };
  this_month: {
    month_date: string;
    projected_revenue: number;
    projected_expenses_by_category: Record<string, CategoryProjection>;
    projected_total_expenses: number;
    projected_profit: number;
    projected_margin_pct: number;
  };
  categories: string[];
};

function monthLabel(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function FinanceDashboard() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/finance/expenses')
      .then(r => r.json())
      .then((d: FinanceData | { error: string }) => {
        if ('error' in d) {
          setErr(d.error);
          setData(null);
        } else {
          setData(d);
          setErr(null);
        }
        setLoading(false);
      })
      .catch(e => {
        setErr(String(e));
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (cat: string, current: number) => {
    setEditingCategory(cat);
    setEditValue(String(current));
  };

  const saveEdit = async () => {
    if (!editingCategory || !data) return;
    const amount = parseFloat(editValue);
    if (Number.isNaN(amount) || amount < 0) {
      setEditingCategory(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/finance/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month_date: data.this_month.month_date,
          category: editingCategory,
          projected_amount: amount,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        alert(`Save failed: ${json.error ?? res.statusText}`);
      } else {
        load();
      }
    } finally {
      setSaving(false);
      setEditingCategory(null);
    }
  };

  if (loading) return <div className="text-slate-400 text-sm">Loading finance data...</div>;
  if (err) return <div className="text-red-500 text-sm">Error: {err}</div>;
  if (!data) return null;

  const { last_month, this_month, categories } = data;

  return (
    <div className="space-y-6">
      {/* Top tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Tile label={`Expenses (${monthLabel(this_month.month_date)} projected)`} value={formatCurrency(this_month.projected_total_expenses)} valueColor="text-slate-900" />
        <Tile label="This month projected profit" value={formatCurrency(this_month.projected_profit)} valueColor={this_month.projected_profit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Tile label="This month projected margin" value={`${this_month.projected_margin_pct.toFixed(1)}%`} valueColor={this_month.projected_margin_pct >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Tile label={`Last month margin (${monthLabel(last_month.month_date)})`} value={`${last_month.margin_pct.toFixed(1)}%`} valueColor={last_month.margin_pct >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Tile label={`Last month expenses (${monthLabel(last_month.month_date)})`} value={formatCurrency(last_month.total_expenses)} valueColor="text-slate-900" />
      </div>

      {/* Expense breakdown table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Expense breakdown by category</h2>
          <span className="text-xs text-slate-500">
            Click a projected cell to edit. Defaults to last month&apos;s actual.
          </span>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-3 text-left">Category</th>
              <th className="px-6 py-3 text-right">{monthLabel(last_month.month_date)} actual</th>
              <th className="px-6 py-3 text-right">{monthLabel(this_month.month_date)} projected</th>
              <th className="px-6 py-3 text-right">Δ vs last month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map(cat => {
              const proj = this_month.projected_expenses_by_category[cat];
              if (!proj) return null;
              const delta = proj.projected - proj.last_actual;
              const isEditing = editingCategory === cat;
              return (
                <tr key={cat} className="hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm font-medium text-slate-900">{cat}</td>
                  <td className="px-6 py-3 text-right text-sm text-slate-700">{formatCurrency(proj.last_actual)}</td>
                  <td className="px-6 py-3 text-right text-sm">
                    {isEditing ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') setEditingCategory(null);
                        }}
                        disabled={saving}
                        className="w-32 px-2 py-1 border border-emerald-500 rounded text-right"
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(cat, proj.projected)}
                        className={`px-2 py-1 rounded hover:bg-emerald-50 ${proj.overridden ? 'text-emerald-700 font-semibold' : 'text-slate-700'}`}
                        title={proj.overridden ? 'Manually overridden' : 'Default = last month actual. Click to override.'}
                      >
                        {formatCurrency(proj.projected)}
                      </button>
                    )}
                  </td>
                  <td className={`px-6 py-3 text-right text-sm ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${formatCurrency(delta)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold">
            <tr>
              <td className="px-6 py-3 text-sm text-slate-900">Total expenses</td>
              <td className="px-6 py-3 text-right text-sm text-slate-900">{formatCurrency(last_month.total_expenses)}</td>
              <td className="px-6 py-3 text-right text-sm text-slate-900">{formatCurrency(this_month.projected_total_expenses)}</td>
              <td className={`px-6 py-3 text-right text-sm ${this_month.projected_total_expenses - last_month.total_expenses > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {(() => {
                  const d = this_month.projected_total_expenses - last_month.total_expenses;
                  if (d === 0) return '—';
                  return `${d > 0 ? '+' : ''}${formatCurrency(d)}`;
                })()}
              </td>
            </tr>
            <tr className="border-t border-slate-200">
              <td className="px-6 py-3 text-sm text-slate-900">Revenue</td>
              <td className="px-6 py-3 text-right text-sm text-slate-900">{formatCurrency(last_month.revenue)}</td>
              <td className="px-6 py-3 text-right text-sm text-slate-700">{formatCurrency(this_month.projected_revenue)}</td>
              <td className="px-6 py-3 text-right text-sm text-slate-400">—</td>
            </tr>
            <tr>
              <td className="px-6 py-3 text-sm text-slate-900">Profit</td>
              <td className={`px-6 py-3 text-right text-sm font-bold ${last_month.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(last_month.profit)}</td>
              <td className={`px-6 py-3 text-right text-sm font-bold ${this_month.projected_profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(this_month.projected_profit)}</td>
              <td className="px-6 py-3 text-right text-sm text-slate-400">—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Last month figures pull from <code>accounting_entries</code> (Square + Google Sheet sync).
        Projected revenue auto-pulls from active non-retainer clients (same source as the Clients tab tile).
        Expense projections start as a copy of last month and can be overridden inline.
      </p>
    </div>
  );
}

function Tile({ label, value, valueColor }: { label: string; value: string; valueColor: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${valueColor}`}>{value}</p>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/formatters';
import FinanceTrendCharts from './FinanceTrendCharts';
import ArrSummarySection from './ArrSummarySection';

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
    projected_revenue_computed: number;
    projected_revenue_overridden: boolean;
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

type NewClient = { name: string; first_payment_date: string; monthly_mrr: number; mrr_source: 'manual' | 'auto' | 'none' };
type WindowMetrics = {
  start: string;
  end: string;
  marketing_spend: number;
  new_client_count: number;
  new_clients: NewClient[];
  new_mrr_total: number;
  cac: number | null;
  cost_of_new_mrr: number | null;
};
type AcquisitionData = {
  current_window: WindowMetrics;
  prior_window: WindowMetrics;
};

type MrrClientRow = {
  client_id: string | null;
  client_name: string;
  this_month_mrr: number;
  last_month_mrr: number;
  delta: number;
  bucket: 'new' | 'expansion' | 'contraction' | 'churn';
  acquisition_source: string | null;
};
type NetNewMrrData = {
  window_days: number;
  this_window: { start: string; end: string };
  prev_window: { start: string; end: string };
  summary: {
    new_mrr: number;
    expansion_mrr: number;
    contraction_mrr: number;
    churn_mrr: number;
    net_new_mrr: number;
  };
  new_by_source: Record<string, number>;
  new_clients: MrrClientRow[];
  expansion_clients: MrrClientRow[];
  contraction_clients: MrrClientRow[];
  churn_clients: MrrClientRow[];
};

export default function FinanceDashboard() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [acq, setAcq] = useState<AcquisitionData | null>(null);
  const [netNew, setNetNew] = useState<NetNewMrrData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [editingMrrKey, setEditingMrrKey] = useState<string | null>(null);
  const [mrrEditValue, setMrrEditValue] = useState<string>('');
  const [mrrSaving, setMrrSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/finance/expenses').then(r => r.json()),
      fetch('/api/finance/acquisition').then(r => r.json()),
      fetch('/api/finance/net-new-mrr').then(r => r.json()),
    ])
      .then(([expData, acqData, mrrData]) => {
        if (expData?.error) {
          setErr(expData.error);
          setData(null);
        } else {
          setData(expData);
        }
        if (acqData?.error) {
          // Non-fatal: show expense data even if acquisition fails
          setAcq(null);
        } else {
          setAcq(acqData);
        }
        if (mrrData?.error) {
          setNetNew(null);
        } else {
          setNetNew(mrrData);
        }
        setErr(null);
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

  const startMrrEdit = (key: string, current: number) => {
    setEditingMrrKey(key);
    setMrrEditValue(String(current));
  };

  const saveMrrEdit = async (clientName: string, firstPaymentDate: string) => {
    if (!editingMrrKey) return;
    if (mrrEditValue.trim() === '') {
      setEditingMrrKey(null);
      return;
    }
    const amount = parseFloat(mrrEditValue);
    if (Number.isNaN(amount) || amount < 0) {
      alert(`Invalid MRR: "${mrrEditValue}". Enter a non-negative number.`);
      setEditingMrrKey(null);
      return;
    }
    setMrrSaving(true);
    try {
      const res = await fetch('/api/finance/acquisition/mrr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: clientName,
          first_payment_date: firstPaymentDate,
          monthly_mrr: amount,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        alert(`Save failed: ${json.error ?? res.statusText}`);
      } else {
        load();
      }
    } finally {
      setMrrSaving(false);
      setEditingMrrKey(null);
    }
  };

  const startEdit = (cat: string, current: number) => {
    setEditingCategory(cat);
    setEditValue(String(current));
  };

  const saveEdit = async () => {
    if (!editingCategory || !data) return;
    // Allow blank input → cancel edit (do not save)
    if (editValue.trim() === '') {
      setEditingCategory(null);
      return;
    }
    const amount = parseFloat(editValue);
    if (Number.isNaN(amount) || amount < 0) {
      alert(`Invalid amount: "${editValue}". Enter a non-negative number.`);
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
                        type="text"
                        inputMode="decimal"
                        value={editValue}
                        onFocus={e => e.currentTarget.select()}
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
              <td className="px-6 py-3 text-right text-sm">
                {editingCategory === '__revenue__' ? (
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={editValue}
                    onFocus={e => e.currentTarget.select()}
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
                    onClick={() => startEdit('__revenue__', this_month.projected_revenue)}
                    className={`px-2 py-1 rounded hover:bg-emerald-50 ${this_month.projected_revenue_overridden ? 'text-emerald-700 font-semibold' : 'text-slate-700'}`}
                    title={this_month.projected_revenue_overridden ? `Manually overridden. Auto-computed: ${formatCurrency(this_month.projected_revenue_computed)}` : 'Auto-pulled from active non-retainer clients. Click to override.'}
                  >
                    {formatCurrency(this_month.projected_revenue)}
                  </button>
                )}
              </td>
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

      {/* Customer acquisition section */}
      {acq && (
        <div className="space-y-4 pt-4">
          <h2 className="text-base font-semibold text-slate-900">Customer Acquisition (rolling 30 days)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile
              label="Marketing spend (last 30d)"
              value={formatCurrency(acq.current_window.marketing_spend)}
              valueColor="text-slate-900"
              delta={deltaPct(acq.current_window.marketing_spend, acq.prior_window.marketing_spend)}
            />
            <Tile
              label="New clients (last 30d)"
              value={String(acq.current_window.new_client_count)}
              valueColor="text-slate-900"
              delta={deltaAbs(acq.current_window.new_client_count, acq.prior_window.new_client_count)}
            />
            <Tile
              label="CAC (cost per new client)"
              value={acq.current_window.cac !== null ? formatCurrency(acq.current_window.cac) : '—'}
              valueColor={cacColor(acq.current_window.cac, acq.prior_window.cac)}
              delta={deltaPctNullable(acq.current_window.cac, acq.prior_window.cac)}
            />
            <Tile
              label="Cost of New MRR (per $1)"
              value={acq.current_window.cost_of_new_mrr !== null ? `$${acq.current_window.cost_of_new_mrr.toFixed(2)}` : '—'}
              valueColor={cacColor(acq.current_window.cost_of_new_mrr, acq.prior_window.cost_of_new_mrr)}
              delta={deltaPctNullable(acq.current_window.cost_of_new_mrr, acq.prior_window.cost_of_new_mrr)}
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                New clients in last 30 days ({acq.current_window.new_client_count})
              </h3>
              <span className="text-xs text-slate-500">
                Click an MRR cell to set what the client is paying us per month.
              </span>
            </div>
            {acq.current_window.new_clients.length === 0 ? (
              <p className="px-6 py-6 text-sm text-slate-500">No new clients in the window.</p>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-6 py-3 text-left">Name (per Square)</th>
                    <th className="px-6 py-3 text-left">First payment</th>
                    <th className="px-6 py-3 text-right">Monthly MRR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {acq.current_window.new_clients.map(client => {
                    const key = `${client.name}::${client.first_payment_date}`;
                    const isEditing = editingMrrKey === key;
                    return (
                      <tr key={key} className="hover:bg-slate-50">
                        <td className="px-6 py-3 text-sm font-medium text-slate-900">{client.name}</td>
                        <td className="px-6 py-3 text-sm text-slate-600">{client.first_payment_date}</td>
                        <td className="px-6 py-3 text-right text-sm">
                          {isEditing ? (
                            <input
                              autoFocus
                              type="text"
                              inputMode="decimal"
                              value={mrrEditValue}
                              onFocus={e => e.currentTarget.select()}
                              onChange={e => setMrrEditValue(e.target.value)}
                              onBlur={() => saveMrrEdit(client.name, client.first_payment_date)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveMrrEdit(client.name, client.first_payment_date);
                                if (e.key === 'Escape') setEditingMrrKey(null);
                              }}
                              disabled={mrrSaving}
                              className="w-32 px-2 py-1 border border-emerald-500 rounded text-right"
                            />
                          ) : (
                            <button
                              onClick={() => startMrrEdit(key, client.monthly_mrr)}
                              className={`px-2 py-1 rounded hover:bg-emerald-50 ${
                                client.mrr_source === 'manual' ? 'text-emerald-700 font-semibold'
                                : client.mrr_source === 'auto' ? 'text-blue-600'
                                : 'text-slate-400'
                              }`}
                              title={
                                client.mrr_source === 'manual' ? 'Manually entered. Click to change.'
                                : client.mrr_source === 'auto' ? 'Auto-suggested from matched client record. Click to override.'
                                : 'No matching client found. Click to set manually.'
                              }
                            >
                              {client.monthly_mrr > 0 ? formatCurrency(client.monthly_mrr) : '—'}
                              {client.mrr_source === 'auto' && <span className="text-xs text-slate-400 ml-1">(auto)</span>}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold">
                  <tr>
                    <td className="px-6 py-3 text-sm text-slate-900" colSpan={2}>Total New MRR (last 30d)</td>
                    <td className="px-6 py-3 text-right text-sm text-slate-900">{formatCurrency(acq.current_window.new_mrr_total)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Marketing spend = Marketing category (excludes ZipRecruiter, ONLINEJOBSPH) + Queenie&apos;s Labor entries.
            New client = first ever income payment in the last 30 days. Each row&apos;s MRR is what you set manually
            from their contract — auto-detection only knows the first payment amount, not the recurring retainer.
          </p>
        </div>
      )}

      {/* MRR Overview (ARR + growth + per-source + trailing chart + forecast) */}
      <ArrSummarySection />

      {/* Net New MRR breakdown section */}
      {netNew && (
        <div className="space-y-4 pt-4">
          <h2 className="text-base font-semibold text-slate-900">
            Net New MRR (last {netNew.window_days} days)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Tile label="New MRR" value={formatCurrency(netNew.summary.new_mrr)} valueColor="text-emerald-700" />
            <Tile label="Expansion MRR" value={formatCurrency(netNew.summary.expansion_mrr)} valueColor="text-emerald-700" />
            <Tile label="Contraction MRR" value={formatCurrency(netNew.summary.contraction_mrr)} valueColor="text-red-600" />
            <Tile label="Churn MRR" value={formatCurrency(netNew.summary.churn_mrr)} valueColor="text-red-600" />
            <Tile
              label="Net New MRR"
              value={(netNew.summary.net_new_mrr >= 0 ? '+' : '') + formatCurrency(netNew.summary.net_new_mrr)}
              valueColor={netNew.summary.net_new_mrr >= 0 ? 'text-emerald-700' : 'text-red-600'}
            />
          </div>

          {Object.keys(netNew.new_by_source).length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 px-5 py-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">New MRR by source</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
                {Object.entries(netNew.new_by_source).map(([src, amt]) => (
                  <div key={src} className="text-sm">
                    <span className="text-slate-500 capitalize">{src}: </span>
                    <span className="font-semibold text-slate-900">{formatCurrency(amt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <MrrBucketTable title="New clients" rows={netNew.new_clients} amountField="this_month_mrr" showSource />
            <MrrBucketTable title="Expansion" rows={netNew.expansion_clients} amountField="delta" />
            <MrrBucketTable title="Contraction" rows={netNew.contraction_clients} amountField="delta" />
            <MrrBucketTable title="Churn" rows={netNew.churn_clients} amountField="last_month_mrr" />
          </div>

          <p className="text-xs text-slate-500">
            Last {netNew.window_days} days vs prior {netNew.window_days} days.
            MRR = latest paid Square invoice in the window per client.
            Retainer-category rows and AI Agent (platform=&quot;other&quot;) rows are excluded.
            Clients with no Square data fall back to their stored monthly revenue (no expansion / contraction).
          </p>
        </div>
      )}

      <FinanceTrendCharts />
    </div>
  );
}

function deltaPct(current: number, prior: number): { text: string; positive: boolean } | null {
  if (prior === 0) return null;
  const pct = ((current - prior) / prior) * 100;
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs prior 30d`, positive: pct >= 0 };
}

function deltaAbs(current: number, prior: number): { text: string; positive: boolean } | null {
  const diff = current - prior;
  if (diff === 0) return null;
  return { text: `${diff > 0 ? '+' : ''}${diff} vs prior 30d`, positive: diff >= 0 };
}

function deltaPctNullable(current: number | null, prior: number | null): { text: string; positive: boolean } | null {
  if (current === null || prior === null || prior === 0) return null;
  const pct = ((current - prior) / prior) * 100;
  // For CAC / Cost of New MRR, lower is better, so invert "positive"
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs prior 30d`, positive: pct < 0 };
}

function cacColor(current: number | null, prior: number | null): string {
  if (current === null) return 'text-slate-400';
  if (prior === null || prior === 0) return 'text-slate-900';
  return current <= prior ? 'text-emerald-600' : 'text-red-600';
}

function Tile({ label, value, valueColor, delta }: { label: string; value: string; valueColor: string; delta?: { text: string; positive: boolean } | null }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${valueColor}`}>{value}</p>
      {delta && (
        <p className={`text-xs mt-1 ${delta.positive ? 'text-emerald-700' : 'text-red-600'}`}>
          {delta.text}
        </p>
      )}
    </div>
  );
}

function MrrBucketTable({
  title,
  rows,
  amountField,
  showSource,
}: {
  title: string;
  rows: MrrClientRow[];
  amountField: 'this_month_mrr' | 'last_month_mrr' | 'delta';
  showSource?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-500">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">None this month.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => {
              const amt = r[amountField];
              const isNegative = amountField === 'delta' && amt < 0;
              return (
                <tr key={`${title}-${r.client_id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-900">
                    {r.client_name}
                    {showSource && r.acquisition_source && (
                      <span className="ml-2 text-xs text-slate-400 capitalize">({r.acquisition_source})</span>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-right font-medium ${isNegative ? 'text-red-600' : 'text-slate-900'}`}>
                    {isNegative ? '-' : ''}{formatCurrency(Math.abs(amt))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

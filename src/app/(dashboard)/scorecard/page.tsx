'use client';

import React, { useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

interface ChurnRiskEntry {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  factors: string[];
  client_name: string;
}

interface ScorecardData {
  activeClients: number;
  totalAccounts: number;
  totalMonthlyBudget: number;
  estimatedMRR: number;
  platformSplit: { meta: number; google: number };
  ownershipGaps: { noManager: number; noOperator: number };
  topClients: { name: string; budget: number; fee: number; pctOfMRR: number }[];
  churnedCount: number;
  budgetTiers: { under2k: number; '2k_5k': number; '5k_15k': number; over15k: number };
  budgetCoverage: { withBudget: number; total: number };
}

interface PnlMonth {
  monthDate: string;
  month: string;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPct: number;
  laborCost: number;
  softwareCost: number;
  processingFees: number;
  marketingCost: number;
  advertisingCost: number;
  transactionCount: number;
}

interface PnlData {
  pnl: PnlMonth[];
  expensesByMonth: Record<string, { category: string; total: number }[]>;
  laborByMonth: Record<string, { name: string; cost: number }[]>;
}

// ── Formatters ─────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDollar(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

/** Returns tailwind text color class based on profit margin threshold */
function marginColor(margin: number): string {
  if (margin > 15) return 'text-emerald-600';
  if (margin >= 5) return 'text-amber-600';
  return 'text-red-600';
}

/** Returns tailwind bg color class for the bar chart based on profit margin */
function marginBarBg(margin: number): string {
  if (margin > 15) return 'bg-emerald-500';
  if (margin >= 5) return 'bg-amber-400';
  return 'bg-red-400';
}

// ── Page Component ─────────────────────────────────────────────────────

export default function ScorecardPage() {
  const [data, setData] = useState<ScorecardData | null>(null);
  const [pnlData, setPnlData] = useState<PnlData | null>(null);
  const [churnData, setChurnData] = useState<Record<string, ChurnRiskEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/scorecard');
        if (!res.ok) throw new Error('Failed to load scorecard data');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    async function loadPnl() {
      try {
        const res = await fetch('/api/scorecard/pnl');
        if (!res.ok) throw new Error('Failed to load P&L data');
        const json = await res.json();
        setPnlData(json);
      } catch {
        // P&L section shows its own error state; don't block the main scorecard
      } finally {
        setPnlLoading(false);
      }
    }

    async function loadChurn() {
      try {
        const res = await fetch('/api/clients/churn-risk');
        if (!res.ok) return;
        const json = await res.json();
        if (json && !json.error) setChurnData(json);
      } catch {
        // Non-critical — section shows empty state
      }
    }

    load();
    loadPnl();
    loadChurn();
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">KPI Scorecard</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Agency performance at a glance</p>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--border)] border-t-[var(--creekside-blue)]" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">KPI Scorecard</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Agency performance at a glance</p>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-12 text-center text-red-600 text-sm">
          {error || 'Failed to load data'}
        </div>
      </div>
    );
  }

  const tierLabels = [
    { key: 'under2k' as const, label: '< $2k', color: 'bg-slate-400' },
    { key: '2k_5k' as const, label: '$2k - $5k', color: 'bg-blue-400' },
    { key: '5k_15k' as const, label: '$5k - $15k', color: 'bg-emerald-400' },
    { key: 'over15k' as const, label: '$15k+', color: 'bg-purple-500' },
  ];

  const maxTierCount = Math.max(
    ...tierLabels.map((t) => data.budgetTiers[t.key]),
    1
  );

  const hasConcentrationRisk = data.topClients.some((c) => c.pctOfMRR > 20);

  // ── P&L derived values ─────────────────────────────────────────────
  const pnlMonths = pnlData?.pnl ?? [];
  const currentMonth = pnlMonths.length > 0 ? pnlMonths[pnlMonths.length - 1] : null;
  const priorMonth = pnlMonths.length > 1 ? pnlMonths[pnlMonths.length - 2] : null;
  const maxRevenue = Math.max(...pnlMonths.map((m) => m.totalRevenue), 1);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">KPI Scorecard</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Agency performance at a glance</p>
      </div>

      {/* Row 1 -- Primary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Active Clients</p>
          <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">{fmt(data.activeClients)}</p>
          <p className="text-xs text-slate-400 mt-1">{fmt(data.totalAccounts)} total accounts</p>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Estimated MRR</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{fmtDollar(data.estimatedMRR)}</p>
          <p className="text-xs text-slate-400 mt-1">Based on fee tiers</p>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Ad Spend Under Management</p>
          <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">{fmtDollar(data.totalMonthlyBudget)}</p>
          <p className="text-xs text-slate-400 mt-1">Monthly budgets combined</p>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Churned Clients</p>
          <p className={`text-3xl font-bold mt-1 ${data.churnedCount > 0 ? 'text-red-600' : 'text-[var(--text-primary)]'}`}>
            {fmt(data.churnedCount)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {data.churnedCount === 0 ? 'No churn' : 'Review in Archive'}
          </p>
        </div>
      </div>

      {/* ── Churn Risk Summary ─────────────────────────────────────────── */}
      {churnData && (() => {
        const entries = Object.values(churnData);
        const highRisk = entries.filter(e => e.level === 'HIGH').sort((a, b) => b.score - a.score);
        const mediumRisk = entries.filter(e => e.level === 'MEDIUM').sort((a, b) => b.score - a.score);
        const totalAtRisk = highRisk.length + mediumRisk.length;

        if (totalAtRisk === 0) return null;

        return (
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Churn Risk</h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {highRisk.length > 0
                    ? `${highRisk.length} client${highRisk.length !== 1 ? 's' : ''} at high risk`
                    : `${mediumRisk.length} client${mediumRisk.length !== 1 ? 's' : ''} at medium risk`}
                </p>
              </div>
              {highRisk.length > 0 && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
                  {highRisk.length} High Risk
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                    <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Client</th>
                    <th className="text-center py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Risk</th>
                    <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Score</th>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Factors</th>
                  </tr>
                </thead>
                <tbody>
                  {[...highRisk, ...mediumRisk].map((entry) => (
                    <tr key={entry.client_name} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                      <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{entry.client_name}</td>
                      <td className="py-3 px-5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                          entry.level === 'HIGH'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {entry.level}
                        </span>
                      </td>
                      <td className="py-3 px-5 text-sm text-[var(--text-secondary)] text-right tabular-nums">{entry.score}</td>
                      <td className="py-3 px-5 text-xs text-[var(--text-secondary)]">{entry.factors.join(' / ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── P&L Section ─────────────────────────────────────────────────── */}
      {pnlLoading ? (
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-[var(--border)] border-t-[var(--creekside-blue)]" />
        </div>
      ) : pnlData && pnlMonths.length > 0 ? (
        <>
          {/* P&L Summary Cards — Current vs Prior Month */}
          {currentMonth && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-sm font-medium text-[var(--text-secondary)]">Revenue ({currentMonth.month})</p>
                <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">{fmtDollar(currentMonth.totalRevenue)}</p>
                {priorMonth && (
                  <p className={`text-xs mt-1 ${currentMonth.totalRevenue >= priorMonth.totalRevenue ? 'text-emerald-600' : 'text-red-600'}`}>
                    {currentMonth.totalRevenue >= priorMonth.totalRevenue ? '+' : ''}
                    {fmtDollar(currentMonth.totalRevenue - priorMonth.totalRevenue)} vs {priorMonth.month}
                  </p>
                )}
              </div>

              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-sm font-medium text-[var(--text-secondary)]">Expenses ({currentMonth.month})</p>
                <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">{fmtDollar(currentMonth.totalExpenses)}</p>
                {priorMonth && (
                  <p className={`text-xs mt-1 ${currentMonth.totalExpenses <= priorMonth.totalExpenses ? 'text-emerald-600' : 'text-red-600'}`}>
                    {currentMonth.totalExpenses > priorMonth.totalExpenses ? '+' : ''}
                    {fmtDollar(currentMonth.totalExpenses - priorMonth.totalExpenses)} vs {priorMonth.month}
                  </p>
                )}
              </div>

              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-sm font-medium text-[var(--text-secondary)]">Net Profit ({currentMonth.month})</p>
                <p className={`text-3xl font-bold mt-1 ${currentMonth.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmtDollar(currentMonth.netProfit)}
                </p>
                {priorMonth && (
                  <p className={`text-xs mt-1 ${currentMonth.netProfit >= priorMonth.netProfit ? 'text-emerald-600' : 'text-red-600'}`}>
                    {currentMonth.netProfit >= priorMonth.netProfit ? '+' : ''}
                    {fmtDollar(currentMonth.netProfit - priorMonth.netProfit)} vs {priorMonth.month}
                  </p>
                )}
              </div>

              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-sm font-medium text-[var(--text-secondary)]">Profit Margin ({currentMonth.month})</p>
                <p className={`text-3xl font-bold mt-1 ${marginColor(currentMonth.profitMarginPct)}`}>
                  {fmtPct(currentMonth.profitMarginPct)}
                </p>
                {priorMonth && (
                  <p className={`text-xs mt-1 ${currentMonth.profitMarginPct >= priorMonth.profitMarginPct ? 'text-emerald-600' : 'text-red-600'}`}>
                    {currentMonth.profitMarginPct >= priorMonth.profitMarginPct ? '+' : ''}
                    {(currentMonth.profitMarginPct - priorMonth.profitMarginPct).toFixed(1)}pp vs {priorMonth.month}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* P&L Trend — Bar Chart + Table */}
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Monthly P&L Trend</h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">Revenue, expenses, and profit for the last 6 months</p>
            </div>

            {/* Visual bar chart */}
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-end gap-2 h-40">
                {pnlMonths.map((m) => {
                  const revHeight = (m.totalRevenue / maxRevenue) * 100;
                  const expHeight = (m.totalExpenses / maxRevenue) * 100;
                  return (
                    <div key={m.monthDate} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end justify-center gap-0.5" style={{ height: '120px' }}>
                        {/* Revenue bar */}
                        <div
                          className="w-[40%] bg-blue-400 rounded-t transition-all duration-500"
                          style={{ height: `${Math.max(revHeight, 2)}%` }}
                          title={`Revenue: ${fmtDollar(m.totalRevenue)}`}
                        />
                        {/* Expense bar */}
                        <div
                          className="w-[40%] bg-slate-300 rounded-t transition-all duration-500"
                          style={{ height: `${Math.max(expHeight, 2)}%` }}
                          title={`Expenses: ${fmtDollar(m.totalExpenses)}`}
                        />
                      </div>
                      <span className="text-[10px] text-[var(--text-secondary)] truncate w-full text-center">
                        {m.month.length > 3 ? m.month.slice(0, 3) : m.month}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-6 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 bg-blue-400 rounded-sm" />
                  <span className="text-xs text-[var(--text-secondary)]">Revenue</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 bg-slate-300 rounded-sm" />
                  <span className="text-xs text-[var(--text-secondary)]">Expenses</span>
                </div>
              </div>
            </div>

            {/* Data table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                    <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Month</th>
                    <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Revenue</th>
                    <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Expenses</th>
                    <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Profit</th>
                    <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Margin</th>
                    <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pnlMonths].reverse().map((m) => {
                    const isExpanded = expandedMonth === m.monthDate;
                    const expenses = pnlData.expensesByMonth[m.monthDate] ?? [];
                    const labor = pnlData.laborByMonth[m.monthDate] ?? [];
                    return (
                      <React.Fragment key={m.monthDate}>
                        <tr
                          className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer"
                          onClick={() => setExpandedMonth(isExpanded ? null : m.monthDate)}
                        >
                          <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">
                            <span className="mr-1.5 text-slate-400 text-xs">{isExpanded ? '[-]' : '[+]'}</span>
                            {m.month}
                          </td>
                          <td className="py-3 px-5 text-sm text-[var(--text-secondary)] text-right">{fmtDollar(m.totalRevenue)}</td>
                          <td className="py-3 px-5 text-sm text-[var(--text-secondary)] text-right">{fmtDollar(m.totalExpenses)}</td>
                          <td className={`py-3 px-5 text-sm font-medium text-right ${m.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {fmtDollar(m.netProfit)}
                          </td>
                          <td className="py-3 px-5 text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${marginBarBg(m.profitMarginPct)} text-white`}>
                              {fmtPct(m.profitMarginPct)}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-sm text-[var(--text-secondary)] text-right">{fmt(m.transactionCount)}</td>
                        </tr>
                        {/* Expanded detail row */}
                        {isExpanded && (
                          <tr key={`${m.monthDate}-detail`} className="bg-[var(--bg-tertiary)]/80">
                            <td colSpan={6} className="px-5 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Expense breakdown */}
                                <div>
                                  <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Expense Breakdown</p>
                                  <div className="space-y-1.5">
                                    {[
                                      { label: 'Labor', value: m.laborCost },
                                      { label: 'Software', value: m.softwareCost },
                                      { label: 'Processing Fees', value: m.processingFees },
                                      { label: 'Marketing', value: m.marketingCost },
                                      { label: 'Advertising', value: m.advertisingCost },
                                    ]
                                      .filter((e) => e.value > 0)
                                      .map((e) => {
                                        const pct = m.totalExpenses > 0 ? (e.value / m.totalExpenses) * 100 : 0;
                                        return (
                                          <div key={e.label} className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-secondary)] w-28 shrink-0">{e.label}</span>
                                            <div className="flex-1 h-4 bg-[var(--border)] rounded overflow-hidden">
                                              <div className="h-full bg-[var(--bg-tertiary)]0 rounded" style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-xs text-[var(--text-primary)] font-medium w-20 text-right">{fmtDollar(e.value)}</span>
                                          </div>
                                        );
                                      })}
                                  </div>
                                  {/* Category breakdown from expense_breakdown view */}
                                  {expenses.length > 0 && (
                                    <div className="mt-3 pt-2 border-t border-[var(--border)]">
                                      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">By Category</p>
                                      {expenses.map((e) => (
                                        <div key={e.category} className="flex justify-between text-xs text-[var(--text-secondary)] py-0.5">
                                          <span>{e.category}</span>
                                          <span className="font-medium">{fmtDollar(e.total)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {/* Labor by team member */}
                                {labor.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Top Labor Costs</p>
                                    <div className="space-y-1.5">
                                      {labor.map((l) => {
                                        const pct = m.laborCost > 0 ? (l.cost / m.laborCost) * 100 : 0;
                                        return (
                                          <div key={l.name} className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-secondary)] w-28 shrink-0 truncate" title={l.name}>{l.name}</span>
                                            <div className="flex-1 h-4 bg-[var(--border)] rounded overflow-hidden">
                                              <div className="h-full bg-blue-400 rounded" style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-xs text-[var(--text-primary)] font-medium w-20 text-right">{fmtDollar(l.cost)}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-8 text-center text-sm text-slate-400">
          P&L data unavailable
        </div>
      )}

      {/* Row 2 -- Operational Health */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Platform Split</p>
          <div className="flex items-baseline gap-4 mt-2">
            <div>
              <span className="text-2xl font-bold text-[var(--text-primary)]">{fmt(data.platformSplit.meta)}</span>
              <span className="text-sm text-[var(--text-secondary)] ml-1">Meta</span>
            </div>
            <div className="text-slate-300">|</div>
            <div>
              <span className="text-2xl font-bold text-[var(--text-primary)]">{fmt(data.platformSplit.google)}</span>
              <span className="text-sm text-[var(--text-secondary)] ml-1">Google</span>
            </div>
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Ownership Gaps</p>
          {data.ownershipGaps.noManager === 0 && data.ownershipGaps.noOperator === 0 ? (
            <p className="text-2xl font-bold text-emerald-600 mt-2">All assigned</p>
          ) : (
            <div className="mt-2 space-y-1">
              {data.ownershipGaps.noManager > 0 && (
                <p className="text-sm font-medium text-red-600">
                  {data.ownershipGaps.noManager} client{data.ownershipGaps.noManager !== 1 ? 's' : ''} missing manager
                </p>
              )}
              {data.ownershipGaps.noOperator > 0 && (
                <p className="text-sm font-medium text-red-600">
                  {data.ownershipGaps.noOperator} client{data.ownershipGaps.noOperator !== 1 ? 's' : ''} missing operator
                </p>
              )}
            </div>
          )}
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Budget Coverage</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] mt-2">
            {data.budgetCoverage.withBudget}
            <span className="text-lg font-normal text-slate-400"> / {data.budgetCoverage.total}</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {data.budgetCoverage.total - data.budgetCoverage.withBudget === 0
              ? 'All clients have budgets set'
              : `${data.budgetCoverage.total - data.budgetCoverage.withBudget} missing budget`}
          </p>
        </div>
      </div>

      {/* Row 3 -- Revenue Concentration */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Revenue Concentration</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">Top 5 clients by estimated fee</p>
          </div>
          {hasConcentrationRisk && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
              Concentration Risk
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Client</th>
                <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Total Budget</th>
                <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Est. Fee</th>
                <th className="text-right py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">% of MRR</th>
              </tr>
            </thead>
            <tbody>
              {data.topClients.map((client) => (
                <tr
                  key={client.name}
                  className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                >
                  <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{client.name}</td>
                  <td className="py-3 px-5 text-sm text-[var(--text-secondary)] text-right">{fmtDollar(client.budget)}</td>
                  <td className="py-3 px-5 text-sm text-[var(--text-secondary)] text-right">{fmtDollar(client.fee)}</td>
                  <td className="py-3 px-5 text-right">
                    <span
                      className={`text-sm font-medium ${
                        client.pctOfMRR > 20 ? 'text-red-600' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {fmtPct(client.pctOfMRR)}
                      {client.pctOfMRR > 20 && (
                        <span className="ml-1 text-xs text-red-500" title="Single client exceeds 20% of revenue">
                          !
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {data.topClients.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-slate-400">
                    No active clients with budgets
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 4 -- Budget Distribution */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Budget Distribution</h3>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5 mb-4">Clients grouped by total monthly ad spend</p>
        <div className="space-y-3">
          {tierLabels.map((tier) => {
            const count = data.budgetTiers[tier.key];
            const widthPct = maxTierCount > 0 ? (count / maxTierCount) * 100 : 0;
            return (
              <div key={tier.key} className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-secondary)] w-24 shrink-0 text-right">{tier.label}</span>
                <div className="flex-1 h-8 bg-[var(--bg-tertiary)] rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${tier.color} rounded-lg transition-all duration-500`}
                    style={{ width: `${Math.max(widthPct, count > 0 ? 4 : 0)}%` }}
                  />
                  {count > 0 && (
                    <span className="absolute inset-y-0 flex items-center text-xs font-semibold text-[var(--text-primary)] ml-2" style={{ left: `${Math.max(widthPct, 4)}%` }}>
                      {count}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

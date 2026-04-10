'use client';

import React, { useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

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

interface ChurnRiskEntry {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  factors: string[];
  client_name: string;
}

interface WeeklyPipeline {
  weekOf: string;
  callsScheduled: number;
  inDiscussion: number;
  won: number;
  lost: number;
  totalCreated: number;
}

interface CloseRatePerson {
  won: number;
  lost: number;
  total: number;
  rate: number;
  avgDaysToClose: number;
}

interface WeeklyData {
  currentWeek: WeeklyPipeline;
  weeks: WeeklyPipeline[];
  closeRateByPerson: { peterson: CloseRatePerson; cade: CloseRatePerson };
  avgDealSize: number;
  scorecardWeeks: { weekOf: string; newMRR: number; lostMRR: number; netMRR: number; projectedMRR: number }[];
}

interface ManagerRevenue {
  manager: string;
  clientCount: number;
  estimatedMRR: number;
  actualRevenue: { monthDate: string; total: number }[];
}

interface OperatorMarginRow {
  operator: string;
  clientCount: number;
  totalRevenue: number;
  operatorCost: number;
  margin: number;
  marginPct: number;
}

interface ChurnEntry {
  client: string;
  date: string;
  revenueLost: number;
  reason: string | null;
  manager: string;
  platform: string;
}

interface UpsellCandidate {
  client: string;
  category: string;
  currentRevenue: number;
  platform: string;
  budget: number;
}

interface MonthlyData {
  revenueByManager: ManagerRevenue[];
  operatorMargin: OperatorMarginRow[];
  churnLog: ChurnEntry[];
  upsellCandidates: UpsellCandidate[];
  laborMonth: string | null;
}

interface LTVClient {
  name: string;
  status: string;
  monthsRetained: number;
  lifetimeRevenue: number;
}

interface PlatformProfit {
  platform: string;
  clientCount: number;
  revenue: number;
  estOperatorCost: number;
  margin: number;
  marginPct: number;
}

interface QuarterlyData {
  ltv: {
    avgMonthsRetained: number;
    avgLTV: number;
    medianLTV: number;
    totalActiveLTV: number;
    clientsAnalyzed: number;
    topClients: LTVClient[];
  };
  platformProfitability: PlatformProfit[];
  acquisitionMetrics: {
    avgDaysToClose: number;
    totalDealsAnalyzed: number;
    byPerson: {
      peterson: { avgDays: number; dealCount: number };
      cade: { avgDays: number; dealCount: number };
    };
  };
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

function marginColor(margin: number): string {
  if (margin > 15) return 'text-emerald-600';
  if (margin >= 5) return 'text-amber-600';
  return 'text-red-600';
}

function marginBarBg(margin: number): string {
  if (margin > 15) return 'bg-emerald-500';
  if (margin >= 5) return 'bg-amber-400';
  return 'bg-red-400';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMonthShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// ── Section Wrapper ────────────────────────────────────────────────────

function Section({
  title,
  period,
  defaultOpen = true,
  children,
}: {
  title: string;
  period: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-widest uppercase text-[var(--accent)]">{period}</span>
          <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        </div>
        <span className="text-[var(--text-secondary)] text-sm">{open ? '[-]' : '[+]'}</span>
      </button>
      {open && <div className="p-5 space-y-6 bg-[var(--bg-primary)]">{children}</div>}
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
      <p className="text-sm font-medium text-[var(--text-secondary)]">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color ?? 'text-[var(--text-primary)]'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-[var(--border)] border-t-[var(--creekside-blue)]" />
    </div>
  );
}

// ── Page Component ─────────────────────────────────────────────────────

export default function ScorecardPage() {
  const [data, setData] = useState<ScorecardData | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklyData | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData | null>(null);
  const [pnlData, setPnlData] = useState<PnlData | null>(null);
  const [churnRisk, setChurnRisk] = useState<Record<string, ChurnRiskEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    async function loadMain() {
      try {
        const res = await fetch('/api/scorecard');
        if (!res.ok) throw new Error('Failed to load scorecard');
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function loadSection(url: string, setter: (d: any) => void) {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (!json.error) setter(json);
      } catch (e) { console.warn('Section load failed:', url, e); }
    }
    loadMain();
    loadSection('/api/scorecard/weekly', setWeeklyData);
    loadSection('/api/scorecard/monthly', setMonthlyData);
    loadSection('/api/scorecard/quarterly', setQuarterlyData);
    loadSection('/api/scorecard/pnl', setPnlData);
    loadSection('/api/clients/churn-risk', setChurnRisk);
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

  const pnlMonths = pnlData?.pnl ?? [];
  const currentPnl = pnlMonths.length > 0 ? pnlMonths[pnlMonths.length - 1] : null;
  const priorPnl = pnlMonths.length > 1 ? pnlMonths[pnlMonths.length - 2] : null;
  const maxRevenue = Math.max(...pnlMonths.map((m) => m.totalRevenue), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">KPI Scorecard</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Agency performance at a glance</p>
      </div>

      {/* ── Global KPI Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Clients" value={fmt(data.activeClients)} sub={`${fmt(data.totalAccounts)} total accounts`} />
        <StatCard label="Estimated MRR" value={fmtDollar(data.estimatedMRR)} sub="Based on fee tiers" color="text-emerald-600" />
        <StatCard label="Ad Spend Under Mgmt" value={fmtDollar(data.totalMonthlyBudget)} sub="Monthly budgets combined" />
        <StatCard
          label="Churned Clients"
          value={fmt(data.churnedCount)}
          sub={data.churnedCount === 0 ? 'No churn' : 'Review in Archive'}
          color={data.churnedCount > 0 ? 'text-red-600' : undefined}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          WEEKLY
          ══════════════════════════════════════════════════════════════════ */}
      <Section title="Pipeline & Sales Activity" period="Weekly">
        {weeklyData ? (
          <>
            {/* Pipeline This Week */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Pipeline This Week</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Calls Scheduled" value={fmt(weeklyData.currentWeek.callsScheduled)} />
                <StatCard label="In Discussion" value={fmt(weeklyData.currentWeek.inDiscussion)} />
                <StatCard label="Won" value={fmt(weeklyData.currentWeek.won)} color={weeklyData.currentWeek.won > 0 ? 'text-emerald-600' : undefined} />
                <StatCard label="Lost" value={fmt(weeklyData.currentWeek.lost)} color={weeklyData.currentWeek.lost > 0 ? 'text-red-600' : undefined} />
              </div>
            </div>

            {/* MRR Movement */}
            {weeklyData.scorecardWeeks.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">MRR Movement</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="New MRR" value={fmtDollar(weeklyData.scorecardWeeks[0]?.newMRR ?? 0)} color="text-emerald-600" />
                  <StatCard label="Lost MRR" value={fmtDollar(weeklyData.scorecardWeeks[0]?.lostMRR ?? 0)} color="text-red-600" />
                  <StatCard
                    label="Net New MRR"
                    value={fmtDollar(weeklyData.scorecardWeeks[0]?.netMRR ?? 0)}
                    color={(weeklyData.scorecardWeeks[0]?.netMRR ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}
                  />
                  <StatCard label="Avg Deal Size" value={fmtDollar(weeklyData.avgDealSize)} sub="[EST] active clients" />
                </div>
              </div>
            )}

            {/* Close Rate: Peterson vs Cade */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Close Rate: Peterson vs Cade</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(['peterson', 'cade'] as const).map((person) => {
                  const stats = weeklyData.closeRateByPerson[person];
                  const name = person === 'peterson' ? 'Peterson' : 'Cade';
                  return (
                    <div key={person} className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{name}</p>
                      <div className="flex items-baseline gap-3 mt-2">
                        <p className="text-3xl font-bold text-[var(--text-primary)]">{fmtPct(stats.rate)}</p>
                        <p className="text-sm text-[var(--text-secondary)]">close rate</p>
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-[var(--text-secondary)]">
                        <span className="text-emerald-600 font-medium">{stats.won} won</span>
                        <span className="text-red-500 font-medium">{stats.lost} lost</span>
                        <span>{stats.total} total</span>
                      </div>
                      {stats.avgDaysToClose > 0 && (
                        <p className="text-xs text-slate-400 mt-1">Avg {stats.avgDaysToClose} days to close</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 italic">Source: ClickUp Sales Pipeline (all-time won vs lost deals)</p>
            </div>

            {/* 8-Week Trend */}
            {weeklyData.weeks.length > 0 && (
              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)]">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">8-Week Pipeline Trend</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                        <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Week</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">New Leads</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Calls</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Won</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Lost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyData.weeks.map((w) => (
                        <tr key={w.weekOf} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                          <td className="py-3 px-5 text-sm text-[var(--text-primary)]">{formatDate(w.weekOf)}</td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{w.totalCreated}</td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{w.callsScheduled}</td>
                          <td className="py-3 px-4 text-sm text-right tabular-nums">
                            <span className={w.won > 0 ? 'text-emerald-600 font-medium' : 'text-[var(--text-secondary)]'}>{w.won}</span>
                          </td>
                          <td className="py-3 px-4 text-sm text-right tabular-nums">
                            <span className={w.lost > 0 ? 'text-red-500' : 'text-[var(--text-secondary)]'}>{w.lost}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <Spinner />
        )}
      </Section>

      {/* ══════════════════════════════════════════════════════════════════
          MONTHLY
          ══════════════════════════════════════════════════════════════════ */}
      <Section title="Revenue, Margins & Churn" period="Monthly">
        {monthlyData ? (
          <>
            {/* Revenue by Manager */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Revenue by Manager</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {monthlyData.revenueByManager.map((mgr) => (
                  <div key={mgr.manager} className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{mgr.manager}</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{fmtDollar(mgr.estimatedMRR)}</p>
                    <p className="text-xs text-slate-400 mt-1">{mgr.clientCount} clients (est. MRR)</p>
                    {mgr.actualRevenue.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[var(--border)]">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Actual Revenue</p>
                        {mgr.actualRevenue.slice(0, 3).map((ar) => (
                          <div key={ar.monthDate} className="flex justify-between text-xs text-[var(--text-secondary)]">
                            <span>{fmtMonthShort(ar.monthDate)}</span>
                            <span className="font-medium">{fmtDollar(ar.total)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Operator Margin */}
            <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--border)]">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Operator Margin</h4>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Est. operator cost from labor data{monthlyData.laborMonth ? ` (${fmtMonthShort(monthlyData.laborMonth)})` : ''}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                      <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Operator</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Clients</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Revenue</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Labor Cost</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Margin</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyData.operatorMargin.map((op) => (
                      <tr key={op.operator} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                        <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{op.operator}</td>
                        <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{op.clientCount}</td>
                        <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{fmtDollar(op.totalRevenue)}</td>
                        <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">
                          {op.operatorCost > 0 ? fmtDollar(op.operatorCost) : <span className="text-slate-400 italic">N/A</span>}
                        </td>
                        <td className={`py-3 px-4 text-sm font-medium text-right tabular-nums ${op.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {op.operatorCost > 0 ? fmtDollar(op.margin) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {op.operatorCost > 0 ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${marginBarBg(op.marginPct)} text-white`}>
                              {fmtPct(op.marginPct)}
                            </span>
                          ) : <span className="text-xs text-slate-400">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Churn Log */}
            {monthlyData.churnLog.length > 0 && (
              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)]">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Churn Log (Last 90 Days)</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {monthlyData.churnLog.length} client{monthlyData.churnLog.length !== 1 ? 's' : ''} churned,{' '}
                    {fmtDollar(monthlyData.churnLog.reduce((s, c) => s + c.revenueLost, 0))} revenue lost
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                        <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Client</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Date</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Rev Lost</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Manager</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.churnLog.map((c) => (
                        <tr key={c.client + c.date} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                          <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{c.client}</td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)]">{c.date ? formatDate(c.date) : '-'}</td>
                          <td className="py-3 px-4 text-sm text-red-600 font-medium text-right tabular-nums">{fmtDollar(c.revenueLost)}</td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)]">{c.manager}</td>
                          <td className="py-3 px-4 text-xs text-[var(--text-secondary)] max-w-xs truncate" title={c.reason ?? ''}>
                            {c.reason ?? <span className="italic text-slate-400">No reason recorded</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Upsell Candidates */}
            {monthlyData.upsellCandidates.length > 0 && (
              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)]">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Upsell Candidates</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Retainer clients that could upgrade to percentage-of-spend</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                        <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Client</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Platform</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Current Rev</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Budget</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.upsellCandidates.map((u) => (
                        <tr key={u.client} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                          <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{u.client}</td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)]">{u.platform}</td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{fmtDollar(u.currentRevenue)}</td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{u.budget > 0 ? fmtDollar(u.budget) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Churn Risk */}
            {churnRisk && (() => {
              const entries = Object.values(churnRisk);
              const highRisk = entries.filter((e) => e.level === 'HIGH').sort((a, b) => b.score - a.score);
              const mediumRisk = entries.filter((e) => e.level === 'MEDIUM').sort((a, b) => b.score - a.score);
              if (highRisk.length + mediumRisk.length === 0) return null;
              return (
                <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
                  <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">Churn Risk</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {highRisk.length > 0 ? `${highRisk.length} high risk` : `${mediumRisk.length} medium risk`}
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
                          <th className="text-center py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Risk</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Score</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Factors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...highRisk, ...mediumRisk].map((e) => (
                          <tr key={e.client_name} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                            <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{e.client_name}</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${e.level === 'HIGH' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{e.level}</span>
                            </td>
                            <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{e.score}</td>
                            <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">{e.factors.join(' / ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* P&L Trend */}
            {pnlData && pnlMonths.length > 0 && (
              <>
                {currentPnl && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">P&L Summary</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                        <p className="text-sm font-medium text-[var(--text-secondary)]">Revenue ({currentPnl.month})</p>
                        <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{fmtDollar(currentPnl.totalRevenue)}</p>
                        {priorPnl && (
                          <p className={`text-xs mt-1 ${currentPnl.totalRevenue >= priorPnl.totalRevenue ? 'text-emerald-600' : 'text-red-600'}`}>
                            {currentPnl.totalRevenue >= priorPnl.totalRevenue ? '+' : ''}{fmtDollar(currentPnl.totalRevenue - priorPnl.totalRevenue)} vs {priorPnl.month}
                          </p>
                        )}
                      </div>
                      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                        <p className="text-sm font-medium text-[var(--text-secondary)]">Expenses ({currentPnl.month})</p>
                        <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{fmtDollar(currentPnl.totalExpenses)}</p>
                        {priorPnl && (
                          <p className={`text-xs mt-1 ${currentPnl.totalExpenses <= priorPnl.totalExpenses ? 'text-emerald-600' : 'text-red-600'}`}>
                            {currentPnl.totalExpenses > priorPnl.totalExpenses ? '+' : ''}{fmtDollar(currentPnl.totalExpenses - priorPnl.totalExpenses)} vs {priorPnl.month}
                          </p>
                        )}
                      </div>
                      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                        <p className="text-sm font-medium text-[var(--text-secondary)]">Net Profit ({currentPnl.month})</p>
                        <p className={`text-2xl font-bold mt-1 ${currentPnl.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtDollar(currentPnl.netProfit)}</p>
                      </div>
                      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                        <p className="text-sm font-medium text-[var(--text-secondary)]">Margin ({currentPnl.month})</p>
                        <p className={`text-2xl font-bold mt-1 ${marginColor(currentPnl.profitMarginPct)}`}>{fmtPct(currentPnl.profitMarginPct)}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
                  <div className="px-5 py-3 border-b border-[var(--border)]">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">Monthly P&L Trend</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">Click a row to expand expense breakdown</p>
                  </div>
                  <div className="px-5 py-4 border-b border-[var(--border)]">
                    <div className="flex items-end gap-2 h-32">
                      {pnlMonths.map((m) => (
                        <div key={m.monthDate} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end justify-center gap-0.5" style={{ height: '100px' }}>
                            <div className="w-[40%] bg-blue-400 rounded-t transition-all duration-500" style={{ height: `${Math.max((m.totalRevenue / maxRevenue) * 100, 2)}%` }} title={`Revenue: ${fmtDollar(m.totalRevenue)}`} />
                            <div className="w-[40%] bg-slate-300 rounded-t transition-all duration-500" style={{ height: `${Math.max((m.totalExpenses / maxRevenue) * 100, 2)}%` }} title={`Expenses: ${fmtDollar(m.totalExpenses)}`} />
                          </div>
                          <span className="text-[10px] text-[var(--text-secondary)] truncate w-full text-center">{m.month.slice(0, 3)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-center gap-6 mt-2">
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-blue-400 rounded-sm" /><span className="text-xs text-[var(--text-secondary)]">Revenue</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-slate-300 rounded-sm" /><span className="text-xs text-[var(--text-secondary)]">Expenses</span></div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                          <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Month</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Revenue</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Expenses</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Profit</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...pnlMonths].reverse().map((m) => {
                          const isExpanded = expandedMonth === m.monthDate;
                          const expenses = pnlData.expensesByMonth[m.monthDate] ?? [];
                          const labor = pnlData.laborByMonth[m.monthDate] ?? [];
                          return (
                            <React.Fragment key={m.monthDate}>
                              <tr className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer" onClick={() => setExpandedMonth(isExpanded ? null : m.monthDate)}>
                                <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">
                                  <span className="mr-1.5 text-slate-400 text-xs">{isExpanded ? '[-]' : '[+]'}</span>{m.month}
                                </td>
                                <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{fmtDollar(m.totalRevenue)}</td>
                                <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{fmtDollar(m.totalExpenses)}</td>
                                <td className={`py-3 px-4 text-sm font-medium text-right tabular-nums ${m.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtDollar(m.netProfit)}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${marginBarBg(m.profitMarginPct)} text-white`}>{fmtPct(m.profitMarginPct)}</span>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-[var(--bg-tertiary)]/80">
                                  <td colSpan={5} className="px-5 py-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                      <div>
                                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Expense Breakdown</p>
                                        <div className="space-y-1.5">
                                          {[
                                            { label: 'Labor', value: m.laborCost },
                                            { label: 'Software', value: m.softwareCost },
                                            { label: 'Processing Fees', value: m.processingFees },
                                            { label: 'Marketing', value: m.marketingCost },
                                            { label: 'Advertising', value: m.advertisingCost },
                                          ].filter((e) => e.value > 0).map((e) => {
                                            const pct = m.totalExpenses > 0 ? (e.value / m.totalExpenses) * 100 : 0;
                                            return (
                                              <div key={e.label} className="flex items-center gap-2">
                                                <span className="text-xs text-[var(--text-secondary)] w-28 shrink-0">{e.label}</span>
                                                <div className="flex-1 h-4 bg-[var(--border)] rounded overflow-hidden">
                                                  <div className="h-full bg-blue-400/30 rounded" style={{ width: `${pct}%` }} />
                                                </div>
                                                <span className="text-xs text-[var(--text-primary)] font-medium w-20 text-right">{fmtDollar(e.value)}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                        {expenses.length > 0 && (
                                          <div className="mt-3 pt-2 border-t border-[var(--border)]">
                                            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">By Category</p>
                                            {expenses.map((e) => (
                                              <div key={e.category} className="flex justify-between text-xs text-[var(--text-secondary)] py-0.5">
                                                <span>{e.category}</span><span className="font-medium">{fmtDollar(e.total)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
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
            )}
          </>
        ) : (
          <Spinner />
        )}
      </Section>

      {/* ══════════════════════════════════════════════════════════════════
          QUARTERLY
          ══════════════════════════════════════════════════════════════════ */}
      <Section title="LTV, Profitability & Acquisition" period="Quarterly">
        {quarterlyData ? (
          <>
            {/* Client Lifetime Value */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Client Lifetime Value</h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <StatCard label="Avg Months Retained" value={fmt(quarterlyData.ltv.avgMonthsRetained)} sub={`${quarterlyData.ltv.clientsAnalyzed} clients analyzed`} />
                <StatCard label="Avg LTV / Client" value={fmtDollar(quarterlyData.ltv.avgLTV)} color="text-emerald-600" />
                <StatCard label="Median LTV" value={fmtDollar(quarterlyData.ltv.medianLTV)} />
                <StatCard label="Total Active LTV" value={fmtDollar(quarterlyData.ltv.totalActiveLTV)} sub="Revenue from active clients" />
              </div>
            </div>

            {/* Top Clients by LTV */}
            {quarterlyData.ltv.topClients.length > 0 && (
              <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)]">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Top 10 Clients by Lifetime Revenue</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                        <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Client</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Status</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Months</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Lifetime Rev</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quarterlyData.ltv.topClients.map((c) => (
                        <tr key={c.name} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                          <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{c.name}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{c.status}</span>
                          </td>
                          <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{c.monthsRetained}</td>
                          <td className="py-3 px-4 text-sm text-emerald-600 font-medium text-right tabular-nums">{fmtDollar(c.lifetimeRevenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Platform Profitability */}
            <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--border)]">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Profitability by Platform</h4>
                <p className="text-[10px] text-slate-400 mt-0.5">Revenue vs estimated operator cost allocation</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                      <th className="text-left py-3 px-5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Platform</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Clients</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Revenue</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Est. Cost</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Margin</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarterlyData.platformProfitability.map((p) => (
                      <tr key={p.platform} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                        <td className="py-3 px-5 text-sm font-medium text-[var(--text-primary)]">{p.platform}</td>
                        <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{p.clientCount}</td>
                        <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{fmtDollar(p.revenue)}</td>
                        <td className="py-3 px-4 text-sm text-[var(--text-secondary)] text-right tabular-nums">{fmtDollar(p.estOperatorCost)}</td>
                        <td className={`py-3 px-4 text-sm font-medium text-right tabular-nums ${p.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtDollar(p.margin)}</td>
                        <td className="py-3 px-4 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${marginBarBg(p.marginPct)} text-white`}>{fmtPct(p.marginPct)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Time to Close */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Time to Close</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard label="Avg Days to Close" value={`${quarterlyData.acquisitionMetrics.avgDaysToClose}d`} sub={`${quarterlyData.acquisitionMetrics.totalDealsAnalyzed} deals analyzed`} />
                <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                  <p className="text-sm font-medium text-[var(--text-secondary)]">Peterson</p>
                  <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{quarterlyData.acquisitionMetrics.byPerson.peterson.avgDays}d</p>
                  <p className="text-xs text-slate-400 mt-1">{quarterlyData.acquisitionMetrics.byPerson.peterson.dealCount} deals</p>
                </div>
                <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-5">
                  <p className="text-sm font-medium text-[var(--text-secondary)]">Cade</p>
                  <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{quarterlyData.acquisitionMetrics.byPerson.cade.avgDays}d</p>
                  <p className="text-xs text-slate-400 mt-1">{quarterlyData.acquisitionMetrics.byPerson.cade.dealCount} deals</p>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 italic">Time from lead creation to won status in ClickUp. No marketing cost data available.</p>
            </div>
          </>
        ) : (
          <Spinner />
        )}
      </Section>
    </div>
  );
}

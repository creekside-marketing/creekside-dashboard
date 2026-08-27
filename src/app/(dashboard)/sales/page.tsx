'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import KpiCard from '@/components/KpiCard';
import {
  BarChart as ReBarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import type { RawSalesLead, RawStatusTransition, Partner, Salesperson, FunnelStageRow } from '@/lib/types/sales-funnel';
import {
  normalizeLeads, filterByDateRange, computeFunnel, computeOutcomeSummary,
  computeBySalesperson, computeReferrals, computeLostBreakdown, computeLeaks,
  filterTransitionsByDateRange, OUTCOME_LABELS, STAGE_LABELS,
} from '@/lib/engine/sales-funnel';

/* ── Helpers ── */

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function money(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// 7 journey stages + Won
const FUNNEL_COLORS = ['#14B8A6', '#3B82F6', '#6366F1', '#F59E0B', '#8B5CF6', '#EC4899', '#0EA5E9', '#10B981'];

const PARTNER_COLORS: Record<Partner, string> = {
  Brad: '#3B82F6',
  Scott: '#F59E0B',
  Keith: '#14B8A6',
  Other: '#94A3B8',
};

// Per-person journey funnels: salespeople + referral partners (Keith excluded per Peterson 2026-08-26)
const JOURNEY_SALESPEOPLE: Salesperson[] = ['Peterson', 'Cade', 'Lindsey'];
const JOURNEY_PARTNERS: Partner[] = ['Brad', 'Scott', 'Other'];

/** Small-multiple version of the company journey funnel, one per person/partner. */
function MiniFunnel({ title, leadCount, data }: { title: string; leadCount: number; data: FunnelStageRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <p className="text-xs text-slate-500 mb-3">{leadCount.toLocaleString()} leads</p>
      <ResponsiveContainer width="100%" height={240}>
        <ReBarChart data={data} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={118} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }}
            formatter={(value, _name, entry) => {
              const v = typeof value === 'number' ? value : Number(value);
              const p = entry?.payload as { pctOfTotal?: number; stepConversion?: number } | undefined;
              return [
                `${v.toLocaleString()} (${(p?.pctOfTotal ?? 0).toFixed(1)}% of leads, ${(p?.stepConversion ?? 0).toFixed(1)}% from prior stage)`,
                'Count',
              ];
            }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16}>
            {data.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />)}
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}

const DATE_PRESETS = [
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
  { label: 'Last 6mo', days: 180 },
  { label: 'YTD', days: -1 },
  { label: 'All', days: 0 },
] as const;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  PAGE                                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

export default function SalesFunnelPage() {
  const [rawLeads, setRawLeads] = useState<RawSalesLead[]>([]);
  const [rawTransitions, setRawTransitions] = useState<RawStatusTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });

  useEffect(() => {
    fetch('/api/sales-funnel')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setRawLeads(data.leads ?? []);
        setRawTransitions(data.transitions ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const setDatePreset = useCallback((preset: typeof DATE_PRESETS[number]) => {
    if (preset.days === 0) {
      setDateRange({ start: null, end: null });
    } else if (preset.days === -1) {
      setDateRange({ start: `${new Date().getFullYear()}-01-01`, end: null });
    } else {
      const start = new Date();
      start.setDate(start.getDate() - preset.days);
      setDateRange({ start: toISODate(start), end: null });
    }
  }, []);

  /* ── Normalize + aggregate ── */
  const allLeads = useMemo(() => normalizeLeads(rawLeads, rawTransitions), [rawLeads, rawTransitions]);
  const leads = useMemo(() => filterByDateRange(allLeads, dateRange), [allLeads, dateRange]);

  const funnel = useMemo(() => computeFunnel(leads), [leads]);
  const funnelDisplay = useMemo(
    () => funnel.map((row) => ({ ...row, name: STAGE_LABELS[row.name] ?? row.name })),
    [funnel],
  );
  const journeyBySalesperson = useMemo(
    () => JOURNEY_SALESPEOPLE.map((person) => {
      const segLeads = leads.filter((l) => l.salesperson === person);
      return {
        name: person,
        leadCount: segLeads.length,
        funnel: computeFunnel(segLeads).map((row) => ({ ...row, name: STAGE_LABELS[row.name] ?? row.name })),
      };
    }),
    [leads],
  );
  const journeyByPartner = useMemo(
    () => JOURNEY_PARTNERS.map((partner) => {
      const segLeads = leads.filter((l) => l.partner === partner);
      return {
        name: partner === 'Other' ? 'Other (legacy)' : partner,
        leadCount: segLeads.length,
        funnel: computeFunnel(segLeads).map((row) => ({ ...row, name: STAGE_LABELS[row.name] ?? row.name })),
      };
    }).filter((seg) => seg.leadCount > 0),
    [leads],
  );
  const outcomes = useMemo(() => computeOutcomeSummary(leads), [leads]);
  const salespersonRows = useMemo(() => computeBySalesperson(leads), [leads]);
  const referrals = useMemo(() => computeReferrals(leads), [leads]);
  const lost = useMemo(() => computeLostBreakdown(leads), [leads]);
  const leaks = useMemo(
    () => computeLeaks(filterTransitionsByDateRange(rawTransitions, dateRange)),
    [rawTransitions, dateRange],
  );

  const totalLeads = leads.length;
  const callsBooked = funnel.find((f) => f.name === 'Call Booked')?.count ?? 0;
  const contractsProposed = funnel.find((f) => f.name === 'Contract Proposed')?.count ?? 0;
  const mrrWon = salespersonRows.find((r) => r.segment === 'Total')?.mrrWon ?? 0;
  const closedLeads = outcomes.won + outcomes.nurture + outcomes.lost + outcomes.referred;

  // Bold best/worst win-rate rows among real segments with volume
  const rankedSegments = salespersonRows.filter((r) => r.segment !== 'Total' && r.leads >= 5);
  const bestWinRate = rankedSegments.length > 1 ? Math.max(...rankedSegments.map((r) => r.winRate)) : null;
  const worstWinRate = rankedSegments.length > 1 ? Math.min(...rankedSegments.map((r) => r.winRate)) : null;

  const monthlyReferrals = useMemo(
    () => referrals.monthly.map((m) => ({ ...m, label: formatMonth(m.month) })),
    [referrals],
  );

  /* ── Loading / Error ── */
  if (loading) return <div className="p-12 text-center text-slate-400">Loading sales funnel data...</div>;
  if (error) return <div className="p-12 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Sales Funnel</h2>
        <p className="text-sm text-slate-500 mt-1">
          {totalLeads.toLocaleString()} of {allLeads.length.toLocaleString()} leads · ClickUp Upwork Sales &amp; Leads board
        </p>
      </div>

      {/* Date filter */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Date Range (lead created)</p>
        <div className="flex flex-wrap items-center gap-2">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setDatePreset(preset)}
              className="px-2.5 py-1 text-xs rounded-md border border-slate-200 bg-white text-slate-600 hover:border-slate-300 transition-colors"
            >
              {preset.label}
            </button>
          ))}
          <input
            type="date"
            value={dateRange.start ?? ''}
            onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value || null }))}
            className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700"
          />
          <span className="text-slate-400 text-xs">to</span>
          <input
            type="date"
            value={dateRange.end ?? ''}
            onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value || null }))}
            className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700"
          />
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Total Leads" value={totalLeads.toLocaleString()} />
        <KpiCard label="Calls Booked" value={callsBooked.toLocaleString()} change={totalLeads > 0 ? `${pct((callsBooked / totalLeads) * 100)} call rate` : undefined} />
        <KpiCard label="Contracts Proposed" value={contractsProposed.toLocaleString()} />
        <KpiCard label="Won" value={outcomes.won.toLocaleString()} change={totalLeads > 0 ? `${pct((outcomes.won / totalLeads) * 100)} win rate` : undefined} />
        <KpiCard label="MRR Won" value={money(mrrWon)} />
      </div>

      {/* Company Funnel */}
      {totalLeads > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Customer Journey Funnel</h3>
          <p className="text-xs text-slate-500 mb-4">Each bar counts leads that reached that stage or further.</p>
          <ResponsiveContainer width="100%" height={320}>
            <ReBarChart data={funnelDisplay} layout="vertical" margin={{ left: 10, right: 60, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }}
                formatter={(value, _name, entry) => {
                  const v = typeof value === 'number' ? value : Number(value);
                  const p = entry?.payload as { pctOfTotal?: number; stepConversion?: number } | undefined;
                  return [
                    `${v.toLocaleString()} (${(p?.pctOfTotal ?? 0).toFixed(1)}% of leads, ${(p?.stepConversion ?? 0).toFixed(1)}% from prior stage)`,
                    'Count',
                  ];
                }}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={26}>
                {funnelDisplay.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />)}
              </Bar>
            </ReBarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Customer Journey by Salesperson */}
      {totalLeads > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Customer Journey by Salesperson</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {journeyBySalesperson.map((seg) => (
              <MiniFunnel key={seg.name} title={seg.name} leadCount={seg.leadCount} data={seg.funnel} />
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            Salesperson attribution mostly comes from call-booking signals, so pre-call stages track closely with
            Call Booked for each person. Unassigned leads (no attribution signal) are excluded here.
          </p>
        </div>
      )}

      {/* Customer Journey by Referral Partner */}
      {journeyByPartner.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Customer Journey by Referral Partner</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {journeyByPartner.map((seg) => (
              <MiniFunnel key={seg.name} title={`→ ${seg.name}`} leadCount={seg.leadCount} data={seg.funnel} />
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            How far each partner&apos;s referred leads got in OUR funnel before (or after) the referral — a referred
            lead can still close as won. Keith is intentionally excluded. &quot;Other&quot; = legacy partners no longer active.
          </p>
        </div>
      )}

      {/* Outcome reconciliation strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {(Object.keys(outcomes) as (keyof typeof outcomes)[]).map((key) => (
          <KpiCard
            key={key}
            label={OUTCOME_LABELS[key]}
            value={outcomes[key].toLocaleString()}
            change={totalLeads > 0 ? `${pct((outcomes[key] / totalLeads) * 100)} of leads` : undefined}
          />
        ))}
      </div>

      {/* Leaks & Saves (from status-transition history) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Leaks &amp; Saves</h3>
        <p className="text-xs text-slate-500 mb-4">
          Computed from status movements, not current status. Date filter applies to when the move happened.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard
            label="No-Shows"
            value={leaks.noShows.toLocaleString()}
            change={leaks.callBookedEntries > 0 ? `${pct(leaks.noShowRate)} of ${leaks.callBookedEntries} bookings` : undefined}
          />
          <KpiCard label="Calls Booked (tracked)" value={leaks.callBookedEntries.toLocaleString()} />
          <KpiCard
            label="Saved from Nurture"
            value={leaks.nurtureSaves.toLocaleString()}
            change={leaks.nurtureEntries > 0 ? `${pct(leaks.saveRate)} of ${leaks.nurtureEntries} entered` : undefined}
          />
          <KpiCard label="Entered Nurture (tracked)" value={leaks.nurtureEntries.toLocaleString()} />
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          {leaks.trackingSince
            ? `Status movement tracking since ${leaks.trackingSince.slice(0, 10)}. Moves before that date are not counted; numbers grow as history accumulates.`
            : 'No status movements recorded yet — tracking starts with the next ClickUp sync.'}
        </p>
      </div>

      {/* By Salesperson */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">By Salesperson</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
              <th className="text-left py-2.5 px-4 font-semibold">Segment</th>
              <th className="text-right py-2.5 px-3 font-semibold">Leads</th>
              <th className="text-right py-2.5 px-3 font-semibold">Calls</th>
              <th className="text-right py-2.5 px-3 font-semibold">Call %</th>
              <th className="text-right py-2.5 px-3 font-semibold">Won</th>
              <th className="text-right py-2.5 px-3 font-semibold">Win %</th>
              <th className="text-right py-2.5 px-3 font-semibold">Referred</th>
              <th className="text-right py-2.5 px-4 font-semibold">MRR Won</th>
            </tr>
          </thead>
          <tbody>
            {salespersonRows.map((row) => {
              const isTotal = row.segment === 'Total';
              const isBest = !isTotal && bestWinRate !== null && row.leads >= 5 && row.winRate === bestWinRate;
              const isWorst = !isTotal && worstWinRate !== null && row.leads >= 5 && row.winRate === worstWinRate && !isBest;
              const rowWeight = isTotal || isBest || isWorst ? 'font-bold' : 'font-medium';
              return (
                <tr key={row.segment} className={`border-t hover:bg-slate-50/50 ${isTotal ? 'border-t-2 border-slate-200 bg-slate-50/50' : 'border-slate-100'}`}>
                  <td className={`text-slate-900 py-2 px-4 ${rowWeight}`}>
                    {row.segment}
                    {isBest && <span className="ml-1.5 text-[10px] text-emerald-600 font-semibold">BEST</span>}
                    {isWorst && <span className="ml-1.5 text-[10px] text-red-500 font-semibold">WORST</span>}
                  </td>
                  <td className={`text-slate-600 text-right py-2 px-3 ${rowWeight}`}>{row.leads.toLocaleString()}</td>
                  <td className={`text-slate-600 text-right py-2 px-3 ${rowWeight}`}>{row.callsBooked.toLocaleString()}</td>
                  <td className={`text-slate-900 text-right py-2 px-3 ${rowWeight}`}>{pct(row.callRate)}</td>
                  <td className={`text-slate-900 text-right py-2 px-3 ${rowWeight}`}>{row.won.toLocaleString()}</td>
                  <td className={`text-slate-900 text-right py-2 px-3 ${rowWeight}`}>{pct(row.winRate)}</td>
                  <td className={`text-slate-600 text-right py-2 px-3 ${rowWeight}`}>{row.referred.toLocaleString()}</td>
                  <td className={`text-slate-900 text-right py-2 px-4 ${rowWeight}`}>{money(row.mrrWon)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2.5 text-[11px] text-slate-400 border-t border-slate-100">
          MRR Won: ClickUp MRR field when present, otherwise inferred from Square billing (median billed month).
          Attribution: salesman field, then convo/assignee inference, then ClickUp status.
          Lindsey rarely appears in the salesman field, so her numbers may be undercounted.
          Unassigned = no attribution signal at all, mostly pre-call leads.
        </p>
      </div>

      {/* Referral Partners */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            label="Referred Out"
            value={referrals.total.toLocaleString()}
            change={totalLeads > 0 ? `${pct((referrals.total / totalLeads) * 100)} of leads` : undefined}
          />
          {referrals.byPartner.map((row) => (
            <KpiCard key={row.partner} label={`→ ${row.partner}`} value={row.count.toLocaleString()} />
          ))}
        </div>

        {monthlyReferrals.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Referrals Out by Month</h3>
            <ResponsiveContainer width="100%" height={260}>
              <ReBarChart data={monthlyReferrals} margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {(Object.keys(PARTNER_COLORS) as Partner[]).map((partner) => (
                  <Bar key={partner} dataKey={partner} stackId="referrals" fill={PARTNER_COLORS[partner]} radius={[0, 0, 0, 0]} />
                ))}
              </ReBarChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[11px] text-slate-400">
              Bucketed by lead-created month (referral date is not tracked). &quot;Other&quot; = legacy partners no longer active.
              {referrals.referredAndWon > 0 && ` ${referrals.referredAndWon} referred lead${referrals.referredAndWon === 1 ? '' : 's'} later closed as won.`}
            </p>
          </div>
        )}
      </div>

      {/* Lost Deals */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiCard
            label="Nurture + Lost"
            value={lost.total.toLocaleString()}
            change={closedLeads > 0 ? `${pct((lost.total / closedLeads) * 100)} of closed leads` : undefined}
          />
          <KpiCard
            label="In Nurture"
            value={lost.nurtureTotal.toLocaleString()}
            change={lost.total > 0 ? `${pct((lost.nurtureTotal / lost.total) * 100)} of nurture + lost` : undefined}
          />
          <KpiCard
            label="Hard Lost"
            value={lost.lostTotal.toLocaleString()}
            change={lost.total > 0 ? `${pct((lost.lostTotal / lost.total) * 100)} of nurture + lost` : undefined}
          />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Loss Reasons</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                <th className="text-left py-2.5 px-4 font-semibold">Reason</th>
                <th className="text-right py-2.5 px-3 font-semibold">Leads</th>
                <th className="text-right py-2.5 px-3 font-semibold">In Nurture</th>
                <th className="text-right py-2.5 px-3 font-semibold">Hard Lost</th>
                <th className="text-right py-2.5 px-4 font-semibold">% of Lost</th>
              </tr>
            </thead>
            <tbody>
              {lost.reasons.map((reason) => (
                <tr key={reason.key} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="text-slate-900 py-2 px-4 font-medium">{reason.label}</td>
                  <td className="text-slate-600 text-right py-2 px-3">{reason.count.toLocaleString()}</td>
                  <td className="text-slate-600 text-right py-2 px-3">{reason.nurture.toLocaleString()}</td>
                  <td className="text-slate-600 text-right py-2 px-3">{reason.lost.toLocaleString()}</td>
                  <td className="text-slate-900 text-right py-2 px-4">{lost.total > 0 ? pct((reason.count / lost.total) * 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2.5 text-[11px] text-slate-400 border-t border-slate-100">
            Reasons are AI-inferred from Upwork message threads and ClickUp task comments (backfilled 2026-08-26). &quot;In Nurture&quot; leads are still receiving winback touches; &quot;Hard Lost&quot; are closed out.
          </p>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import KpiCard from '@/components/KpiCard';
import {
  ComposedChart, BarChart as ReBarChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import type {
  UpworkJob, UpworkLead, UpworkFunnelFilters,
  FunnelMetrics, MonthlyDataPoint, ScriptPerformanceRow,
  HoursAfterPostBucket, BreakdownRow,
} from '@/lib/types/upwork-funnel';
import {
  applyFilters, computeFunnelMetrics, computeMonthlyTrend,
  computeScriptPerformance, computeHoursAfterPostBuckets, computeBreakdown,
} from '@/lib/engine/upwork-funnel';

/* ── Helpers ── */

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const CONNECT_COST = 0.15;

function dollars(connects: number): string {
  return `$${(connects * CONNECT_COST).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getWeekRange(weeksAgo: number): { start: string; end: string; label: string } {
  const now = new Date();
  const day = now.getDay();
  // Monday = start of week
  const mondayThisWeek = new Date(now);
  mondayThisWeek.setDate(now.getDate() - ((day + 6) % 7));
  mondayThisWeek.setHours(0, 0, 0, 0);

  const start = new Date(mondayThisWeek);
  start.setDate(start.getDate() - weeksAgo * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    start: toISODate(start),
    end: toISODate(end),
    label: weeksAgo === 0 ? 'This Week' : weeksAgo === 1 ? 'Last Week' : `${fmt(start)} – ${fmt(end)}`,
  };
}

const EMPTY_METRICS: FunnelMetrics = {
  totalApplications: 0, totalViewed: 0, totalMessaged: 0, totalSalesCalls: 0, totalWon: 0,
  viewRate: 0, replyRate: 0, callRate: 0, winRate: 0, callToCloseRate: 0,
  totalConnectsSpent: 0, avgConnectsPerApp: 0, connectsPerCall: 0, connectsPerWin: 0,
  avgCompetingProposals: 0, avgHoursAfterPost: 0,
};

const INITIAL_FILTERS: UpworkFunnelFilters = {
  dateRange: { start: null, end: null },
  scriptUsed: [], sourceType: [], businessType: [], profileUsed: [], platform: [],
};

const FUNNEL_COLORS = ['#14B8A6', '#3B82F6', '#F59E0B', '#8B5CF6', '#10B981'];

const DATE_PRESETS = [
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
  { label: 'YTD', days: -1 },
  { label: 'All', days: 0 },
] as const;

/* ── Filter chip ── */

function FilterChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                active
                  ? 'border-[#14B8A6] bg-emerald-50 text-emerald-700 font-semibold'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Status badge for ClickUp ── */

function LeadStatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  let style = 'bg-slate-100 text-slate-600';
  if (lower.includes('won') || lower === 'complete') style = 'bg-emerald-50 text-emerald-700';
  else if (lower.includes('lost')) style = 'bg-red-50 text-red-600';
  else if (lower.includes('call') || lower.includes('booking') || lower.includes('progress')) style = 'bg-blue-50 text-blue-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold capitalize ${style}`}>
      {status}
    </span>
  );
}

/* ── Breakdown table ── */

function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
            <th className="text-left py-2 px-4">Name</th>
            <th className="text-right py-2 px-3">Apps</th>
            <th className="text-right py-2 px-3">View %</th>
            <th className="text-right py-2 px-3">Reply %</th>
            <th className="text-right py-2 px-3">Call %</th>
            <th className="text-right py-2 px-3">Win %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-slate-100 hover:bg-slate-50/50">
              <td className="text-slate-900 py-2 px-4 font-medium capitalize">{row.name}</td>
              <td className="text-slate-600 text-right py-2 px-3">{row.count.toLocaleString()}</td>
              <td className="text-slate-900 text-right py-2 px-3">{pct(row.viewRate)}</td>
              <td className="text-slate-900 text-right py-2 px-3">{pct(row.replyRate)}</td>
              <td className="text-slate-900 text-right py-2 px-3">{pct(row.callRate)}</td>
              <td className="text-slate-900 text-right py-2 px-3">{pct(row.winRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  PAGE                                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

export default function UpworkFunnelPage() {
  /* ── Data fetch ── */
  const [allJobs, setAllJobs] = useState<UpworkJob[]>([]);
  const [upworkLeads, setUpworkLeads] = useState<UpworkLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Filters ── */
  const [filters, setFilters] = useState<UpworkFunnelFilters>(INITIAL_FILTERS);
  const [showClosedLeads, setShowClosedLeads] = useState(false);

  useEffect(() => {
    fetch('/api/upwork-funnel')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setAllJobs(data.upworkJobs ?? []);
        setUpworkLeads(data.upworkLeads ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  /* ── Enrich jobs with ClickUp-derived funnel data ── */
  const CALL_STAGES = new Set(['Call Booked', 'Pursuing', 'Contract Proposed']);
  const CALL_STATUSES = new Set(['follow up post-call', 'call booked pete']);
  const WON_STATUSES = new Set(['won', 'send invoice & contract']);

  const enrichedJobs = useMemo(() => {
    // Build lookup: clickup_task_id → lead
    const leadsById = new Map<string, typeof upworkLeads[0]>();
    for (const lead of upworkLeads) {
      if (lead.clickup_task_id) leadsById.set(lead.clickup_task_id, lead);
    }

    // Track which leads get matched to a job
    const matchedLeadIds = new Set<string>();

    const enriched = allJobs.map((job) => {
      const lead = job.clickup_task_id ? leadsById.get(job.clickup_task_id) : undefined;
      if (lead) matchedLeadIds.add(lead.clickup_task_id);
      const leadStatus = (lead?.status ?? '').toLowerCase();
      const leadStage = lead?.lead_funnel_stage ?? '';
      return {
        ...job,
        messaged: !!lead,
        sales_call: !!lead && (CALL_STAGES.has(leadStage) || CALL_STATUSES.has(leadStatus)),
        won: !!lead && WON_STATUSES.has(leadStatus),
      };
    });

    // Add unmatched leads as synthetic job entries so they count in the funnel
    for (const lead of upworkLeads) {
      if (matchedLeadIds.has(lead.clickup_task_id)) continue;
      const leadStatus = (lead.status ?? '').toLowerCase();
      const leadStage = lead.lead_funnel_stage ?? '';
      enriched.push({
        id: `lead-${lead.clickup_task_id}`,
        application_date: lead.date_created?.slice(0, 10) ?? null,
        week_number: null,
        job_name: lead.lead_name,
        script_used: null,
        source_type: null,
        profile_used: null,
        platform: null,
        business_type: null,
        connects_spent: null,
        competing_proposals: null,
        hours_after_post: null,
        viewed: false,
        messaged: true,
        sales_call: CALL_STAGES.has(leadStage) || CALL_STATUSES.has(leadStatus),
        won: WON_STATUSES.has(leadStatus),
        client_name: lead.lead_name,
        upwork_url: lead.upwork_proposal_url,
        clickup_task_id: lead.clickup_task_id,
      });
    }

    return enriched;
  }, [allJobs, upworkLeads]);

  /* ── Filter options (derived from data) ── */
  const filterOptions = useMemo(() => {
    const unique = (keyFn: (j: UpworkJob) => string | null) => {
      const set = new Set<string>();
      for (const j of enrichedJobs) set.add(keyFn(j) ?? 'Unknown');
      return Array.from(set).sort();
    };
    return {
      scripts: unique((j) => j.script_used),
      sourceTypes: unique((j) => j.source_type),
      businessTypes: unique((j) => j.business_type),
      profiles: unique((j) => j.profile_used),
      platforms: unique((j) => j.platform),
    };
  }, [enrichedJobs]);

  /* ── Filtered data + derived metrics ── */
  const filteredJobs = useMemo(() => applyFilters(enrichedJobs, filters), [enrichedJobs, filters]);
  const metrics = useMemo(() => filteredJobs.length > 0 ? computeFunnelMetrics(filteredJobs) : EMPTY_METRICS, [filteredJobs]);
  const monthlyTrend = useMemo(() => computeMonthlyTrend(filteredJobs), [filteredJobs]);
  const scriptPerformance = useMemo(() => computeScriptPerformance(filteredJobs), [filteredJobs]);
  const hoursAfterPostBuckets = useMemo(() => computeHoursAfterPostBuckets(filteredJobs), [filteredJobs]);
  const sourceTypeBreakdown = useMemo(() => computeBreakdown(filteredJobs, (j) => j.source_type ?? 'Unknown'), [filteredJobs]);
  const businessTypeBreakdown = useMemo(() => computeBreakdown(filteredJobs, (j) => j.business_type ?? 'Unknown'), [filteredJobs]);
  const platformBreakdown = useMemo(() => computeBreakdown(filteredJobs, (j) => j.platform ?? 'Unknown'), [filteredJobs]);

  const weeklyComparison = useMemo(() => {
    const weeks = [getWeekRange(1), getWeekRange(2)];
    const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

    const compute = (range: { start: string; end: string }) => {
      const jobs = enrichedJobs.filter((j) => j.application_date && j.application_date >= range.start && j.application_date <= range.end);
      const applied = jobs.length;
      const viewed = jobs.filter((j) => j.viewed).length;
      const replied = jobs.filter((j) => j.messaged).length;
      const calls = jobs.filter((j) => j.sales_call).length;
      const won = jobs.filter((j) => j.won).length;
      const connects = jobs.reduce((sum, j) => sum + (j.connects_spent ?? 0), 0);
      return {
        applied, viewed, replied, calls, won, connects,
        viewRate: safeDiv(viewed, applied),
        replyToViewRate: safeDiv(replied, viewed),
        callToReplyRate: safeDiv(calls, replied),
        winToCallRate: safeDiv(won, calls),
      };
    };

    // Last 10 weeks average (weeks 2-11 ago, excluding this week and last week)
    const last10Start = getWeekRange(10).start;
    const last10End = getWeekRange(1).end;
    const last10Jobs = enrichedJobs.filter((j) => j.application_date && j.application_date >= last10Start && j.application_date <= last10End);
    const l10Applied = last10Jobs.length;
    const l10Viewed = last10Jobs.filter((j) => j.viewed).length;
    const l10Replied = last10Jobs.filter((j) => j.messaged).length;
    const l10Calls = last10Jobs.filter((j) => j.sales_call).length;
    const l10Won = last10Jobs.filter((j) => j.won).length;
    const l10Connects = last10Jobs.reduce((sum, j) => sum + (j.connects_spent ?? 0), 0);

    const last10Avg = {
      applied: l10Applied / 10,
      viewed: l10Viewed / 10,
      replied: l10Replied / 10,
      calls: l10Calls / 10,
      won: l10Won / 10,
      connects: l10Connects / 10,
      viewRate: safeDiv(l10Viewed, l10Applied),
      replyToViewRate: safeDiv(l10Replied, l10Viewed),
      callToReplyRate: safeDiv(l10Calls, l10Replied),
      winToCallRate: safeDiv(l10Won, l10Calls),
    };

    return {
      thisWeek: { ...compute(weeks[0]), label: 'Last Week' },
      lastWeek: { ...compute(weeks[1]), label: '2 Weeks Ago' },
      last10Avg: { ...last10Avg, label: 'Last 10 Wks (avg)' },
    };
  }, [enrichedJobs]);

  const salesmanStats = useMemo(() => {
    // Build lead lookup
    const leadsById = new Map<string, typeof upworkLeads[0]>();
    for (const lead of upworkLeads) {
      if (lead.clickup_task_id) leadsById.set(lead.clickup_task_id, lead);
    }

    // Group filtered jobs by salesman (from their linked lead)
    const bySalesman = new Map<string, { leads: number; calls: number; won: number; connectsSpent: number }>();
    for (const job of filteredJobs) {
      if (!job.clickup_task_id) continue;
      const lead = leadsById.get(job.clickup_task_id);
      if (!lead) continue;

      const name = lead.salesman || 'Unassigned';
      const entry = bySalesman.get(name) ?? { leads: 0, calls: 0, won: 0, connectsSpent: 0 };
      entry.leads++;
      if (job.sales_call) entry.calls++;
      if (job.won) entry.won++;
      entry.connectsSpent += job.connects_spent ?? 0;
      bySalesman.set(name, entry);
    }

    return Array.from(bySalesman.entries())
      .map(([name, s]) => ({
        name,
        leads: s.leads,
        calls: s.calls,
        won: s.won,
        callRate: s.leads > 0 ? s.calls / s.leads : 0,
        winRate: s.leads > 0 ? s.won / s.leads : 0,
        closeRate: s.calls > 0 ? s.won / s.calls : 0,
        connectsPerWin: s.won > 0 ? s.connectsSpent / s.won : 0,
      }))
      .sort((a, b) => b.leads - a.leads);
  }, [filteredJobs, upworkLeads]);

  const leadFunnelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const lead of upworkLeads) {
      const stage = lead.status || 'Unknown';
      counts[stage] = (counts[stage] ?? 0) + 1;
    }
    return counts;
  }, [upworkLeads]);

  /* ── Filter handlers ── */
  const toggleFilter = useCallback((key: keyof Pick<UpworkFunnelFilters, 'scriptUsed' | 'sourceType' | 'businessType' | 'profileUsed' | 'platform'>, value: string) => {
    setFilters((prev) => {
      const arr = prev[key];
      return { ...prev, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  }, []);

  const setDatePreset = useCallback((preset: typeof DATE_PRESETS[number]) => {
    if (preset.days === 0) {
      setFilters((prev) => ({ ...prev, dateRange: { start: null, end: null } }));
    } else if (preset.days === -1) {
      setFilters((prev) => ({ ...prev, dateRange: { start: `${new Date().getFullYear()}-01-01`, end: null } }));
    } else {
      const start = new Date();
      start.setDate(start.getDate() - preset.days);
      setFilters((prev) => ({ ...prev, dateRange: { start: toISODate(start), end: null } }));
    }
  }, []);

  const hasFilters = filters.scriptUsed.length > 0 || filters.sourceType.length > 0
    || filters.businessType.length > 0 || filters.profileUsed.length > 0
    || filters.platform.length > 0 || filters.dateRange.start != null || filters.dateRange.end != null;

  /* ── Chart data ── */
  const funnelData = [
    { name: 'Applied', count: metrics.totalApplications, pct: 100 },
    { name: 'Viewed', count: metrics.totalViewed, pct: metrics.viewRate * 100 },
    { name: 'Messaged', count: metrics.totalMessaged, pct: metrics.replyRate * 100 },
    { name: 'Sales Call', count: metrics.totalSalesCalls, pct: metrics.callRate * 100 },
    { name: 'Won', count: metrics.totalWon, pct: metrics.winRate * 100 },
  ];

  const trendData = monthlyTrend.map((d) => ({
    month: d.month.slice(2),
    applications: d.applications,
    viewRate: +(d.viewRate * 100).toFixed(1),
    replyRate: +(d.replyRate * 100).toFixed(1),
    callRate: +(d.callRate * 100).toFixed(1),
    winRate: +(d.winRate * 100).toFixed(1),
  }));

  const hoursData = hoursAfterPostBuckets.map((b) => ({
    label: b.label,
    count: b.count,
    viewRate: +(b.viewRate * 100).toFixed(1),
    replyRate: +(b.replyRate * 100).toFixed(1),
    callRate: +(b.callRate * 100).toFixed(1),
    winRate: +(b.winRate * 100).toFixed(1),
  }));

  /* ── Script performance best-of ── */
  const bestView = Math.max(...scriptPerformance.map((r) => r.viewRate), 0);
  const bestReply = Math.max(...scriptPerformance.map((r) => r.replyRate), 0);
  const bestCall = Math.max(...scriptPerformance.map((r) => r.callRate), 0);
  const bestWin = Math.max(...scriptPerformance.map((r) => r.winRate), 0);

  /* ── Loading / Error ── */
  if (loading) return <div className="p-12 text-center text-slate-400">Loading Upwork funnel data...</div>;
  if (error) return <div className="p-12 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Upwork Funnel</h2>
        <p className="text-sm text-slate-500 mt-1">
          {filteredJobs.length.toLocaleString()} of {enrichedJobs.length.toLocaleString()} applications
          {upworkLeads.length > 0 && ` · ${upworkLeads.length} ClickUp leads`}
        </p>
      </div>

      {/* Weekly Comparison */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
              <th className="text-left py-2.5 px-4 font-semibold"></th>
              <th className="text-right py-2.5 px-4 font-semibold">{weeklyComparison.thisWeek.label}</th>
              <th className="text-right py-2.5 px-4 font-semibold">{weeklyComparison.lastWeek.label}</th>
              <th className="text-right py-2.5 px-4 font-semibold">{weeklyComparison.last10Avg.label}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Jobs Applied', key: 'applied', inverse: false },
              { label: 'Applications Viewed', key: 'viewed', inverse: false },
              { label: 'Replies Received', key: 'replied', inverse: false },
              { label: 'Calls Booked', key: 'calls', inverse: false },
              { label: 'Clients Won', key: 'won', inverse: false },
              { label: 'Spend', key: 'connects', inverse: true },
            ].map(({ label, key, inverse }) => {
              const tw = weeklyComparison.thisWeek[key as keyof typeof weeklyComparison.thisWeek] as number;
              const lw = weeklyComparison.lastWeek[key as keyof typeof weeklyComparison.lastWeek] as number;
              const avg = weeklyComparison.last10Avg[key as keyof typeof weeklyComparison.last10Avg] as number;
              const fmt = key === 'connects'
                ? (v: number) => dollars(v)
                : (v: number, isAvg?: boolean) => isAvg ? v.toFixed(1) : v.toLocaleString();
              const twAbove = inverse ? tw < avg : tw > avg;
              const twBelow = inverse ? tw > avg : tw < avg;
              return (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-2 px-4 font-medium text-slate-900">{label}</td>
                  <td className="py-2 px-4 text-right font-semibold">
                    <span className={twAbove ? 'text-emerald-600' : twBelow ? 'text-red-500' : 'text-slate-900'}>
                      {twAbove ? '\u25B2 ' : twBelow ? '\u25BC ' : ''}{fmt(tw)}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-slate-700">{fmt(lw)}</td>
                  <td className="py-2 px-4 text-right text-slate-500">{fmt(avg, true)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200">
              <td colSpan={4} className="py-1.5"></td>
            </tr>
            {[
              { label: 'View Rate', key: 'viewRate' },
              { label: 'Views → Replies', key: 'replyToViewRate' },
              { label: 'Replies → Calls', key: 'callToReplyRate' },
              { label: 'Calls → Clients', key: 'winToCallRate' },
            ].map(({ label, key }) => {
              const tw = weeklyComparison.thisWeek[key as keyof typeof weeklyComparison.thisWeek] as number;
              const lw = weeklyComparison.lastWeek[key as keyof typeof weeklyComparison.lastWeek] as number;
              const avg = weeklyComparison.last10Avg[key as keyof typeof weeklyComparison.last10Avg] as number;
              const twAbove = tw > avg;
              const twBelow = tw < avg;
              return (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-2 px-4 font-medium text-slate-900">{label}</td>
                  <td className="py-2 px-4 text-right font-semibold">
                    <span className={twAbove ? 'text-emerald-600' : twBelow ? 'text-red-500' : 'text-slate-900'}>
                      {twAbove ? '\u25B2 ' : twBelow ? '\u25BC ' : ''}{pct(tw)}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-slate-700">{pct(lw)}</td>
                  <td className="py-2 px-4 text-right text-slate-500">{pct(avg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Filters</h3>
          {hasFilters && (
            <button onClick={() => setFilters(INITIAL_FILTERS)} className="text-xs text-red-500 hover:underline">
              Clear All
            </button>
          )}
        </div>

        {/* Date presets + custom range */}
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Date Range</p>
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
              value={filters.dateRange.start ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateRange: { ...prev.dateRange, start: e.target.value || null } }))}
              className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={filters.dateRange.end ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateRange: { ...prev.dateRange, end: e.target.value || null } }))}
              className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <FilterChipGroup label="Script" options={filterOptions.scripts} selected={filters.scriptUsed} onToggle={(v) => toggleFilter('scriptUsed', v)} />
          <FilterChipGroup label="Source" options={filterOptions.sourceTypes} selected={filters.sourceType} onToggle={(v) => toggleFilter('sourceType', v)} />
          <FilterChipGroup label="Business Type" options={filterOptions.businessTypes} selected={filters.businessType} onToggle={(v) => toggleFilter('businessType', v)} />
          <FilterChipGroup label="Profile" options={filterOptions.profiles} selected={filters.profileUsed} onToggle={(v) => toggleFilter('profileUsed', v)} />
          <FilterChipGroup label="Platform" options={filterOptions.platforms} selected={filters.platform} onToggle={(v) => toggleFilter('platform', v)} />
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Applications" value={metrics.totalApplications.toLocaleString()} />
        <KpiCard label="View Rate" value={pct(metrics.viewRate)} change={`${metrics.totalViewed.toLocaleString()} viewed`} />
        <KpiCard label="Reply Rate" value={pct(metrics.replyRate)} change={`${metrics.totalMessaged.toLocaleString()} messaged`} />
        <KpiCard label="Call Rate" value={pct(metrics.callRate)} change={`${metrics.totalSalesCalls.toLocaleString()} calls`} />
        <KpiCard label="Win Rate" value={pct(metrics.winRate)} change={`${metrics.totalWon.toLocaleString()} won`} />
      </div>

      {/* Funnel Chart */}
      {metrics.totalApplications > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Funnel Overview</h3>
          <ResponsiveContainer width="100%" height={220}>
            <ReBarChart data={funnelData} layout="vertical" margin={{ left: 10, right: 60, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={80} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }}
                formatter={(value, _name, entry) => {
                  const v = typeof value === 'number' ? value : Number(value);
                  const p = (entry?.payload as { pct?: number })?.pct ?? 0;
                  return [`${v.toLocaleString()} (${p.toFixed(1)}%)`, 'Count'];
                }}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={28}>
                {funnelData.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[i]} />)}
              </Bar>
            </ReBarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Spend Efficiency */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Total Spend" value={dollars(metrics.totalConnectsSpent)} />
        <KpiCard label="Cost / Call" value={dollars(metrics.connectsPerCall)} />
        <KpiCard label="Cost / Win" value={dollars(metrics.connectsPerWin)} />
        <KpiCard label="Avg Competition" value={metrics.avgCompetingProposals.toFixed(1)} change="competing proposals" />
      </div>

      {/* Monthly Trend */}
      {trendData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Monthly Trends</h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={trendData} margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 50]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="applications" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={24} name="Applications" />
              <Line yAxisId="right" type="monotone" dataKey="viewRate" stroke="#14B8A6" strokeWidth={2} dot={false} name="View %" />
              <Line yAxisId="right" type="monotone" dataKey="replyRate" stroke="#3B82F6" strokeWidth={2} dot={false} name="Reply %" />
              <Line yAxisId="right" type="monotone" dataKey="callRate" stroke="#F59E0B" strokeWidth={2} dot={false} name="Call %" />
              <Line yAxisId="right" type="monotone" dataKey="winRate" stroke="#10B981" strokeWidth={2} dot={false} name="Win %" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Script Performance */}
      {scriptPerformance.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Script Performance</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                  <th className="text-left py-2 px-4">Script</th>
                  <th className="text-right py-2 px-3">Apps</th>
                  <th className="text-right py-2 px-3">View %</th>
                  <th className="text-right py-2 px-3">Reply %</th>
                  <th className="text-right py-2 px-3">Call %</th>
                  <th className="text-right py-2 px-3">Win %</th>
                  <th className="text-right py-2 px-3">Avg Connects</th>
                </tr>
              </thead>
              <tbody>
                {scriptPerformance.map((row) => (
                  <tr key={row.scriptName} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="text-slate-900 py-2 px-4 font-medium">{row.scriptName}</td>
                    <td className="text-slate-600 text-right py-2 px-3">{row.count.toLocaleString()}</td>
                    <td className={`text-right py-2 px-3 ${row.viewRate === bestView && row.viewRate > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>{pct(row.viewRate)}</td>
                    <td className={`text-right py-2 px-3 ${row.replyRate === bestReply && row.replyRate > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>{pct(row.replyRate)}</td>
                    <td className={`text-right py-2 px-3 ${row.callRate === bestCall && row.callRate > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>{pct(row.callRate)}</td>
                    <td className={`text-right py-2 px-3 ${row.winRate === bestWin && row.winRate > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>{pct(row.winRate)}</td>
                    <td className="text-slate-600 text-right py-2 px-3">{row.avgConnects.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hours After Post Impact */}
      {hoursData.some((d) => d.count > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Hours After Post vs Performance</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                <th className="text-left py-2 px-4">Timing</th>
                <th className="text-right py-2 px-3">Apps</th>
                <th className="text-right py-2 px-3">View %</th>
                <th className="text-right py-2 px-3">Reply %</th>
                <th className="text-right py-2 px-3">Call %</th>
                <th className="text-right py-2 px-3">Win %</th>
              </tr>
            </thead>
            <tbody>
              {hoursData.map((d) => (
                <tr key={d.label} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="text-slate-900 py-2 px-4 font-medium">{d.label}</td>
                  <td className="text-slate-600 text-right py-2 px-3">{d.count.toLocaleString()}</td>
                  <td className="text-slate-900 text-right py-2 px-3">{d.viewRate.toFixed(1)}%</td>
                  <td className="text-slate-900 text-right py-2 px-3">{d.replyRate.toFixed(1)}%</td>
                  <td className="text-slate-900 text-right py-2 px-3">{d.callRate.toFixed(1)}%</td>
                  <td className="text-slate-900 text-right py-2 px-3">{d.winRate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownTable title="By Source Type" rows={sourceTypeBreakdown} />
        <BreakdownTable title="By Business Type" rows={businessTypeBreakdown} />
        <BreakdownTable title="By Platform" rows={platformBreakdown} />
      </div>

      {/* Salesman Performance */}
      {salesmanStats.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Performance by Salesman</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {salesmanStats.map((s) => (
              <div key={s.name} className="border border-slate-200 rounded-lg p-4">
                <p className="text-base font-semibold text-slate-900 mb-3 capitalize">{s.name}</p>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                  <div>
                    <p className="text-slate-500">Leads</p>
                    <p className="text-lg font-bold text-slate-900">{s.leads}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Calls Booked</p>
                    <p className="text-lg font-bold text-slate-900">{s.calls}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Won</p>
                    <p className="text-lg font-bold text-emerald-600">{s.won}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Close Rate</p>
                    <p className="text-lg font-bold text-slate-900">{s.calls > 0 ? pct(s.closeRate) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Lead → Call</p>
                    <p className="text-sm font-semibold text-slate-700">{pct(s.callRate)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Lead → Win</p>
                    <p className="text-sm font-semibold text-slate-700">{pct(s.winRate)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Connects / Win</p>
                    <p className="text-sm font-semibold text-slate-700">{s.won > 0 ? s.connectsPerWin.toFixed(0) : '—'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ClickUp Pipeline */}
      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Upwork Lead Pipeline</h3>
            <button
              onClick={() => setShowClosedLeads((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showClosedLeads ? 'Hide' : 'Show'} closed leads
            </button>
          </div>
          {Object.keys(leadFunnelCounts).length === 0 ? (
            <p className="text-slate-400 text-sm">No Upwork leads found — run sync_leads.py to populate</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {Object.entries(leadFunnelCounts)
                .filter(([status]) => {
                  const lower = status.toLowerCase();
                  const isClosed = lower.includes('lost') || lower === 'referred' || lower === 'referred to denise';
                  return showClosedLeads || !isClosed;
                })
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => {
                  const lower = status.toLowerCase();
                  let cardStyle = 'bg-slate-50 border-slate-200';
                  if (lower === 'won') cardStyle = 'bg-emerald-50 border-emerald-200';
                  else if (lower.includes('call booked') || lower.includes('pursuing')) cardStyle = 'bg-blue-50 border-blue-200';
                  else if (lower.includes('invoice') || lower.includes('contract')) cardStyle = 'bg-emerald-50 border-emerald-200';
                  else if (lower.includes('lost')) cardStyle = 'bg-slate-50 border-slate-200 opacity-60';
                  return (
                    <div key={status} className={`border rounded-lg px-4 py-2 ${cardStyle}`}>
                      <p className="text-xl font-bold text-slate-900">{count}</p>
                      <p className="text-xs text-slate-500 capitalize">{status}</p>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {upworkLeads.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Recent Leads</h3>
            <div className="space-y-2">
              {upworkLeads.slice(0, 10).map((lead) => (
                <div key={lead.clickup_task_id} className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate">{lead.lead_name}</p>
                      {lead.upwork_proposal_url && (
                        <a href={lead.upwork_proposal_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline shrink-0">Proposal</a>
                      )}
                    </div>
                    {lead.lead_funnel_stage && <p className="text-xs text-slate-500 mt-0.5">{lead.lead_funnel_stage}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <LeadStatusBadge status={lead.status ?? 'unknown'} />
                    {lead.date_last_contacted && <span className="text-xs text-slate-400">Last: {formatDate(lead.date_last_contacted)}</span>}
                    <span className="text-xs text-slate-400">{formatDate(lead.date_created)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked Applications (matched to ClickUp leads via task ID) */}
        {(() => {
          // Build a map of ClickUp task IDs to leads for O(1) lookup
          const leadsById = new Map<string, typeof upworkLeads[0]>();
          for (const lead of upworkLeads) {
            if (lead.clickup_task_id) {
              leadsById.set(lead.clickup_task_id, lead);
            }
          }

          // Find jobs that have a matching lead via clickup_task_id
          const linkedJobs = filteredJobs
            .filter((job) => job.clickup_task_id && leadsById.has(job.clickup_task_id))
            .slice(0, 20);

          if (linkedJobs.length === 0 && leadsById.size === 0) return null;

          return (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">Linked Applications &rarr; ClickUp Leads</h3>
              <p className="text-xs text-slate-500 mb-4">
                {linkedJobs.length} of {filteredJobs.filter((j) => j.clickup_task_id).length} applications linked to ClickUp leads
              </p>
              {linkedJobs.length === 0 ? (
                <p className="text-sm text-slate-400">No matches found &mdash; ensure ClickUp task IDs in the spreadsheet match task IDs in the Upwork Leads list.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                        <th className="text-left py-2 px-3">Job</th>
                        <th className="text-left py-2 px-3">Applied</th>
                        <th className="text-center py-2 px-3">Viewed</th>
                        <th className="text-center py-2 px-3">Messaged</th>
                        <th className="text-center py-2 px-3">Call</th>
                        <th className="text-center py-2 px-3">Won</th>
                        <th className="text-left py-2 px-3">ClickUp Status</th>
                        <th className="text-left py-2 px-3">Last Contact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linkedJobs.map((job) => {
                        const lead = leadsById.get(job.clickup_task_id!)!;
                        return (
                          <tr key={job.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                            <td className="py-2 px-3 max-w-[200px]">
                              <p className="font-medium text-slate-900 truncate">{job.job_name ?? 'Untitled'}</p>
                              <p className="text-slate-400 truncate">{lead.lead_name}</p>
                            </td>
                            <td className="text-slate-600 py-2 px-3 whitespace-nowrap">{formatDate(job.application_date)}</td>
                            <td className="text-center py-2 px-3">{job.viewed ? '\u2713' : '\u2014'}</td>
                            <td className="text-center py-2 px-3">{job.messaged ? '\u2713' : '\u2014'}</td>
                            <td className="text-center py-2 px-3">{job.sales_call ? '\u2713' : '\u2014'}</td>
                            <td className="text-center py-2 px-3">{job.won ? '\u2713' : '\u2014'}</td>
                            <td className="py-2 px-3"><LeadStatusBadge status={lead.status ?? 'unknown'} /></td>
                            <td className="text-slate-400 py-2 px-3 whitespace-nowrap">{formatDate(lead.date_last_contacted)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

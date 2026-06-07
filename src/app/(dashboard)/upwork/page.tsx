'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import KpiCard from '@/components/KpiCard';
import {
  ComposedChart, BarChart as ReBarChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import type {
  UpworkJob, UpworkLead, UpworkFunnelFilters,
  FunnelMetrics, MonthlyDataPoint, ScriptPerformanceRow,
  HoursAfterPostBucket, BreakdownRow, BoostComparisonMetrics,
  TrendGranularity,
} from '@/lib/types/upwork-funnel';
import {
  applyFilters, computeFunnelMetrics, computeMonthlyTrend, computeWeeklyTrend,
  computeTrend, computeScriptPerformance, computeScriptMonthlyComparison,
  computeHoursAfterPostBuckets, computeBreakdown, computeRateBreakdown,
  computeBoostComparison,
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
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

const DEFAULT_6MO_START = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 180);
  return toISODate(d);
})();

const INITIAL_FILTERS: UpworkFunnelFilters = {
  dateRange: { start: DEFAULT_6MO_START, end: null },
  scriptUsed: [], sourceType: [], businessType: [], profileUsed: [], platform: [],
};

const FUNNEL_COLORS = ['#14B8A6', '#3B82F6', '#F59E0B', '#8B5CF6', '#10B981'];

const DATE_PRESETS = [
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
  { label: 'Last 6mo', days: 180 },
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
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('monthly');

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
  const CALL_STATUSES = new Set(['follow up post-call', 'call booked pete', 'call booked cade']);
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
        boosted: false,
        boost_spend: null,
        client_max_rate: null,
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
  // Spreadsheet-only jobs (exclude synthetic leads from ClickUp for breakdowns)
  const sheetJobs = useMemo(() => filteredJobs.filter((j) => !j.id.startsWith('lead-')), [filteredJobs]);
  const metrics = useMemo(() => filteredJobs.length > 0 ? computeFunnelMetrics(filteredJobs) : EMPTY_METRICS, [filteredJobs]);
  const monthlyTrend = useMemo(() => computeMonthlyTrend(sheetJobs), [sheetJobs]);
  const trendByGranularity = useMemo(() => computeTrend(sheetJobs, trendGranularity), [sheetJobs, trendGranularity]);
  const scriptPerformance = useMemo(() => computeScriptPerformance(sheetJobs), [sheetJobs]);
  const scriptMonthly = useMemo(() => computeScriptMonthlyComparison(sheetJobs), [sheetJobs]);
  const hoursAfterPostBuckets = useMemo(() => computeHoursAfterPostBuckets(sheetJobs), [sheetJobs]);
  const sourceTypeBreakdown = useMemo(() => computeBreakdown(sheetJobs, (j) => j.source_type ?? 'Unknown'), [sheetJobs]);
  const businessTypeBreakdown = useMemo(() => computeBreakdown(sheetJobs, (j) => j.business_type ?? 'Unknown'), [sheetJobs]);
  const platformBreakdown = useMemo(() => computeBreakdown(sheetJobs, (j) => j.platform ?? 'Unknown'), [sheetJobs]);
  const boostComparison = useMemo(() => computeBoostComparison(sheetJobs), [sheetJobs]);
  const rateBreakdown = useMemo(() => computeRateBreakdown(filteredJobs), [filteredJobs]);
  // Weekly trend uses enrichedJobs (includes ClickUp leads) to match weekly comparison table
  // Slice to last 26 weeks (~6 months)
  const weeklyTrend = useMemo(() => computeWeeklyTrend(enrichedJobs).slice(-26), [enrichedJobs]);

  const weeklyComparison = useMemo(() => {
    const weeks = [getWeekRange(2), getWeekRange(3), getWeekRange(4)];
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

    // Last 10 weeks average starting from 2 weeks ago (weeks 2-11 ago)
    const last10Start = getWeekRange(11).start;
    const last10End = getWeekRange(2).end;
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
      twoWeeksAgo: { ...compute(weeks[0]), label: '2 Weeks Ago' },
      threeWeeksAgo: { ...compute(weeks[1]), label: '3 Weeks Ago' },
      fourWeeksAgo: { ...compute(weeks[2]), label: '4 Weeks Ago' },
      last10Avg: { ...last10Avg, label: '10 Wk Avg' },
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

  const KNOWN_LEAD_STATUSES = [
    'won', 'send invoice & contract', 'call booked pete', 'call booked cade',
    'pursuing', 'in discussion', 'follow up  pre-call', 'follow up post-call',
    'call requested', 'referred', 'referred to denise', 'lost (follow up)', 'lost (dnd)',
  ];

  const leadFunnelCounts = useMemo(() => {
    // Initialize all known statuses to 0
    const counts: Record<string, number> = {};
    for (const s of KNOWN_LEAD_STATUSES) counts[s] = 0;

    // Filter leads by active date range
    const dateStart = filters.dateRange.start;
    const dateEnd = filters.dateRange.end;

    for (const lead of upworkLeads) {
      const created = lead.date_created?.slice(0, 10) ?? '';
      if (dateStart && created < dateStart) continue;
      if (dateEnd && created > dateEnd) continue;
      const stage = lead.status || 'Unknown';
      counts[stage] = (counts[stage] ?? 0) + 1;
    }
    return counts;
  }, [upworkLeads, filters.dateRange]);

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

  const trendData = trendByGranularity.map((d) => ({
    label: d.label,
    applications: d.applications,
    viewRate: +(d.viewRate * 100).toFixed(1),
    replyRate: +(d.replyRate * 100).toFixed(1),
    callRate: +(d.callRate * 100).toFixed(1),
    winRate: +(d.winRate * 100).toFixed(1),
    viewToReply: +(d.viewToReply * 100).toFixed(1),
    replyToCall: +(d.replyToCall * 100).toFixed(1),
    callToWin: +(d.callToWin * 100).toFixed(1),
    replyToWin: +(d.replyToWin * 100).toFixed(1),
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

      {/* Weekly Trend Charts */}
      {weeklyTrend.length > 0 && (
        <div className="space-y-6">
          {/* Chart 1: Funnel & Drop-off Tracker (stage-to-stage %) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Upwork Funnel and Drop-off Tracker</h3>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={weeklyTrend} margin={{ left: 0, right: 0, top: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="weekLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} angle={-45} textAnchor="end" height={60} interval={Math.max(0, Math.floor(weeklyTrend.length / 20))} />
                <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 text-xs">
                      <p className="font-semibold text-slate-900 mb-1.5">Week of {data.weekLabel}</p>
                      {payload.map((entry: any) => (
                        <p key={entry.dataKey} style={{ color: entry.color }}>{entry.name}: {Number(entry.value).toFixed(1)}%</p>
                      ))}
                    </div>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="viewRate" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Applications" />
                <Line type="monotone" dataKey="viewsToReplies" stroke="#EF4444" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Views to replies" />
                <Line type="monotone" dataKey="repliesToCalls" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Replies to calls" />
                <Line type="monotone" dataKey="callsToClients" stroke="#22C55E" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Calls to clients" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 2: Jobs Applied To & Applications Viewed (raw counts) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Jobs Applied To & Applications Viewed</h3>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weeklyTrend} margin={{ left: 0, right: 0, top: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="weekLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} angle={-45} textAnchor="end" height={60} interval={Math.max(0, Math.floor(weeklyTrend.length / 20))} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 text-xs">
                      <p className="font-semibold text-slate-900 mb-1.5">Week of {data.weekLabel}</p>
                      {payload.map((entry: any) => (
                        <p key={entry.dataKey} style={{ color: entry.color }}>{entry.name}: {entry.value}</p>
                      ))}
                    </div>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="applied" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Jobs applied to" />
                <Line type="monotone" dataKey="viewed" stroke="#EF4444" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Applications viewed" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 3: Replies Received & Calls Booked & Clients Won (raw counts) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Replies Received & Calls Booked & Clients Won</h3>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weeklyTrend} margin={{ left: 0, right: 0, top: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="weekLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} angle={-45} textAnchor="end" height={60} interval={Math.max(0, Math.floor(weeklyTrend.length / 20))} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 text-xs">
                      <p className="font-semibold text-slate-900 mb-1.5">Week of {data.weekLabel}</p>
                      {payload.map((entry: any) => (
                        <p key={entry.dataKey} style={{ color: entry.color }}>{entry.name}: {entry.value}</p>
                      ))}
                    </div>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="messaged" stroke="#22C55E" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Replies received" />
                <Line type="monotone" dataKey="salesCalls" stroke="#FACC15" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Calls booked" />
                <Line type="monotone" dataKey="won" stroke="#F97316" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Clients won" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Weekly Comparison */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
              <th className="text-left py-2.5 px-4 font-semibold"></th>
              <th className="text-right py-2.5 px-4 font-semibold">{weeklyComparison.twoWeeksAgo.label}</th>
              <th className="text-right py-2.5 px-4 font-semibold">{weeklyComparison.threeWeeksAgo.label}</th>
              <th className="text-right py-2.5 px-4 font-semibold">{weeklyComparison.fourWeeksAgo.label}</th>
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
              const w2 = weeklyComparison.twoWeeksAgo[key as keyof typeof weeklyComparison.twoWeeksAgo] as number;
              const w3 = weeklyComparison.threeWeeksAgo[key as keyof typeof weeklyComparison.threeWeeksAgo] as number;
              const w4 = weeklyComparison.fourWeeksAgo[key as keyof typeof weeklyComparison.fourWeeksAgo] as number;
              const avg = weeklyComparison.last10Avg[key as keyof typeof weeklyComparison.last10Avg] as number;
              const fmt = key === 'connects'
                ? (v: number) => dollars(v)
                : (v: number, isAvg?: boolean) => isAvg ? v.toFixed(1) : v.toLocaleString();
              const w2Above = inverse ? w2 < avg : w2 > avg;
              const w2Below = inverse ? w2 > avg : w2 < avg;
              return (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-2 px-4 font-medium text-slate-900">{label}</td>
                  <td className="py-2 px-4 text-right font-semibold">
                    <span className={w2Above ? 'text-emerald-600' : w2Below ? 'text-red-500' : 'text-slate-900'}>
                      {w2Above ? '\u25B2 ' : w2Below ? '\u25BC ' : ''}{fmt(w2)}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-slate-700">{fmt(w3)}</td>
                  <td className="py-2 px-4 text-right text-slate-700">{fmt(w4)}</td>
                  <td className="py-2 px-4 text-right text-slate-500">{fmt(avg, true)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200">
              <td colSpan={5} className="py-1.5"></td>
            </tr>
            {[
              { label: 'View Rate', key: 'viewRate' },
              { label: 'Views → Replies', key: 'replyToViewRate' },
              { label: 'Replies → Calls', key: 'callToReplyRate' },
              { label: 'Calls → Clients', key: 'winToCallRate' },
            ].map(({ label, key }) => {
              const w2 = weeklyComparison.twoWeeksAgo[key as keyof typeof weeklyComparison.twoWeeksAgo] as number;
              const w3 = weeklyComparison.threeWeeksAgo[key as keyof typeof weeklyComparison.threeWeeksAgo] as number;
              const w4 = weeklyComparison.fourWeeksAgo[key as keyof typeof weeklyComparison.fourWeeksAgo] as number;
              const avg = weeklyComparison.last10Avg[key as keyof typeof weeklyComparison.last10Avg] as number;
              const w2Above = w2 > avg;
              const w2Below = w2 < avg;
              return (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-2 px-4 font-medium text-slate-900">{label}</td>
                  <td className="py-2 px-4 text-right font-semibold">
                    <span className={w2Above ? 'text-emerald-600' : w2Below ? 'text-red-500' : 'text-slate-900'}>
                      {w2Above ? '\u25B2 ' : w2Below ? '\u25BC ' : ''}{pct(w2)}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-slate-700">{pct(w3)}</td>
                  <td className="py-2 px-4 text-right text-slate-700">{pct(w4)}</td>
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

      {/* Job Rate Breakdown */}
      {rateBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Performance by Job Rate</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                <th className="text-left py-2.5 px-4 font-semibold">Rate</th>
                <th className="text-right py-2.5 px-3 font-semibold">Apps</th>
                <th className="text-right py-2.5 px-3 font-semibold">View %</th>
                <th className="text-right py-2.5 px-3 font-semibold">Reply %</th>
                <th className="text-right py-2.5 px-3 font-semibold">Call %</th>
                <th className="text-right py-2.5 px-3 font-semibold">Win %</th>
                <th className="text-right py-2.5 px-3 font-semibold">Replies</th>
                <th className="text-right py-2.5 px-3 font-semibold">Calls</th>
                <th className="text-right py-2.5 px-3 font-semibold">Won</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const bestReply = Math.max(...rateBreakdown.map((r) => r.replyRate));
                const bestCall = Math.max(...rateBreakdown.map((r) => r.callRate));
                return rateBreakdown.map((row) => (
                  <tr key={row.bucket} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="text-slate-900 py-2 px-4 font-medium">{row.bucket}</td>
                    <td className="text-slate-600 text-right py-2 px-3">{row.apps.toLocaleString()}</td>
                    <td className="text-slate-900 text-right py-2 px-3">{pct(row.viewRate)}</td>
                    <td className={`text-right py-2 px-3 ${row.replyRate === bestReply && bestReply > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>{pct(row.replyRate)}</td>
                    <td className={`text-right py-2 px-3 ${row.callRate === bestCall && bestCall > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>{pct(row.callRate)}</td>
                    <td className="text-slate-900 text-right py-2 px-3">{pct(row.winRate)}</td>
                    <td className="text-slate-600 text-right py-2 px-3">{row.replies}</td>
                    <td className="text-slate-600 text-right py-2 px-3">{row.calls}</td>
                    <td className="text-slate-600 text-right py-2 px-3">{row.won}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Boosted vs Unboosted Comparison */}
      {boostComparison.boosted.applications > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Boosted vs Unboosted Performance</h3>
            <p className="text-xs text-slate-500 mt-0.5">Cost includes base connects + boost spend. $0.15 per connect.</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                <th className="text-left py-2.5 px-4 font-semibold"></th>
                <th className="text-right py-2.5 px-4 font-semibold">Boosted</th>
                <th className="text-right py-2.5 px-4 font-semibold">Unboosted</th>
                <th className="text-right py-2.5 px-4 font-semibold">Delta</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const b = boostComparison.boosted;
                const u = boostComparison.unboosted;
                const fmtD = (v: number) => `$${v.toFixed(2)}`;
                const fmtP = (v: number) => `${(v * 100).toFixed(1)}%`;
                const deltaColor = (bVal: number, uVal: number, lowerIsBetter: boolean) => {
                  const diff = bVal - uVal;
                  if (Math.abs(diff) < 0.001) return 'text-slate-500';
                  return (lowerIsBetter ? diff < 0 : diff > 0) ? 'text-emerald-600' : 'text-red-500';
                };
                const deltaFmt = (bVal: number, uVal: number, fmt: (v: number) => string) => {
                  const diff = bVal - uVal;
                  const sign = diff > 0 ? '+' : '';
                  return `${sign}${fmt(diff)}`;
                };

                const rows = [
                  { label: 'Applications', bVal: b.applications, uVal: u.applications, fmt: (v: number) => v.toLocaleString(), lower: false },
                  { label: 'Total Spend', bVal: b.totalConnects * 0.15, uVal: u.totalConnects * 0.15, fmt: fmtD, lower: true },
                  { label: 'View Rate', bVal: b.viewRate, uVal: u.viewRate, fmt: fmtP, lower: false },
                  { label: 'Reply Rate', bVal: b.replyRate, uVal: u.replyRate, fmt: fmtP, lower: false },
                  { label: 'Call Rate', bVal: b.callRate, uVal: u.callRate, fmt: fmtP, lower: false },
                  { label: 'Win Rate', bVal: b.winRate, uVal: u.winRate, fmt: fmtP, lower: false },
                  { label: 'Cost / View', bVal: b.costPerView, uVal: u.costPerView, fmt: fmtD, lower: true },
                  { label: 'Cost / Reply (Lead)', bVal: b.costPerReply, uVal: u.costPerReply, fmt: fmtD, lower: true },
                  { label: 'Cost / Call', bVal: b.costPerCall, uVal: u.costPerCall, fmt: fmtD, lower: true },
                  { label: 'Cost / Win', bVal: b.costPerWin, uVal: u.costPerWin, fmt: fmtD, lower: true },
                ];

                return rows.map(({ label, bVal, uVal, fmt, lower }) => (
                  <tr key={label} className="border-t border-slate-100">
                    <td className="py-2 px-4 font-medium text-slate-900">{label}</td>
                    <td className="py-2 px-4 text-right text-slate-700 font-semibold">{fmt(bVal)}</td>
                    <td className="py-2 px-4 text-right text-slate-700">{fmt(uVal)}</td>
                    <td className={`py-2 px-4 text-right font-semibold ${deltaColor(bVal, uVal, lower)}`}>
                      {deltaFmt(bVal, uVal, fmt)}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Trend Chart (Monthly / Weekly / Daily) */}
      {trendData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">
              {trendGranularity === 'monthly' ? 'Monthly' : trendGranularity === 'weekly' ? 'Weekly' : 'Daily'} Trends
            </h3>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(['monthly', 'weekly', 'daily'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setTrendGranularity(g)}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    trendGranularity === g
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={trendData} margin={{ left: 0, right: 0, top: 0, bottom: trendGranularity === 'monthly' ? 0 : 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: trendGranularity === 'monthly' ? 11 : 10 }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
                angle={trendGranularity === 'monthly' ? 0 : -45}
                textAnchor={trendGranularity === 'monthly' ? 'middle' : 'end'}
                height={trendGranularity === 'monthly' ? 30 : 60}
                interval={trendGranularity === 'daily' ? Math.max(0, Math.floor(trendData.length / 15)) : 0}
              />
              <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 50]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="applications" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={trendGranularity === 'daily' ? 8 : trendGranularity === 'weekly' ? 16 : 24} name="Applications" />
              <Line yAxisId="right" type="monotone" dataKey="viewRate" stroke="#14B8A6" strokeWidth={2} dot={false} name="View %" />
              <Line yAxisId="right" type="monotone" dataKey="replyRate" stroke="#3B82F6" strokeWidth={2} dot={false} name="Reply %" />
              <Line yAxisId="right" type="monotone" dataKey="callRate" stroke="#F59E0B" strokeWidth={2} dot={false} name="Call %" />
              <Line yAxisId="right" type="monotone" dataKey="winRate" stroke="#10B981" strokeWidth={2} dot={false} name="Win %" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stage-to-Stage Conversion Trends */}
      {trendData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Stage-to-Stage Conversions</h3>
          <p className="text-xs text-slate-500 mb-4">How efficiently prospects move between funnel stages</p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={trendData} margin={{ left: 0, right: 0, top: 0, bottom: trendGranularity === 'monthly' ? 0 : 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: trendGranularity === 'monthly' ? 11 : 10 }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
                angle={trendGranularity === 'monthly' ? 0 : -45}
                textAnchor={trendGranularity === 'monthly' ? 'middle' : 'end'}
                height={trendGranularity === 'monthly' ? 30 : 60}
                interval={trendGranularity === 'daily' ? Math.max(0, Math.floor(trendData.length / 15)) : 0}
              />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }}
                formatter={(value) => [`${Number(value).toFixed(1)}%`]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="viewToReply" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="View → Reply" />
              <Line type="monotone" dataKey="replyToCall" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Reply → Call" />
              <Line type="monotone" dataKey="callToWin" stroke="#22C55E" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Call → Win" />
              <Line type="monotone" dataKey="replyToWin" stroke="#8B5CF6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Reply → Win" />
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

      {/* Script Performance by Month (apples-to-apples) */}
      {scriptMonthly.scripts.length > 0 && scriptMonthly.months.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Script Performance by Month</h3>
            <p className="text-xs text-slate-500 mt-0.5">Compare scripts within the same month to control for market conditions</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                  <th className="text-left py-2 px-4 font-semibold sticky left-0 bg-slate-50 z-10">Month</th>
                  {scriptMonthly.scripts.map((script) => (
                    <th key={script} colSpan={3} className="text-center py-2 px-2 font-semibold border-l border-slate-200">{script}</th>
                  ))}
                </tr>
                <tr className="bg-slate-50/50 text-slate-400 text-[10px] uppercase">
                  <th className="sticky left-0 bg-slate-50/50 z-10"></th>
                  {scriptMonthly.scripts.map((script) => (
                    <React.Fragment key={`sub-${script}`}>
                      <th className="py-1 px-1.5 text-center border-l border-slate-200">Apps</th>
                      <th className="py-1 px-1.5 text-center">View%</th>
                      <th className="py-1 px-1.5 text-center">Reply%</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scriptMonthly.months.map((month) => {
                  const monthData = scriptMonthly.data.get(month);
                  // Find best view & reply rates this month for highlighting
                  const cells = scriptMonthly.scripts.map((s) => monthData?.get(s));
                  const viewRates = cells.map((c) => c?.viewRate ?? -1);
                  const replyRates = cells.map((c) => c?.replyRate ?? -1);
                  const bestView = Math.max(...viewRates);
                  const bestReply = Math.max(...replyRates);
                  return (
                    <tr key={month} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="py-2 px-4 font-medium text-slate-900 sticky left-0 bg-white z-10">{month.slice(2)}</td>
                      {scriptMonthly.scripts.map((script, idx) => {
                        const cell = cells[idx];
                        if (!cell) return (
                          <React.Fragment key={`${month}-${script}`}>
                            <td className="py-2 px-1.5 text-center text-slate-300 border-l border-slate-100">&mdash;</td>
                            <td className="py-2 px-1.5 text-center text-slate-300">&mdash;</td>
                            <td className="py-2 px-1.5 text-center text-slate-300">&mdash;</td>
                          </React.Fragment>
                        );
                        return (
                          <React.Fragment key={`${month}-${script}`}>
                            <td className="py-2 px-1.5 text-center text-slate-600 border-l border-slate-100">{cell.count}</td>
                            <td className={`py-2 px-1.5 text-center ${cell.viewRate === bestView && bestView > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>
                              {(cell.viewRate * 100).toFixed(0)}%
                            </td>
                            <td className={`py-2 px-1.5 text-center ${cell.replyRate === bestReply && bestReply > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-900'}`}>
                              {(cell.replyRate * 100).toFixed(0)}%
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
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

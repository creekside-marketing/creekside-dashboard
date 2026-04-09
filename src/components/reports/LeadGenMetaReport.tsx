'use client';

/**
 * LeadGenMetaReport — Lead generation report for Meta Ads clients.
 *
 * Fetches campaign, account, ad, and demographic data from `/api/meta/insights`,
 * normalizes lead actions (lead + offsite_conversion.fb_pixel_lead), and renders
 * KPIs, charts, funnel, breakdowns, insights, and notes.
 *
 * CANNOT: Modify ad account data — read-only display.
 * CANNOT: Handle non-Meta platforms — Meta-specific normalization only.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ReportHeader, {
  DATE_RANGES, DEFAULT_RANGE_INDEX, computePriorPeriod,
  calcChange, fmt, fmtMoney, fmtPct, unwrapPipeboardResponse,
} from './ReportHeader';
import ReportChart from './ReportChart';
import BreakdownTable from './BreakdownTable';
import ReportNotes from './ReportNotes';
import { SparklineKpiCard, FunnelChart, BudgetPacingGauge, InsightsBlock } from './shared';

// ── Types ────────────────────────────────────────────────────────────────

interface ReportingClient {
  id: string; client_name: string; platform: string;
  ad_account_id: string | null; monthly_budget: number | null;
  client_report_notes: string | null;
}

interface LeadGenRow {
  name: string; impressions: number; linkClicks: number; spend: number;
  leads: number; reach: number; frequency: number; cpm: number; cpl: number; lctr: number;
}

interface DailyRow {
  [key: string]: unknown;
  date: string; impressions: number; linkClicks: number; spend: number;
  leads: number; reach: number; frequency: number; cpm: number; cpl: number; lctr: number;
}
type Insight = { type: 'win' | 'concern' | 'action'; text: string };
type MetaAction = { action_type: string; value: string };

// ── Helpers ──────────────────────────────────────────────────────────────

function actionVal(actions: MetaAction[] | undefined, type: string): number {
  if (!actions) return 0;
  const f = actions.find((a) => a.action_type === type);
  return f ? Math.round(Number(f.value) || 0) : 0;
}

function getLeads(actions: MetaAction[] | undefined): number {
  return actionVal(actions, 'lead') + actionVal(actions, 'offsite_conversion.fb_pixel_lead');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(row: any): LeadGenRow {
  const actions = (row.actions ?? []) as MetaAction[];
  const impressions = Number(row.impressions ?? 0);
  const linkClicks = Number(row.inline_link_clicks ?? row.clicks ?? 0);
  const spend = Number(row.spend ?? 0);
  const leads = getLeads(actions);
  const reach = Number(row.reach ?? 0);
  return {
    name: row.campaign_name ?? row.adset_name ?? row.ad_name ?? 'Unknown',
    impressions, linkClicks, spend, leads, reach,
    frequency: reach > 0 ? impressions / reach : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpl: leads > 0 ? spend / leads : 0,
    lctr: impressions > 0 ? linkClicks / impressions : 0,
  };
}

function computeTotals(rows: LeadGenRow[]): Omit<LeadGenRow, 'name'> {
  const s = rows.reduce((a, c) => ({
    impressions: a.impressions + c.impressions, linkClicks: a.linkClicks + c.linkClicks,
    spend: a.spend + c.spend, leads: a.leads + c.leads, reach: a.reach + c.reach,
  }), { impressions: 0, linkClicks: 0, spend: 0, leads: 0, reach: 0 });
  return { ...s, frequency: s.reach > 0 ? s.impressions / s.reach : 0,
    cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0,
    cpl: s.leads > 0 ? s.spend / s.leads : 0,
    lctr: s.impressions > 0 ? s.linkClicks / s.impressions : 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDailyRows(rows: any[]): DailyRow[] {
  return rows.map((row) => {
    const actions = (row.actions ?? []) as MetaAction[];
    const impressions = Number(row.impressions ?? 0);
    const spend = Number(row.spend ?? 0);
    const linkClicks = Number(row.inline_link_clicks ?? row.clicks ?? 0);
    const leads = getLeads(actions);
    const reach = Number(row.reach ?? 0);
    return { date: row.date_start ?? row.date ?? '', impressions, linkClicks, spend, leads, reach,
      frequency: reach > 0 ? impressions / reach : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpl: leads > 0 ? spend / leads : 0, lctr: impressions > 0 ? linkClicks / impressions : 0 };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Compute days elapsed and total days for the selected date range. */
function computePacingDays(rangeIndex: number): { daysElapsed: number; daysInPeriod: number } {
  const today = new Date();
  const label = DATE_RANGES[rangeIndex].label;
  if (label === 'This Month') {
    return { daysElapsed: Math.max(today.getDate() - 1, 1), daysInPeriod: new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() };
  }
  if (label === 'Last Month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    return { daysElapsed: d, daysInPeriod: d };
  }
  const days = label === '7d' ? 7 : label === '14d' ? 14 : 30;
  return { daysElapsed: days, daysInPeriod: days };
}

function buildInsights(t: Omit<LeadGenRow, 'name'>, p: Omit<LeadGenRow, 'name'> | null): Insight[] {
  const out: Insight[] = [];
  if (!p) return out;
  if (p.cpl > 0 && t.cpl < p.cpl)
    out.push({ type: 'win', text: `Cost per lead decreased ${(((p.cpl - t.cpl) / p.cpl) * 100).toFixed(1)}% vs. prior period.` });
  if (p.leads > 0 && t.leads > p.leads)
    out.push({ type: 'win', text: `Lead volume increased ${(((t.leads - p.leads) / p.leads) * 100).toFixed(1)}% vs. prior period.` });
  if (t.frequency > 3.0)
    out.push({ type: 'concern', text: `Frequency is ${t.frequency.toFixed(1)} (above 3.0) — audiences may be experiencing creative fatigue.` });
  const cpmDelta = p.cpm > 0 ? ((t.cpm - p.cpm) / p.cpm) * 100 : 0;
  if (cpmDelta > 20)
    out.push({ type: 'concern', text: `CPM increased ${cpmDelta.toFixed(1)}% vs. prior period — possible audience saturation.` });
  if (t.frequency > 3.0 || cpmDelta > 20)
    out.push({ type: 'action', text: 'Consider refreshing creatives or expanding audience targeting to reduce frequency and CPM pressure.' });
  return out;
}

const COOLDOWN_MS = 5 * 60 * 1000;
const ZERO: Omit<LeadGenRow, 'name'> = { impressions: 0, linkClicks: 0, spend: 0, leads: 0, reach: 0, frequency: 0, cpm: 0, cpl: 0, lctr: 0 };

// ── Component ────────────────────────────────────────────────────────────

export default function LeadGenMetaReport({ client, mode }: { client: ReportingClient; mode: 'internal' | 'public' }) {
  const [campaigns, setCampaigns] = useState<LeadGenRow[]>([]);
  const [totals, setTotals] = useState(ZERO);
  const [priorTotals, setPriorTotals] = useState<Omit<LeadGenRow, 'name'> | null>(null);
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [adsData, setAdsData] = useState<Record<string, unknown>[]>([]);
  const [ageData, setAgeData] = useState<Record<string, unknown>[]>([]);
  const [genderData, setGenderData] = useState<Record<string, unknown>[]>([]);
  const [kpiChanges, setKpiChanges] = useState<Record<string, { pct: string; direction: 'up' | 'down' | 'flat' }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dateRangeIndex, setDateRangeIndex] = useState(DEFAULT_RANGE_INDEX);
  const currentRange = DATE_RANGES[dateRangeIndex];

  const startCooldown = useCallback(() => {
    setCooldownRemaining(COOLDOWN_MS);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1000) { if (cooldownTimer.current) clearInterval(cooldownTimer.current); return 0; }
        return prev - 1000;
      });
    }, 1000);
  }, []);

  const fetchData = useCallback(async () => {
    if (!client.ad_account_id) { setLoading(false); setError('No ad account linked'); return; }
    setLoading(true); setError(null);
    try {
      const aid = encodeURIComponent(client.ad_account_id);
      const tr = DATE_RANGES[dateRangeIndex].metaParam;
      const base = `/api/meta/insights?account_id=${aid}`;
      const periods = computePriorPeriod(dateRangeIndex);
      const [campaignRes, accountRes, priorRes, adRes, ageRes, genderRes] = await Promise.all([
        fetch(`${base}&level=campaign&time_range=${tr}`),
        fetch(`${base}&level=account&time_range=${tr}&time_increment=1`),
        fetch(`${base}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`),
        fetch(`${base}&level=ad&time_range=${tr}`).catch(() => null),
        fetch(`${base}&level=age&time_range=${tr}`).catch(() => null),
        fetch(`${base}&level=gender&time_range=${tr}`).catch(() => null),
      ]);
      if (!campaignRes.ok) { const b = await campaignRes.json().catch(() => ({})); throw new Error(b.error || `HTTP ${campaignRes.status}`); }

      let cj = await campaignRes.json();
      if (!cj || typeof cj !== 'object') throw new Error('Invalid API response');
      cj = unwrapPipeboardResponse(cj);
      const dataArr = Array.isArray(cj.data ?? cj) ? (cj.data ?? cj) : [];
      const norm = (dataArr as unknown[]).map(normalize);
      setCampaigns(norm);
      const t = computeTotals(norm); setTotals(t);

      if (accountRes.ok) {
        try { let aj = await accountRes.json(); aj = unwrapPipeboardResponse(aj);
          const r = aj.data ?? aj ?? []; if (Array.isArray(r)) setDailyData(parseDailyRows(r));
        } catch { /* optional */ }
      }
      if (priorRes.ok) {
        try { let pj = await priorRes.json(); pj = unwrapPipeboardResponse(pj);
          const pa = Array.isArray(pj.data ?? pj) ? (pj.data ?? pj) : [];
          const pt = computeTotals((pa as unknown[]).map(normalize)); setPriorTotals(pt);
          setKpiChanges({ leads: calcChange(t.leads, pt.leads), cpl: calcChange(t.cpl, pt.cpl),
            spend: calcChange(t.spend, pt.spend), cpm: calcChange(t.cpm, pt.cpm),
            frequency: calcChange(t.frequency, pt.frequency), linkClicks: calcChange(t.linkClicks, pt.linkClicks),
            lctr: calcChange(t.lctr, pt.lctr), impressions: calcChange(t.impressions, pt.impressions),
            reach: calcChange(t.reach, pt.reach) });
        } catch { setKpiChanges(null); setPriorTotals(null); }
      }
      const parseBd = async (res: Response | null) => {
        if (!res?.ok) return [];
        try { let j = await res.json(); j = unwrapPipeboardResponse(j);
          return Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
        } catch { return []; }
      };
      setAdsData(await parseBd(adRes)); setAgeData(await parseBd(ageRes)); setGenderData(await parseBd(genderRes));
      setLastRefreshed(new Date()); startCooldown();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to fetch data'); }
    finally { setLoading(false); }
  }, [client.ad_account_id, dateRangeIndex, startCooldown]);

  useEffect(() => { fetchData(); return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeIndex]);

  const handleDateRangeChange = (i: number) => {
    if (i === dateRangeIndex) return;
    setDateRangeIndex(i); setCooldownRemaining(0);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  };

  const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
  const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
  const numCol = (v: unknown) => fmt(Number(v ?? 0));
  const nullMoney = (v: unknown) => { const n = Number(v ?? 0); return n > 0 ? fmtMoney(n) : '--'; };
  const insights = buildInsights(totals, priorTotals);
  const pacing = computePacingDays(dateRangeIndex);
  const showPacing = client.monthly_budget != null && client.monthly_budget > 0;
  const demoMap = (row: Record<string, unknown>) => {
    const actions = (row.actions ?? []) as MetaAction[];
    return { ...row, leads: getLeads(actions) };
  };

  return (
    <div className="space-y-6">
      <ReportHeader clientName={client.client_name} platform={client.platform}
        dateRangeIndex={dateRangeIndex} onDateRangeChange={handleDateRangeChange}
        loading={loading} onRefresh={fetchData} lastRefreshed={lastRefreshed} cooldownRemaining={cooldownRemaining} />

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">
          <p className="font-semibold">Error loading data</p>
          <p className="text-sm mt-1 text-red-600">{error}</p>
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[#2563eb]" />
            <span className="text-sm text-slate-500">Fetching {currentRange.label} data...</span>
          </div>
        </div>
      )}

      {!loading && !error && (<>
        {/* 2. Executive Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <SparklineKpiCard label="Total Leads" value={fmt(totals.leads)} change={kpiChanges?.leads.pct}
            changeDirection={kpiChanges?.leads.direction} changeSentiment="positive-up" size="lg"
            sparklineData={dailyData.map((d) => d.leads)} />
          <SparklineKpiCard label="Cost Per Lead" value={totals.leads > 0 ? fmtMoney(totals.cpl) : '--'}
            change={kpiChanges?.cpl.pct} changeDirection={kpiChanges?.cpl.direction}
            changeSentiment="negative-up" size="lg" sparklineData={dailyData.map((d) => d.cpl)} />
          <SparklineKpiCard label="Total Spend" value={fmtMoney(totals.spend)} change={kpiChanges?.spend.pct}
            changeDirection={kpiChanges?.spend.direction} changeSentiment="neutral" size="lg"
            sparklineData={dailyData.map((d) => d.spend)} />
          <SparklineKpiCard label="CPM" value={fmtMoney(totals.cpm)} change={kpiChanges?.cpm.pct}
            changeDirection={kpiChanges?.cpm.direction} changeSentiment="negative-up" size="lg"
            sparklineData={dailyData.map((d) => d.cpm)} />
          <SparklineKpiCard label="Frequency" value={totals.frequency.toFixed(2)} change={kpiChanges?.frequency.pct}
            changeDirection={kpiChanges?.frequency.direction} changeSentiment="negative-up" size="lg"
            sparklineData={dailyData.map((d) => d.frequency)} target={3.0} />
        </div>

        {/* 3. Secondary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SparklineKpiCard label="Link Clicks" value={fmt(totals.linkClicks)} change={kpiChanges?.linkClicks.pct}
            changeDirection={kpiChanges?.linkClicks.direction} changeSentiment="positive-up" size="sm" />
          <SparklineKpiCard label="LC-CTR" value={fmtPct(totals.lctr)} change={kpiChanges?.lctr.pct}
            changeDirection={kpiChanges?.lctr.direction} changeSentiment="positive-up" size="sm" />
          <SparklineKpiCard label="Impressions" value={fmt(totals.impressions)} change={kpiChanges?.impressions.pct}
            changeDirection={kpiChanges?.impressions.direction} changeSentiment="positive-up" size="sm" />
          <SparklineKpiCard label="Reach" value={fmt(totals.reach)} change={kpiChanges?.reach.pct}
            changeDirection={kpiChanges?.reach.direction} changeSentiment="positive-up" size="sm" />
        </div>

        {/* 4. Budget Pacing */}
        {showPacing && <BudgetPacingGauge spent={totals.spend} budget={client.monthly_budget!}
          daysElapsed={pacing.daysElapsed} daysInPeriod={pacing.daysInPeriod} />}

        {/* 5-6. Charts */}
        {dailyData.length > 0 && (<>
          <ReportChart title="Lead Volume & Cost Trend" data={dailyData} xKey="date"
            lines={[
              { dataKey: 'leads', label: 'Leads', color: '#10B981', type: 'bar', yAxisId: 'left' },
              { dataKey: 'cpl', label: 'CPL', color: '#8B5CF6', yAxisId: 'right' },
            ]} formatY={(v) => v.toFixed(0)} formatYRight={(v) => `$${v.toFixed(0)}`} />
          <ReportChart title="Spend & Frequency" data={dailyData} xKey="date"
            lines={[
              { dataKey: 'spend', label: 'Spend', color: '#3B82F6', type: 'bar', yAxisId: 'left' },
              { dataKey: 'frequency', label: 'Frequency', color: '#F59E0B', yAxisId: 'right' },
            ]} formatY={(v) => `$${v.toLocaleString()}`} formatYRight={(v) => v.toFixed(1)} />
        </>)}

        {/* 7. Conversion Funnel */}
        <FunnelChart title="Conversion Funnel" stages={[
          { label: 'Impressions', value: totals.impressions },
          { label: 'Link Clicks', value: totals.linkClicks },
          { label: 'Leads', value: totals.leads },
        ]} />

        {/* 8. Campaign Performance */}
        <BreakdownTable title="Campaign Performance" data={campaigns} maxRows={15} columns={[
          { key: 'name', label: 'Campaign' },
          { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
          { key: 'linkClicks', label: 'Clicks', align: 'right', format: numCol },
          { key: 'lctr', label: 'LC-CTR', align: 'right', format: pctCol },
          { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
          { key: 'leads', label: 'Leads', align: 'right', format: numCol },
          { key: 'cpl', label: 'CPL', align: 'right', format: nullMoney },
          { key: 'cpm', label: 'CPM', align: 'right', format: moneyCol },
          { key: 'frequency', label: 'Freq.', align: 'right', format: (v: unknown) => Number(v ?? 0).toFixed(2) },
        ]} />

        {/* 9. Ads Overview */}
        {adsData.length > 0 && (
          <BreakdownTable title="Ads Overview" maxRows={15} columns={[
            { key: 'ad_name', label: 'Ad' },
            { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
            { key: 'inline_link_clicks', label: 'Clicks', align: 'right', format: numCol },
            { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
            { key: 'leads', label: 'Leads', align: 'right', format: numCol },
            { key: 'cpl', label: 'CPL', align: 'right', format: nullMoney },
          ]} data={adsData.map((row) => {
            const r = row as Record<string, unknown>;
            const leads = getLeads((r.actions ?? []) as MetaAction[]);
            const spend = Number(r.spend ?? 0);
            return { ...row, ad_name: r.ad_name ?? r.name ?? 'Unknown Ad', leads, cpl: leads > 0 ? spend / leads : 0 };
          })} />
        )}

        {/* 10. Demographics */}
        {(ageData.length > 0 || genderData.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {ageData.length > 0 && <BreakdownTable title="Age Overview" columns={[
              { key: 'age', label: 'Age' }, { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
              { key: 'inline_link_clicks', label: 'Clicks', align: 'right', format: numCol },
              { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
              { key: 'leads', label: 'Leads', align: 'right', format: numCol },
            ]} data={ageData.map(demoMap)} />}
            {genderData.length > 0 && <BreakdownTable title="Gender Overview" columns={[
              { key: 'gender', label: 'Gender' }, { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
              { key: 'inline_link_clicks', label: 'Clicks', align: 'right', format: numCol },
              { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
              { key: 'leads', label: 'Leads', align: 'right', format: numCol },
            ]} data={genderData.map(demoMap)} />}
          </div>
        )}

        {/* 11. Insights */}
        <InsightsBlock insights={insights} />
      </>)}

      {/* 12. Notes */}
      <ReportNotes clientId={client.id} initialNotes={client.client_report_notes ?? ''} mode={mode} />
    </div>
  );
}

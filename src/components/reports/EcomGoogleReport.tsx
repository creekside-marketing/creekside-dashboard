'use client';

/**
 * EcomGoogleReport — Ecommerce-focused Google Ads report.
 *
 * Fetches campaign, account-level daily, keyword, geo, age, and gender data
 * from `/api/google/insights` and renders ecom KPIs (Revenue, ROAS, AOV,
 * Cost Per Purchase) alongside charts, funnel, and breakdown tables.
 *
 * CANNOT: Modify ad account settings or budgets.
 * CANNOT: Fetch from any endpoint other than `/api/google/insights`.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ReportHeader, { DATE_RANGES, DEFAULT_RANGE_INDEX, computePriorPeriod, calcChange, fmt, fmtMoney, fmtPct } from './ReportHeader';
import ReportChart from './ReportChart';
import BreakdownTable from './BreakdownTable';
import ReportNotes from './ReportNotes';
import { SparklineKpiCard, FunnelChart, BudgetPacingGauge, InsightsBlock } from './shared';

// ── Types ────────────────────────────────────────────────────────────────

interface ReportingClient {
  id: string; client_name: string; platform: string;
  ad_account_id: string | null; monthly_budget: number | null; client_report_notes: string | null;
}

interface EcomCampaign {
  name: string; status: string; type?: string;
  impressions: number; clicks: number; ctr: number; cpc: number; cost: number;
  conversions: number; conversionValue: number; roas: number; cpa: number; aov: number;
}

interface EcomTotals {
  impressions: number; clicks: number; ctr: number; cpc: number; cost: number;
  conversions: number; conversionValue: number; roas: number; cpa: number; aov: number;
}

interface DailyRow {
  [key: string]: unknown;
  date: string; impressions: number; clicks: number; cost: number;
  conversions: number; conversionValue: number; roas: number; cpa: number; aov: number;
}

type KpiChange = { pct: string; direction: 'up' | 'down' | 'flat' };

// ── Normalize ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEcomGoogleCampaign(row: any): EcomCampaign {
  const impressions = Number(row.impressions ?? 0), clicks = Number(row.clicks ?? 0);
  const cost = Number(row.cost ?? 0), conversions = Number(row.conversions ?? 0);
  const conversionValue = Number(row.conversion_value ?? row.conversions_value ?? 0);
  return {
    name: row.campaign_name ?? 'Unknown Campaign', status: row.status ?? 'unknown',
    type: row.channel_type ?? undefined, impressions, clicks, cost, conversions, conversionValue,
    roas: cost > 0 ? conversionValue / cost : 0, cpa: conversions > 0 ? cost / conversions : 0,
    aov: conversions > 0 ? conversionValue / conversions : 0,
    ctr: impressions > 0 ? clicks / impressions : 0, cpc: clicks > 0 ? cost / clicks : 0,
  };
}

function computeTotals(campaigns: EcomCampaign[]): EcomTotals {
  const t = campaigns.reduce((a, c) => ({
    impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks,
    cost: a.cost + c.cost, conversions: a.conversions + c.conversions,
    conversionValue: a.conversionValue + c.conversionValue,
    ctr: 0, cpc: 0, roas: 0, cpa: 0, aov: 0,
  }), { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0, ctr: 0, cpc: 0, roas: 0, cpa: 0, aov: 0 });
  t.ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
  t.cpc = t.clicks > 0 ? t.cost / t.clicks : 0;
  t.roas = t.cost > 0 ? t.conversionValue / t.cost : 0;
  t.cpa = t.conversions > 0 ? t.cost / t.conversions : 0;
  t.aov = t.conversions > 0 ? t.conversionValue / t.conversions : 0;
  return t;
}

// ── Insights generator ───────────────────────────────────────────────────

function generateInsights(t: EcomTotals, pt: EcomTotals | null, campaigns: EcomCampaign[]) {
  const out: { type: 'win' | 'concern' | 'action'; text: string }[] = [];
  if (t.roas >= 4) out.push({ type: 'win', text: `Overall ROAS of ${t.roas.toFixed(2)}x exceeds the 4.0x target.` });
  else if (t.roas > 0 && t.roas < 1) out.push({ type: 'concern', text: `Overall ROAS is ${t.roas.toFixed(2)}x — spending more than earning.` });
  if (pt && pt.conversionValue > 0) {
    const d = ((t.conversionValue - pt.conversionValue) / pt.conversionValue) * 100;
    if (d > 5) out.push({ type: 'win', text: `Revenue up ${d.toFixed(1)}% vs. prior period.` });
  }
  if (pt && pt.cpc > 0) {
    const d = ((t.cpc - pt.cpc) / pt.cpc) * 100;
    if (d > 15) out.push({ type: 'concern', text: `CPC increased ${d.toFixed(1)}% vs. prior period — monitor auction competitiveness.` });
  }
  const bad = campaigns.filter((c) => c.cost > 0 && c.roas < 1);
  if (bad.length > 0) out.push({ type: 'concern', text: `${bad.length} campaign(s) with ROAS < 1x: ${bad.slice(0, 3).map((c) => c.name).join(', ')}.` });
  out.push({ type: 'action', text: 'Review keyword expansion opportunities and Shopping feed optimization for top-performing product categories.' });
  return out;
}

function getPacingDays(label: string) {
  const now = new Date();
  if (label === 'This Month') return { elapsed: Math.max(now.getDate() - 1, 1), total: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() };
  if (label === 'Last Month') { const d = new Date(now.getFullYear(), now.getMonth(), 0).getDate(); return { elapsed: d, total: d }; }
  const days = label === '7d' ? 7 : label === '14d' ? 14 : 30;
  return { elapsed: days, total: days };
}

const COOLDOWN_MS = 5 * 60 * 1000;
const ZERO: EcomTotals = { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0, conversionValue: 0, roas: 0, cpa: 0, aov: 0 };

// ── Formatters ───────────────────────────────────────────────────────────

const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
const numCol = (v: unknown) => fmt(Number(v ?? 0));
const roasCol = (v: unknown) => `${Number(v ?? 0).toFixed(2)}x`;

// ── Component ────────────────────────────────────────────────────────────

export default function EcomGoogleReport({ client, mode }: { client: ReportingClient; mode: 'internal' | 'public' }) {
  const [campaigns, setCampaigns] = useState<EcomCampaign[]>([]);
  const [totals, setTotals] = useState<EcomTotals>(ZERO);
  const [priorTotals, setPriorTotals] = useState<EcomTotals | null>(null);
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [keywords, setKeywords] = useState<Record<string, unknown>[]>([]);
  const [geoData, setGeoData] = useState<Record<string, unknown>[]>([]);
  const [ageData, setAgeData] = useState<Record<string, unknown>[]>([]);
  const [genderData, setGenderData] = useState<Record<string, unknown>[]>([]);
  const [kpi, setKpi] = useState<Record<string, KpiChange> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [drIdx, setDrIdx] = useState(DEFAULT_RANGE_INDEX);

  const range = DATE_RANGES[drIdx];

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_MS);
    if (cdRef.current) clearInterval(cdRef.current);
    cdRef.current = setInterval(() => {
      setCooldown((p) => { if (p <= 1000) { if (cdRef.current) clearInterval(cdRef.current); return 0; } return p - 1000; });
    }, 1000);
  }, []);

  const fetchData = useCallback(async () => {
    if (!client.ad_account_id) { setLoading(false); setError('No ad account linked'); return; }
    setLoading(true); setError(null);
    try {
      const cid = encodeURIComponent(client.ad_account_id), dr = DATE_RANGES[drIdx].googleParam;
      const base = `/api/google/insights?customer_id=${cid}`;
      const periods = computePriorPeriod(drIdx);
      const urls = {
        campaign: `${base}&level=campaign&date_range=${dr}`,
        account: `${base}&level=account&date_range=${dr}`,
        prior: `${base}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`,
        keyword: `${base}&level=keyword&date_range=${dr}`,
        geo: `${base}&level=geo&date_range=${dr}`,
        age: `${base}&level=age&date_range=${dr}`,
        gender: `${base}&level=gender&date_range=${dr}`,
      };
      const [cRes, aRes, pRes, kwRes, geoRes, ageRes, genRes] = await Promise.all([
        fetch(urls.campaign), fetch(urls.account), fetch(urls.prior),
        fetch(urls.keyword).catch(() => null), fetch(urls.geo).catch(() => null),
        fetch(urls.age).catch(() => null), fetch(urls.gender).catch(() => null),
      ]);
      if (!cRes.ok) { const b = await cRes.json().catch(() => ({})); throw new Error(b.error || `HTTP ${cRes.status}`); }

      const cJson = await cRes.json();
      if (!cJson || typeof cJson !== 'object') throw new Error('Invalid API response');
      const raw = Array.isArray(cJson.data ?? cJson) ? (cJson.data ?? cJson) : [];
      const norm = raw.map(normalizeEcomGoogleCampaign);
      setCampaigns(norm);
      const t = computeTotals(norm);
      setTotals(t);

      // Daily data
      if (aRes.ok) {
        try {
          const rows = (await aRes.json()).data ?? [];
          if (Array.isArray(rows)) {
            setDailyData(rows.map((r: Record<string, unknown>) => {
              const c = Number(r.cost ?? 0), cv = Number(r.conversions ?? 0);
              const v = Number(r.conversion_value ?? r.conversions_value ?? 0);
              return { date: String(r.date ?? ''), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), cost: c, conversions: cv, conversionValue: v, roas: c > 0 ? v / c : 0, cpa: cv > 0 ? c / cv : 0, aov: cv > 0 ? v / cv : 0 };
            }).sort((a, b) => a.date.localeCompare(b.date)));
          }
        } catch { /* optional */ }
      }

      // Prior period
      if (pRes.ok) {
        try {
          const pr = (await pRes.json()).data ?? [];
          const pt = computeTotals((Array.isArray(pr) ? pr : []).map(normalizeEcomGoogleCampaign));
          setPriorTotals(pt);
          setKpi({ conversionValue: calcChange(t.conversionValue, pt.conversionValue), roas: calcChange(t.roas, pt.roas), cost: calcChange(t.cost, pt.cost), cpa: calcChange(t.cpa, pt.cpa), aov: calcChange(t.aov, pt.aov), conversions: calcChange(t.conversions, pt.conversions), ctr: calcChange(t.ctr, pt.ctr), cpc: calcChange(t.cpc, pt.cpc), impressions: calcChange(t.impressions, pt.impressions) });
        } catch { setKpi(null); }
      }

      // Breakdowns
      const parse = async (r: Response | null) => { if (!r?.ok) return []; try { const j = await r.json(); return Array.isArray(j.data) ? j.data : []; } catch { return []; } };
      setKeywords(await parse(kwRes)); setGeoData(await parse(geoRes));
      setAgeData(await parse(ageRes)); setGenderData(await parse(genRes));
      setLastRefreshed(new Date()); startCooldown();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to fetch data'); }
    finally { setLoading(false); }
  }, [client.ad_account_id, drIdx, startCooldown]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); return () => { if (cdRef.current) clearInterval(cdRef.current); }; }, [drIdx]);

  const onRangeChange = (i: number) => { if (i === drIdx) return; setDrIdx(i); setCooldown(0); if (cdRef.current) clearInterval(cdRef.current); };
  const pacing = getPacingDays(range.label);
  const insights = generateInsights(totals, priorTotals, campaigns);
  return (
    <div className="space-y-6">
      <ReportHeader clientName={client.client_name} platform={client.platform} dateRangeIndex={drIdx} onDateRangeChange={onRangeChange} loading={loading} onRefresh={fetchData} lastRefreshed={lastRefreshed} cooldownRemaining={cooldown} />

      {error && (<div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200"><p className="font-semibold">Error loading data</p><p className="text-sm mt-1 text-red-600">{error}</p></div>)}

      {loading && (<div className="flex items-center justify-center py-16"><div className="flex flex-col items-center gap-3"><div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[#2563eb]" /><span className="text-sm text-slate-500">Fetching {range.label} data...</span></div></div>)}

      {!loading && !error && (<>
        {/* ── Executive Summary KPIs ──────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <SparklineKpiCard label="Revenue" value={fmtMoney(totals.conversionValue)} change={kpi?.conversionValue.pct} changeDirection={kpi?.conversionValue.direction} changeSentiment="positive-up" size="lg" sparklineData={dailyData.map((d) => d.conversionValue)} />
          <SparklineKpiCard label="ROAS" value={totals.roas > 0 ? `${totals.roas.toFixed(2)}x` : '--'} change={kpi?.roas.pct} changeDirection={kpi?.roas.direction} changeSentiment="positive-up" size="lg" sparklineData={dailyData.map((d) => d.roas)} target={4.0} />
          <SparklineKpiCard label="Total Spend" value={fmtMoney(totals.cost)} change={kpi?.cost.pct} changeDirection={kpi?.cost.direction} changeSentiment="neutral" size="lg" sparklineData={dailyData.map((d) => d.cost)} />
          <SparklineKpiCard label="Cost / Purchase" value={totals.conversions > 0 ? fmtMoney(totals.cpa) : '--'} change={kpi?.cpa.pct} changeDirection={kpi?.cpa.direction} changeSentiment="negative-up" size="lg" sparklineData={dailyData.map((d) => d.cpa)} />
          <SparklineKpiCard label="AOV" value={totals.conversions > 0 ? fmtMoney(totals.aov) : '--'} change={kpi?.aov.pct} changeDirection={kpi?.aov.direction} changeSentiment="positive-up" size="lg" sparklineData={dailyData.map((d) => d.aov)} />
        </div>

        {/* ── Secondary KPIs ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SparklineKpiCard label="Purchases" value={fmt(totals.conversions)} change={kpi?.conversions.pct} changeDirection={kpi?.conversions.direction} changeSentiment="positive-up" size="sm" />
          <SparklineKpiCard label="CTR" value={fmtPct(totals.ctr)} change={kpi?.ctr.pct} changeDirection={kpi?.ctr.direction} changeSentiment="positive-up" size="sm" />
          <SparklineKpiCard label="Avg. CPC" value={fmtMoney(totals.cpc)} change={kpi?.cpc.pct} changeDirection={kpi?.cpc.direction} changeSentiment="negative-up" size="sm" />
          <SparklineKpiCard label="Impressions" value={fmt(totals.impressions)} change={kpi?.impressions.pct} changeDirection={kpi?.impressions.direction} changeSentiment="positive-up" size="sm" />
        </div>

        {/* ── Budget Pacing ───────────────────────────────────────────── */}
        {client.monthly_budget && client.monthly_budget > 0 && (
          <BudgetPacingGauge spent={totals.cost} budget={client.monthly_budget} daysElapsed={pacing.elapsed} daysInPeriod={pacing.total} />
        )}

        {/* ── Revenue vs Spend Chart ──────────────────────────────────── */}
        {dailyData.length > 0 && (<>
          <ReportChart title="Revenue vs Spend" data={dailyData} xKey="date" lines={[{ dataKey: 'cost', label: 'Spend', color: '#3B82F6', type: 'bar', yAxisId: 'left' }, { dataKey: 'conversionValue', label: 'Revenue', color: '#10B981', yAxisId: 'right' }]} formatY={(v) => `$${v.toLocaleString()}`} formatYRight={(v) => `$${v.toLocaleString()}`} />
          <ReportChart title="ROAS Trend (target: 4.0x)" data={dailyData} xKey="date" lines={[{ dataKey: 'roas', label: 'ROAS', color: '#8B5CF6' }]} formatY={(v) => `${v.toFixed(1)}x`} height={250} />
        </>)}

        {/* ── Conversion Funnel ───────────────────────────────────────── */}
        <FunnelChart title="Conversion Funnel" stages={[{ label: 'Impressions', value: totals.impressions }, { label: 'Clicks', value: totals.clicks }, { label: 'Purchases', value: totals.conversions }]} />

        {/* ── Campaign Performance Table ──────────────────────────────── */}
        {campaigns.length > 0 && (
          <BreakdownTable title="Campaign Performance" data={campaigns} columns={[
            { key: 'name', label: 'Campaign' }, { key: 'type', label: 'Type' },
            { key: 'impressions', label: 'Impr.', align: 'right', format: numCol }, { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
            { key: 'ctr', label: 'CTR', align: 'right', format: pctCol }, { key: 'cost', label: 'Spend', align: 'right', format: moneyCol },
            { key: 'conversionValue', label: 'Revenue', align: 'right', format: moneyCol }, { key: 'roas', label: 'ROAS', align: 'right', format: roasCol },
            { key: 'cpa', label: 'CPA', align: 'right', format: moneyCol }, { key: 'aov', label: 'AOV', align: 'right', format: moneyCol },
          ]} />
        )}

        {/* ── Top Keywords ────────────────────────────────────────────── */}
        {keywords.length > 0 && (
          <BreakdownTable title="Top Keywords" data={keywords} columns={[
            { key: 'keyword', label: 'Keyword' }, { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
            { key: 'clicks', label: 'Clicks', align: 'right', format: numCol }, { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
            { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol }, { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
            { key: 'conversions', label: 'Purchases', align: 'right', format: numCol }, { key: 'conversion_value', label: 'Revenue', align: 'right', format: moneyCol },
            { key: 'roas', label: 'ROAS', align: 'right', format: roasCol },
          ]} />
        )}

        {/* ── Demographics (2-col grid) ───────────────────────────────── */}
        {(ageData.length > 0 || genderData.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ageData.length > 0 && <BreakdownTable title="Age Breakdown" data={ageData} columns={[
              { key: 'age_range', label: 'Age' }, { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
              { key: 'clicks', label: 'Clicks', align: 'right', format: numCol }, { key: 'cost', label: 'Spend', align: 'right', format: moneyCol },
              { key: 'conversion_value', label: 'Revenue', align: 'right', format: moneyCol }, { key: 'conversions', label: 'Purchases', align: 'right', format: numCol },
            ]} />}
            {genderData.length > 0 && <BreakdownTable title="Gender Breakdown" data={genderData} columns={[
              { key: 'gender', label: 'Gender' }, { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
              { key: 'clicks', label: 'Clicks', align: 'right', format: numCol }, { key: 'cost', label: 'Spend', align: 'right', format: moneyCol },
              { key: 'conversion_value', label: 'Revenue', align: 'right', format: moneyCol }, { key: 'conversions', label: 'Purchases', align: 'right', format: numCol },
            ]} />}
          </div>
        )}

        {/* ── Location ────────────────────────────────────────────────── */}
        {geoData.length > 0 && (
          <BreakdownTable title="Location Breakdown" data={geoData} columns={[
            { key: 'city', label: 'City' }, { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
            { key: 'clicks', label: 'Clicks', align: 'right', format: numCol }, { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
            { key: 'cost', label: 'Spend', align: 'right', format: moneyCol }, { key: 'conversion_value', label: 'Revenue', align: 'right', format: moneyCol },
            { key: 'conversions', label: 'Purchases', align: 'right', format: numCol }, { key: 'roas', label: 'ROAS', align: 'right', format: roasCol },
          ]} />
        )}

        {/* ── Insights ────────────────────────────────────────────────── */}
        <InsightsBlock insights={insights} />
      </>)}

      {/* ── Notes ───────────────────────────────────────────────────────── */}
      <ReportNotes clientId={client.id} initialNotes={client.client_report_notes ?? ''} mode={mode} />
    </div>
  );
}

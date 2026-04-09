'use client';

/**
 * EcomMetaReport — Upgraded ecommerce Meta Ads report with sparklines, funnel,
 * budget pacing, and auto-generated insights.
 *
 * CANNOT: Write data (read-only report view).
 * CANNOT: Modify budgets or campaigns.
 * CANNOT: Exceed ~450 lines — delegates rendering to shared components.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ReportHeader, {
  DATE_RANGES,
  DEFAULT_RANGE_INDEX,
  computePriorPeriod,
  calcChange,
  fmt,
  fmtMoney,
  fmtPct,
  unwrapPipeboardResponse,
} from './ReportHeader';
import ReportChart from './ReportChart';
import BreakdownTable from './BreakdownTable';
import ReportNotes from './ReportNotes';
import {
  SparklineKpiCard,
  FunnelChart,
  BudgetPacingGauge,
  InsightsBlock,
} from './shared';

// ── Types ────────────────────────────────────────────────────────────────

interface ReportingClient {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  monthly_budget: number | null;
  client_report_notes: string | null;
}

interface EcomTotals {
  impressions: number;
  linkClicks: number;
  lctr: number;
  spend: number;
  atc: number;
  checkouts: number;
  purchases: number;
  purchaseRevenue: number;
  roas: number;
  cpci: number;
  cpp: number;
  cpm: number;
}

interface EcomCampaign {
  name: string;
  impressions: number;
  linkClicks: number;
  lctr: number;
  spend: number;
  atc: number;
  cpa2c: number;
  checkouts: number;
  cpci: number;
  purchases: number;
  purchaseRevenue: number;
  roas: number;
  cpp: number;
}

interface DailyRow {
  [key: string]: unknown;
  date: string;
  atc: number;
  checkouts: number;
  purchases: number;
  purchaseRevenue: number;
  roas: number;
  spend: number;
  impressions: number;
  linkClicks: number;
  cpp: number;
  cpm: number;
}

type ChangeMap = Record<string, { pct: string; direction: 'up' | 'down' | 'flat' }>;

// ── Meta action helpers ──────────────────────────────────────────────────

function getActionValue(actions: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!actions) return 0;
  const found = actions.find((a) => a.action_type === type);
  return found ? Math.round(Number(found.value) || 0) : 0;
}

function getActionRevenue(actionValues: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!actionValues) return 0;
  const found = actionValues.find((a) => a.action_type === type);
  return found ? Number(found.value) || 0 : 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEcomCampaign(row: any): EcomCampaign {
  const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
  const actionValues = (row.action_values ?? []) as Array<{ action_type: string; value: string }>;
  const linkClicks = Number(row.inline_link_clicks ?? row.clicks ?? 0);
  const impressions = Number(row.impressions ?? 0);
  const spend = Number(row.spend ?? 0);
  const atc = getActionValue(actions, 'offsite_conversion.fb_pixel_add_to_cart');
  const checkouts = getActionValue(actions, 'offsite_conversion.fb_pixel_initiate_checkout');
  const purchases = getActionValue(actions, 'offsite_conversion.fb_pixel_purchase');
  const purchaseRevenue = getActionRevenue(actionValues, 'offsite_conversion.fb_pixel_purchase');

  return {
    name: row.adset_name ?? row.campaign_name ?? row.ad_name ?? 'Unknown',
    impressions,
    linkClicks,
    lctr: impressions > 0 ? linkClicks / impressions : 0,
    spend,
    atc,
    cpa2c: atc > 0 ? spend / atc : 0,
    checkouts,
    cpci: checkouts > 0 ? spend / checkouts : 0,
    purchases,
    purchaseRevenue,
    roas: spend > 0 ? purchaseRevenue / spend : 0,
    cpp: purchases > 0 ? spend / purchases : 0,
  };
}

function computeTotals(campaigns: EcomCampaign[]): EcomTotals {
  const t = campaigns.reduce(
    (acc, c) => ({
      impressions: acc.impressions + c.impressions,
      linkClicks: acc.linkClicks + c.linkClicks,
      spend: acc.spend + c.spend,
      atc: acc.atc + c.atc,
      checkouts: acc.checkouts + c.checkouts,
      purchases: acc.purchases + c.purchases,
      purchaseRevenue: acc.purchaseRevenue + c.purchaseRevenue,
    }),
    { impressions: 0, linkClicks: 0, spend: 0, atc: 0, checkouts: 0, purchases: 0, purchaseRevenue: 0 }
  );
  return {
    ...t,
    roas: t.spend > 0 ? t.purchaseRevenue / t.spend : 0,
    lctr: t.impressions > 0 ? t.linkClicks / t.impressions : 0,
    cpci: t.checkouts > 0 ? t.spend / t.checkouts : 0,
    cpp: t.purchases > 0 ? t.spend / t.purchases : 0,
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDailyRows(rows: any[]): DailyRow[] {
  return rows
    .map((row) => {
      const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
      const actionValues = (row.action_values ?? []) as Array<{ action_type: string; value: string }>;
      const spend = Number(row.spend ?? 0);
      const impressions = Number(row.impressions ?? 0);
      const purchases = getActionValue(actions, 'offsite_conversion.fb_pixel_purchase');
      const purchaseRevenue = getActionRevenue(actionValues, 'offsite_conversion.fb_pixel_purchase');
      return {
        date: row.date_start ?? row.date ?? '',
        atc: getActionValue(actions, 'offsite_conversion.fb_pixel_add_to_cart'),
        checkouts: getActionValue(actions, 'offsite_conversion.fb_pixel_initiate_checkout'),
        purchases,
        purchaseRevenue,
        roas: spend > 0 ? purchaseRevenue / spend : 0,
        spend,
        impressions,
        linkClicks: Number(row.inline_link_clicks ?? row.clicks ?? 0),
        cpp: purchases > 0 ? spend / purchases : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Compute days elapsed and total days for the selected date range. */
function computePacingDays(rangeIndex: number): { daysElapsed: number; daysInPeriod: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const label = DATE_RANGES[rangeIndex].label;

  if (label === 'This Month') {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const elapsed = Math.max(Math.floor((today.getTime() - monthStart.getTime()) / 86400000), 1);
    return { daysElapsed: elapsed, daysInPeriod: monthEnd.getDate() };
  }
  if (label === 'Last Month') {
    const monthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    return { daysElapsed: monthEnd.getDate(), daysInPeriod: monthEnd.getDate() };
  }
  const days = label === '7d' ? 7 : label === '14d' ? 14 : 30;
  return { daysElapsed: days, daysInPeriod: days };
}

/** Build auto-generated insights from current/prior totals. */
function buildInsights(
  t: EcomTotals,
  prior: EcomTotals | null,
  campaigns: EcomCampaign[],
): Array<{ type: 'win' | 'concern' | 'action'; text: string }> {
  const insights: Array<{ type: 'win' | 'concern' | 'action'; text: string }> = [];

  if (prior && prior.cpp > 0 && t.cpp < prior.cpp) {
    const drop = (((prior.cpp - t.cpp) / prior.cpp) * 100).toFixed(1);
    insights.push({ type: 'win', text: `Cost per purchase decreased ${drop}% vs. prior period (${fmtMoney(t.cpp)} vs. ${fmtMoney(prior.cpp)}).` });
  }
  if (prior && prior.roas > 0 && t.roas > prior.roas) {
    const gain = (((t.roas - prior.roas) / prior.roas) * 100).toFixed(1);
    insights.push({ type: 'win', text: `ROAS improved ${gain}% vs. prior period (${t.roas.toFixed(2)}x vs. ${prior.roas.toFixed(2)}x).` });
  }
  if (prior && prior.purchases > 0 && t.purchases > prior.purchases) {
    const gain = (((t.purchases - prior.purchases) / prior.purchases) * 100).toFixed(1);
    insights.push({ type: 'win', text: `Purchases increased ${gain}% vs. prior period (${fmt(t.purchases)} vs. ${fmt(prior.purchases)}).` });
  }
  if (prior && prior.cpm > 0) {
    const cpmChange = ((t.cpm - prior.cpm) / prior.cpm) * 100;
    if (cpmChange > 20) {
      insights.push({ type: 'concern', text: `CPM rose ${cpmChange.toFixed(1)}% vs. prior period — possible audience saturation or increased competition.` });
    }
  }

  const zeroPurchaseCampaigns = campaigns.filter((c) => c.spend > 50 && c.purchases === 0);
  if (zeroPurchaseCampaigns.length > 0) {
    const names = zeroPurchaseCampaigns.slice(0, 3).map((c) => c.name).join(', ');
    insights.push({ type: 'concern', text: `${zeroPurchaseCampaigns.length} campaign(s) with spend but zero purchases: ${names}.` });
  }

  insights.push({ type: 'action', text: 'Consider testing new creative variations or expanding audience targeting to maintain efficiency at scale.' });

  return insights;
}

const COOLDOWN_MS = 5 * 60 * 1000;

// ── Component ────────────────────────────────────────────────────────────

export default function EcomMetaReport({
  client,
  mode,
}: {
  client: ReportingClient;
  mode: 'internal' | 'public';
}) {
  const [campaigns, setCampaigns] = useState<EcomCampaign[]>([]);
  const [totals, setTotals] = useState<EcomTotals>({ impressions: 0, linkClicks: 0, lctr: 0, spend: 0, atc: 0, checkouts: 0, purchases: 0, purchaseRevenue: 0, roas: 0, cpci: 0, cpp: 0, cpm: 0 });
  const [priorTotals, setPriorTotals] = useState<EcomTotals | null>(null);
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [adsData, setAdsData] = useState<Record<string, unknown>[]>([]);
  const [ageData, setAgeData] = useState<Record<string, unknown>[]>([]);
  const [genderData, setGenderData] = useState<Record<string, unknown>[]>([]);
  const [kpiChanges, setKpiChanges] = useState<ChangeMap | null>(null);
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
        if (prev <= 1000) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
  }, []);

  const fetchData = useCallback(async () => {
    if (!client.ad_account_id) {
      setLoading(false);
      setError('No ad account linked');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const range = DATE_RANGES[dateRangeIndex];
      const aid = encodeURIComponent(client.ad_account_id);
      const tr = range.metaParam;

      const campaignUrl = `/api/meta/insights?account_id=${aid}&level=campaign&time_range=${tr}`;
      const accountUrl = `/api/meta/insights?account_id=${aid}&level=account&time_range=${tr}`;
      const adUrl = `/api/meta/insights?account_id=${aid}&level=ad&time_range=${tr}`;
      const ageUrl = `/api/meta/insights?account_id=${aid}&level=age&time_range=${tr}`;
      const genderUrl = `/api/meta/insights?account_id=${aid}&level=gender&time_range=${tr}`;

      const periods = computePriorPeriod(dateRangeIndex);
      const priorCampaignUrl = `/api/meta/insights?account_id=${aid}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`;

      const [campaignRes, accountRes, priorRes, adRes, ageRes, genderRes] = await Promise.all([
        fetch(campaignUrl),
        fetch(accountUrl),
        fetch(priorCampaignUrl),
        fetch(adUrl).catch(() => null),
        fetch(ageUrl).catch(() => null),
        fetch(genderUrl).catch(() => null),
      ]);

      if (!campaignRes.ok) {
        const body = await campaignRes.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${campaignRes.status}`);
      }

      // Parse campaigns
      let campaignJson = await campaignRes.json();
      campaignJson = unwrapPipeboardResponse(campaignJson);
      const rawData = campaignJson.data ?? campaignJson ?? [];
      const dataArr = Array.isArray(rawData) ? rawData : [];
      const normalized = dataArr.map(normalizeEcomCampaign);
      setCampaigns(normalized);

      const t = computeTotals(normalized);
      setTotals(t);

      // Parse daily data
      if (accountRes.ok) {
        try {
          let accountJson = await accountRes.json();
          accountJson = unwrapPipeboardResponse(accountJson);
          const rows = accountJson.data ?? accountJson ?? [];
          if (Array.isArray(rows)) setDailyData(parseDailyRows(rows));
        } catch { /* optional */ }
      }

      // Parse prior period
      if (priorRes.ok) {
        try {
          let priorJson = await priorRes.json();
          priorJson = unwrapPipeboardResponse(priorJson);
          const priorRaw = priorJson.data ?? priorJson ?? [];
          const priorArr = Array.isArray(priorRaw) ? priorRaw : [];
          const priorNorm = priorArr.map(normalizeEcomCampaign);
          const pt = computeTotals(priorNorm);
          setPriorTotals(pt);

          setKpiChanges({
            purchases: calcChange(t.purchases, pt.purchases),
            cpp: calcChange(t.cpp, pt.cpp),
            roas: calcChange(t.roas, pt.roas),
            spend: calcChange(t.spend, pt.spend),
            cpm: calcChange(t.cpm, pt.cpm),
            atc: calcChange(t.atc, pt.atc),
            checkouts: calcChange(t.checkouts, pt.checkouts),
            linkClicks: calcChange(t.linkClicks, pt.linkClicks),
            lctr: calcChange(t.lctr, pt.lctr),
          });
        } catch { setKpiChanges(null); setPriorTotals(null); }
      }

      // Parse breakdown data
      const parseBreakdown = async (res: Response | null) => {
        if (!res?.ok) return [];
        try {
          let json = await res.json();
          json = unwrapPipeboardResponse(json);
          return Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
        } catch { return []; }
      };

      setAdsData(await parseBreakdown(adRes));
      setAgeData(await parseBreakdown(ageRes));
      setGenderData(await parseBreakdown(genderRes));

      setLastRefreshed(new Date());
      startCooldown();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [client.ad_account_id, dateRangeIndex, startCooldown]);

  useEffect(() => {
    fetchData();
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeIndex]);

  const handleDateRangeChange = (index: number) => {
    if (index === dateRangeIndex) return;
    setDateRangeIndex(index);
    setCooldownRemaining(0);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  };

  // ── Derived sparkline arrays ───────────────────────────────────────────

  const sparkPurchases = dailyData.map((d) => d.purchases);
  const sparkCpp = dailyData.map((d) => d.cpp);
  const sparkSpend = dailyData.map((d) => d.spend);
  const sparkCpm = dailyData.map((d) => d.cpm);

  const roas = totals.roas;
  const sparkRoas = dailyData.map((d) => d.roas);

  // Budget pacing
  const pacing = computePacingDays(dateRangeIndex);

  // Funnel stages
  const funnelStages = [
    { label: 'Impressions', value: totals.impressions },
    { label: 'Link Clicks', value: totals.linkClicks },
    { label: 'Add to Cart', value: totals.atc },
    { label: 'Checkouts', value: totals.checkouts },
    { label: 'Purchases', value: totals.purchases },
  ];

  // Insights
  const insights = buildInsights(totals, priorTotals, campaigns);

  // Column formatters
  const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
  const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
  const numCol = (v: unknown) => fmt(Number(v ?? 0));
  const nullMoney = (v: unknown) => { const n = Number(v ?? 0); return n > 0 ? fmtMoney(n) : '--'; };

  return (
    <div className="space-y-6">
      {/* 1. Report Header */}
      <ReportHeader
        clientName={client.client_name}
        platform={client.platform}
        dateRangeIndex={dateRangeIndex}
        onDateRangeChange={handleDateRangeChange}
        loading={loading}
        onRefresh={fetchData}
        lastRefreshed={lastRefreshed}
        cooldownRemaining={cooldownRemaining}
      />

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

      {!loading && !error && (
        <>
          {/* 2. Executive Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <SparklineKpiCard
              label="Purchases"
              value={fmt(totals.purchases)}
              change={kpiChanges?.purchases.pct}
              changeDirection={kpiChanges?.purchases.direction}
              changeSentiment="positive-up"
              size="lg"
              sparklineData={sparkPurchases}
            />
            <SparklineKpiCard
              label="Cost Per Purchase"
              value={totals.purchases > 0 ? fmtMoney(totals.cpp) : '--'}
              change={kpiChanges?.cpp.pct}
              changeDirection={kpiChanges?.cpp.direction}
              changeSentiment="negative-up"
              size="lg"
              sparklineData={sparkCpp}
            />
            <SparklineKpiCard
              label="ROAS"
              value={roas > 0 ? roas.toFixed(2) + 'x' : '--'}
              change={kpiChanges?.roas?.pct}
              changeDirection={kpiChanges?.roas?.direction}
              changeSentiment="positive-up"
              size="lg"
              sparklineData={sparkRoas}
            />
            <SparklineKpiCard
              label="Total Spend"
              value={fmtMoney(totals.spend)}
              change={kpiChanges?.spend.pct}
              changeDirection={kpiChanges?.spend.direction}
              changeSentiment="neutral"
              size="lg"
              sparklineData={sparkSpend}
            />
            <SparklineKpiCard
              label="CPM"
              value={totals.impressions > 0 ? fmtMoney(totals.cpm) : '--'}
              change={kpiChanges?.cpm?.pct}
              changeDirection={kpiChanges?.cpm?.direction}
              changeSentiment="negative-up"
              size="lg"
              sparklineData={sparkCpm}
            />
          </div>

          {/* 3. Secondary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SparklineKpiCard
              label="Add to Carts"
              value={fmt(totals.atc)}
              change={kpiChanges?.atc?.pct}
              changeDirection={kpiChanges?.atc?.direction}
              changeSentiment="positive-up"
              sparklineData={dailyData.map((d) => d.atc)}
            />
            <SparklineKpiCard
              label="Checkouts Initiated"
              value={fmt(totals.checkouts)}
              change={kpiChanges?.checkouts?.pct}
              changeDirection={kpiChanges?.checkouts?.direction}
              changeSentiment="positive-up"
              sparklineData={dailyData.map((d) => d.checkouts)}
            />
            <SparklineKpiCard
              label="Link Clicks"
              value={fmt(totals.linkClicks)}
              change={kpiChanges?.linkClicks?.pct}
              changeDirection={kpiChanges?.linkClicks?.direction}
              changeSentiment="positive-up"
              sparklineData={dailyData.map((d) => d.linkClicks)}
            />
            <SparklineKpiCard
              label="LC-CTR"
              value={fmtPct(totals.lctr)}
              change={kpiChanges?.lctr?.pct}
              changeDirection={kpiChanges?.lctr?.direction}
              changeSentiment="positive-up"
              sparklineData={dailyData.map((d) =>
                d.impressions > 0 ? d.linkClicks / d.impressions : 0,
              )}
            />
          </div>

          {/* 4. Budget Pacing */}
          {client.monthly_budget != null && client.monthly_budget > 0 && (
            <BudgetPacingGauge
              spent={totals.spend}
              budget={client.monthly_budget}
              daysElapsed={pacing.daysElapsed}
              daysInPeriod={pacing.daysInPeriod}
            />
          )}

          {/* 5. Spend & Purchases Trend */}
          {dailyData.length > 0 && (
            <ReportChart
              title="Spend & Purchases Trend"
              data={dailyData}
              xKey="date"
              lines={[
                { dataKey: 'spend', label: 'Spend', color: '#3B82F6', type: 'bar', yAxisId: 'left' },
                { dataKey: 'purchases', label: 'Purchases', color: '#10B981', yAxisId: 'right' },
              ]}
              formatY={(v) => `$${v.toLocaleString()}`}
              formatYRight={(v) => v.toFixed(0)}
            />
          )}

          {/* 6. Conversion Funnel */}
          <FunnelChart title="Conversion Funnel" stages={funnelStages} />

          {/* 7. Campaign Performance */}
          <BreakdownTable
            title="Campaign Performance"
            columns={[
              { key: 'name', label: 'Campaign' },
              { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
              { key: 'linkClicks', label: 'Clicks', align: 'right', format: numCol },
              { key: 'lctr', label: 'LC-CTR', align: 'right', format: pctCol },
              { key: 'spend', label: 'Spend', align: 'right', format: moneyCol },
              { key: 'atc', label: 'ATC', align: 'right', format: numCol },
              { key: 'cpa2c', label: 'CPA2C', align: 'right', format: nullMoney },
              { key: 'checkouts', label: 'Checkouts', align: 'right', format: numCol },
              { key: 'cpci', label: 'CPCI', align: 'right', format: nullMoney },
              { key: 'purchases', label: 'Purchases', align: 'right', format: numCol },
              { key: 'cpp', label: 'CPP', align: 'right', format: nullMoney },
              { key: 'roas', label: 'ROAS', align: 'right', format: (v: unknown) => { const n = Number(v ?? 0); return n > 0 ? n.toFixed(2) + 'x' : '--'; } },
            ]}
            data={campaigns}
            maxRows={15}
          />

          {/* 8. Ads Overview */}
          {adsData.length > 0 && (
            <BreakdownTable
              title="Ads Overview"
              columns={[
                { key: 'ad_name', label: 'Ad' },
                { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
                { key: 'inline_link_clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
                { key: 'purchases', label: 'Purchases', align: 'right', format: numCol },
                { key: 'cpp', label: 'CPP', align: 'right', format: nullMoney },
              ]}
              data={adsData.map((row) => {
                const r = row as Record<string, unknown>;
                const actions = (r.actions ?? []) as Array<{ action_type: string; value: string }>;
                const purchases = getActionValue(actions, 'offsite_conversion.fb_pixel_purchase');
                const spend = Number(r.spend ?? 0);
                return { ...row, ad_name: r.ad_name ?? r.name ?? 'Unknown Ad', purchases, cpp: purchases > 0 ? spend / purchases : 0 };
              })}
              maxRows={15}
            />
          )}

          {/* 9. Demographics */}
          {(ageData.length > 0 || genderData.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {ageData.length > 0 && (
                <BreakdownTable
                  title="Age Breakdown"
                  columns={[
                    { key: 'age', label: 'Age' },
                    { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
                    { key: 'inline_link_clicks', label: 'Clicks', align: 'right', format: numCol },
                    { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
                    { key: 'purchases', label: 'Purchases', align: 'right', format: numCol },
                  ]}
                  data={ageData.map((row) => {
                    const actions = ((row as Record<string, unknown>).actions ?? []) as Array<{ action_type: string; value: string }>;
                    return { ...row, purchases: getActionValue(actions, 'offsite_conversion.fb_pixel_purchase') };
                  })}
                />
              )}
              {genderData.length > 0 && (
                <BreakdownTable
                  title="Gender Breakdown"
                  columns={[
                    { key: 'gender', label: 'Gender' },
                    { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
                    { key: 'inline_link_clicks', label: 'Clicks', align: 'right', format: numCol },
                    { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
                    { key: 'purchases', label: 'Purchases', align: 'right', format: numCol },
                  ]}
                  data={genderData.map((row) => {
                    const actions = ((row as Record<string, unknown>).actions ?? []) as Array<{ action_type: string; value: string }>;
                    return { ...row, purchases: getActionValue(actions, 'offsite_conversion.fb_pixel_purchase') };
                  })}
                />
              )}
            </div>
          )}

          {/* 10. Insights */}
          <InsightsBlock insights={insights} />
        </>
      )}

      {/* 11. Notes */}
      <ReportNotes
        clientId={client.id}
        initialNotes={client.client_report_notes ?? ''}
        mode={mode}
      />
    </div>
  );
}

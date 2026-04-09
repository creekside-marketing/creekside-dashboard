'use client';

/**
 * EcomMetaReport — Ecommerce Meta Ads report with sparklines, funnel,
 * and ad creative thumbnails.
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
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [adsData, setAdsData] = useState<Record<string, unknown>[]>([]);
  const [adCreatives, setAdCreatives] = useState<Record<string, { thumbnail: string | null; imageUrl: string | null }>>({});
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

      const periods = computePriorPeriod(dateRangeIndex);

      const campaignUrl = `/api/meta/insights?account_id=${aid}&level=campaign&time_range=${tr}`;
      const accountUrl = `/api/meta/insights?account_id=${aid}&level=account&since=${periods.currentSince}&until=${periods.currentUntil}&time_breakdown=day`;
      const adUrl = `/api/meta/insights?account_id=${aid}&level=ad&time_range=${tr}`;
      const priorCampaignUrl = `/api/meta/insights?account_id=${aid}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`;

      const [campaignRes, accountRes, priorRes, adRes] = await Promise.all([
        fetch(campaignUrl),
        fetch(accountUrl),
        fetch(priorCampaignUrl),
        fetch(adUrl).catch(() => null),
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

          // PipeBoard with time_breakdown returns segmented_metrics array
          const segments = accountJson.segmented_metrics ?? accountJson.data ?? accountJson ?? [];
          if (Array.isArray(segments)) {
            setDailyData(parseDailyRows(segments.map((seg: Record<string, unknown>) => {
              // Flatten segmented format: metrics are nested under .metrics
              const metrics = (seg.metrics ?? seg) as Record<string, unknown>;
              return {
                ...metrics,
                date_start: seg.period ?? seg.period_start ?? metrics.date_start ?? metrics.date,
              };
            })));
          }
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
        } catch { setKpiChanges(null); }
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

      // Parse ads data into a local variable (used for both state and extracting IDs)
      const parsedAds = await parseBreakdown(adRes);
      setAdsData(parsedAds);

      // Fetch ad creative thumbnails using the ad IDs we just got
      const creativesMap: Record<string, { thumbnail: string | null; imageUrl: string | null }> = {};
      try {
        const adIds = parsedAds
          .map((row: Record<string, unknown>) => String(row.ad_id ?? row.id ?? ''))
          .filter(Boolean);

        if (adIds.length > 0) {
          const creativesRes = await fetch(`/api/meta/creatives?ad_ids=${adIds.join(',')}`);
          if (creativesRes.ok) {
            const cJson = await creativesRes.json();
            const thumbMap = cJson.data ?? {};
            for (const [id, val] of Object.entries(thumbMap)) {
              if (val && typeof val === 'object') {
                creativesMap[id] = val as { thumbnail: string | null; imageUrl: string | null };
              } else if (typeof val === 'string') {
                // Backward compat: if API returns plain string URLs
                creativesMap[id] = { thumbnail: val, imageUrl: val };
              }
            }
          }
        }
      } catch { /* optional — thumbnails are a nice-to-have */ }
      setAdCreatives(creativesMap);

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

          {/* 4. Spend & Purchases Trend */}
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

          {/* Campaign Performance */}
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

          {/* 8. Ads Overview with Thumbnails */}
          {adsData.length > 0 && (() => {
            const processedAds = adsData.map((row) => {
              const r = row as Record<string, unknown>;
              const actions = (r.actions ?? []) as Array<{ action_type: string; value: string }>;
              const purchases = getActionValue(actions, 'offsite_conversion.fb_pixel_purchase');
              const spend = Number(r.spend ?? 0);
              return {
                adId: String(r.ad_id ?? r.id ?? ''),
                adName: String(r.ad_name ?? r.name ?? 'Unknown Ad'),
                impressions: Number(r.impressions ?? 0),
                linkClicks: Number(r.inline_link_clicks ?? 0),
                spend,
                purchases,
                cpp: purchases > 0 ? spend / purchases : 0,
              };
            }).sort((a, b) => b.purchases - a.purchases).slice(0, 15);

            return (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50">
                  <h3 className="text-sm font-semibold text-slate-700">Ads Overview</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80">
                        <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-left">Ad</th>
                        <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-right">Impr.</th>
                        <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-right">Clicks</th>
                        <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-right">Spent</th>
                        <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-right">Purchases</th>
                        <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-right">CPP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedAds.map((ad, idx) => {
                        const creative = adCreatives[ad.adId];
                        const thumbUrl = creative?.thumbnail;
                        const imageUrl = creative?.imageUrl;
                        return (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-blue-50/50 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                {thumbUrl ? (
                                  <a href={imageUrl ?? thumbUrl} target="_blank" rel="noopener noreferrer">
                                    <img src={thumbUrl} alt="" className="w-10 h-10 rounded-md object-cover border border-slate-200 shrink-0 hover:ring-2 hover:ring-blue-400 transition-all" />
                                  </a>
                                ) : null}
                                {imageUrl ? (
                                  <a href={imageUrl} target="_blank" rel="noopener noreferrer"
                                    className="text-sm font-medium text-[#2563eb] hover:text-blue-700 truncate max-w-[250px] transition-colors">
                                    {ad.adName}
                                  </a>
                                ) : (
                                  <span className="text-sm font-medium text-slate-900 truncate max-w-[250px]">{ad.adName}</span>
                                )}
                              </div>
                            </td>
                            <td className="text-sm text-right text-slate-700 py-3 px-4 tabular-nums">{fmt(ad.impressions)}</td>
                            <td className="text-sm text-right text-slate-700 py-3 px-4 tabular-nums">{fmt(ad.linkClicks)}</td>
                            <td className="text-sm text-right text-slate-700 py-3 px-4 tabular-nums">{fmtMoney(ad.spend)}</td>
                            <td className="text-sm text-right text-slate-700 py-3 px-4 tabular-nums">{fmt(ad.purchases)}</td>
                            <td className="text-sm text-right text-slate-700 py-3 px-4 tabular-nums">{ad.purchases > 0 ? fmtMoney(ad.cpp) : '--'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

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

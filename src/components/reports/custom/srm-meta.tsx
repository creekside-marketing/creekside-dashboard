'use client';

/**
 * Custom report for South River Mortgage (Meta).
 * Manually branched from LeadGenMetaReport.tsx (imports shared leaf
 * components directly from ../ rather than a copied _slug/ folder).
 *
 * Customizations vs the shared lead-gen Meta template:
 *  - Highlighted "Pricing Qualified Leads" primary-KPI section at the top,
 *    mirroring the South River Mortgage Google report. PQL is the Meta
 *    Events-Manager custom conversion "(JTC) Pricing Qualified".
 *  - "Lead" everywhere in this report means the Events-Manager custom
 *    conversion "(JTC) Pre-qualified Lead" (per Peterson). As of 2026-06 the
 *    account's standard `lead` / `offsite_conversion.fb_pixel_lead` pixel
 *    events STOPPED FIRING — lead tracking moved entirely to the custom
 *    conversions — so sourcing leads from the standard actions now reads 0.
 *    We therefore read the "(JTC) Pre-qualified Lead" value from each row's
 *    `conversions` array. (Earlier versions briefly used the standard `lead`
 *    rollup; that is now obsolete because the event no longer fires.)
 *
 * All lead figures (KPI cards, trend chart, campaign + ads tables) are the
 * (JTC) Pre-qualified Lead count; PQL is shown separately in the header block.
 *
 * CANNOT: Modify ad account settings or budgets — read-only data fetching.
 * CANNOT: Display Google Ads data — Meta Ads only.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ReportHeader, {
  DATE_RANGES, computePriorPeriod,
  calcChange, fmt, fmtMoney, fmtPct, unwrapPipeboardResponse,
} from '../ReportHeader';
import ReportChart from '../ReportChart';
import BreakdownTable from '../BreakdownTable';
import ReportNotesTimeline from '../ReportNotesTimeline';
import { SparklineKpiCard } from '../shared';
import { ReportingClient } from '../types';

// ── Types ────────────────────────────────────────────────────────────────

interface LeadGenRow {
  name: string; impressions: number; linkClicks: number; spend: number;
  leads: number; reach: number; frequency: number; cpm: number; cpl: number; lctr: number;
}

interface DailyRow {
  [key: string]: unknown;
  date: string; impressions: number; linkClicks: number; spend: number;
  leads: number; reach: number; frequency: number; cpm: number; cpl: number; lctr: number;
}

// ── Custom-conversion sourcing (Events Manager) ─────────────────────────────

/**
 * SRM tracks its funnel via Meta custom conversions, surfaced per-row in the
 * `conversions` array from PipeBoard's get_insights:
 *   - "(JTC) Pre-qualified Lead"  → the tracked LEAD for this report
 *   - "(JTC) Pricing Qualified"   → the primary PQL KPI
 * The standard `lead` pixel event no longer fires for this account, so leads
 * MUST come from the Pre-qualified custom conversion. Matches are loose so a
 * rename in Events Manager won't silently zero a metric, but each regex hits
 * exactly one event: PREQ matches "pre-qualified" (not "pricing qualified"),
 * PQL matches "pricing qualified" (not "pre-qualified").
 */
const PREQ_LABEL = '(JTC) Pre-qualified Lead';
const PREQ_MATCH = /pre-?qualified/i;
const PQL_LABEL = '(JTC) Pricing Qualified';
const PQL_MATCH = /pricing qualified/i;

type MetaConversion = { action_type: string; value: string };

/** Sums a custom-conversion value matching `match` on a single insights row. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sumConv(row: any, match: RegExp): number {
  const convs = (row?.conversions ?? []) as MetaConversion[];
  if (!Array.isArray(convs)) return 0;
  return convs.reduce(
    (sum, c) => (match.test(c.action_type) ? sum + (Number(c.value) || 0) : sum),
    0,
  );
}

/** Sums a custom conversion across many rows (e.g. all campaigns in a period). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sumConvRows(rows: any[], match: RegExp): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((s, r) => s + sumConv(r, match), 0);
}

interface PqlState { current: number; prior: number; costCurrent: number; costPrior: number; }
const ZERO_PQL: PqlState = { current: 0, prior: 0, costCurrent: 0, costPrior: 0 };

// ── Helpers ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(row: any): LeadGenRow {
  const impressions = Number(row.impressions ?? 0);
  const linkClicks = Number(row.inline_link_clicks ?? row.clicks ?? 0);
  const spend = Number(row.spend ?? 0);
  const leads = sumConv(row, PREQ_MATCH);
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
    const impressions = Number(row.impressions ?? 0);
    const spend = Number(row.spend ?? 0);
    const linkClicks = Number(row.inline_link_clicks ?? row.clicks ?? 0);
    const leads = sumConv(row, PREQ_MATCH);
    const reach = Number(row.reach ?? 0);
    return { date: row.date_start ?? row.date ?? '', impressions, linkClicks, spend, leads, reach,
      frequency: reach > 0 ? impressions / reach : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpl: leads > 0 ? spend / leads : 0, lctr: impressions > 0 ? linkClicks / impressions : 0 };
  }).sort((a, b) => a.date.localeCompare(b.date));
}


const COOLDOWN_MS = 5 * 60 * 1000;
const ZERO: Omit<LeadGenRow, 'name'> = { impressions: 0, linkClicks: 0, spend: 0, leads: 0, reach: 0, frequency: 0, cpm: 0, cpl: 0, lctr: 0 };

// ── Component ────────────────────────────────────────────────────────────

export default function SrmMetaReport({ client, mode }: { client: ReportingClient; mode: 'internal' | 'public' }) {
  const [campaigns, setCampaigns] = useState<LeadGenRow[]>([]);
  const [totals, setTotals] = useState(ZERO);
  const [pqlData, setPqlData] = useState<PqlState>(ZERO_PQL);
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [adsData, setAdsData] = useState<Record<string, unknown>[]>([]);
  const [adCreatives, setAdCreatives] = useState<Record<string, { thumbnail: string | null; imageUrl: string | null }>>({});
  const [kpiChanges, setKpiChanges] = useState<Record<string, { pct: string; direction: 'up' | 'down' | 'flat' }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // SRM reports weekly: default to the 7d window (index 0) rather than the
  // shared 30d default, so the headline KPIs (esp. Pricing Qualified) reflect
  // the current week, not the trailing month.
  const SRM_DEFAULT_RANGE_INDEX = 0; // 7d
  const [dateRangeIndex, setDateRangeIndex] = useState(SRM_DEFAULT_RANGE_INDEX);
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
      const [campaignRes, accountRes, priorRes, adRes] = await Promise.all([
        fetch(`${base}&level=campaign&time_range=${tr}`),
        fetch(`${base}&level=account&since=${periods.currentSince}&until=${periods.currentUntil}&time_breakdown=day`),
        fetch(`${base}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`),
        fetch(`${base}&level=ad&time_range=${tr}`).catch(() => null),
      ]);
      if (!campaignRes.ok) { const b = await campaignRes.json().catch(() => ({})); throw new Error(b.error || `HTTP ${campaignRes.status}`); }

      let cj = await campaignRes.json();
      if (!cj || typeof cj !== 'object') throw new Error('Invalid API response');
      cj = unwrapPipeboardResponse(cj);
      const dataArr = Array.isArray(cj.data ?? cj) ? (cj.data ?? cj) : [];
      const norm = (dataArr as unknown[]).map(normalize);
      setCampaigns(norm);
      const t = computeTotals(norm); setTotals(t);

      // PQL (current period) — summed from each campaign row's `conversions`.
      const pqlCurrent = sumConvRows(dataArr as unknown[], PQL_MATCH);
      let pqlPrior = 0;
      let spendPrior = 0;

      if (accountRes.ok) {
        try {
          let aj = await accountRes.json();
          aj = unwrapPipeboardResponse(aj);
          // Handle segmented_metrics format from time_breakdown
          const segments = aj.segmented_metrics ?? aj.data ?? aj ?? [];
          if (Array.isArray(segments)) {
            setDailyData(parseDailyRows(segments.map((seg: Record<string, unknown>) => {
              const metrics = (seg.metrics ?? seg) as Record<string, unknown>;
              return { ...metrics, date_start: seg.period ?? seg.period_start ?? metrics.date_start ?? metrics.date };
            })));
          }
        } catch { /* optional */ }
      }
      if (priorRes.ok) {
        try { let pj = await priorRes.json(); pj = unwrapPipeboardResponse(pj);
          const pa = Array.isArray(pj.data ?? pj) ? (pj.data ?? pj) : [];
          const pt = computeTotals((pa as unknown[]).map(normalize));
          pqlPrior = sumConvRows(pa as unknown[], PQL_MATCH);
          spendPrior = pt.spend;
          setKpiChanges({ leads: calcChange(t.leads, pt.leads), cpl: calcChange(t.cpl, pt.cpl),
            spend: calcChange(t.spend, pt.spend), cpm: calcChange(t.cpm, pt.cpm),
            frequency: calcChange(t.frequency, pt.frequency), linkClicks: calcChange(t.linkClicks, pt.linkClicks),
            lctr: calcChange(t.lctr, pt.lctr), impressions: calcChange(t.impressions, pt.impressions),
            reach: calcChange(t.reach, pt.reach) });
        } catch { setKpiChanges(null); }
      }

      setPqlData({
        current: pqlCurrent,
        prior: pqlPrior,
        costCurrent: pqlCurrent > 0 ? t.spend / pqlCurrent : 0,
        costPrior: pqlPrior > 0 ? spendPrior / pqlPrior : 0,
      });

      const parseBd = async (res: Response | null) => {
        if (!res?.ok) return [];
        try { let j = await res.json(); j = unwrapPipeboardResponse(j);
          return Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
        } catch { return []; }
      };
      // Parse ads data into a local variable (used for both state and extracting IDs)
      const parsedAds = await parseBd(adRes);
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

  // PQL primary-KPI derived values
  const pqlChange = calcChange(pqlData.current, pqlData.prior);
  const costPerPqlChange = calcChange(pqlData.costCurrent, pqlData.costPrior);

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
        {/* 0. PRIMARY KPI — Pricing Qualified Leads (highlighted) */}
        <div className="rounded-xl border-2 border-[#bfdbfe] bg-gradient-to-r from-[#eff6ff] to-[#eef2ff] p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block w-2 h-2 rounded-full bg-[#2563eb]" />
            <h2 className="text-xs font-bold text-[#1d4ed8] uppercase tracking-wider">
              Primary KPI &mdash; Pricing Qualified Leads
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SparklineKpiCard
              label="Pricing Qualified Leads"
              value={fmt(pqlData.current)}
              change={pqlChange.pct}
              changeDirection={pqlChange.direction}
              changeSentiment="positive-up"
              size="lg"
            />
            <SparklineKpiCard
              label="Cost per Pricing Qualified Lead"
              value={pqlData.current > 0 ? fmtMoney(pqlData.costCurrent) : '--'}
              change={costPerPqlChange.pct}
              changeDirection={costPerPqlChange.direction}
              changeSentiment="negative-up"
              size="lg"
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            Counts the Meta custom conversion &ldquo;{PQL_LABEL}&rdquo; from Events Manager. Recent days may rise as conversions finish attributing.
          </p>
        </div>

        {/* Executive Summary KPIs — lead metric = deduped standard `lead` event */}
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
          <SparklineKpiCard label="Conv. Rate" value={totals.linkClicks > 0 ? fmtPct(totals.leads / totals.linkClicks) : '--'}
            change={kpiChanges?.lctr.pct} changeDirection={kpiChanges?.lctr.direction}
            changeSentiment="positive-up" size="lg"
            sparklineData={dailyData.map((d) => d.linkClicks > 0 ? d.leads / d.linkClicks : 0)} />
          <SparklineKpiCard label="Avg CPC" value={totals.linkClicks > 0 ? fmtMoney(totals.spend / totals.linkClicks) : '--'}
            change={kpiChanges?.cpm.pct} changeDirection={kpiChanges?.cpm.direction}
            changeSentiment="negative-up" size="lg"
            sparklineData={dailyData.map((d) => d.linkClicks > 0 ? d.spend / d.linkClicks : 0)} />
        </div>
        <p className="text-[11px] text-slate-500 -mt-2">
          &ldquo;Leads&rdquo; here is the Events Manager custom conversion &ldquo;{PREQ_LABEL}&rdquo; (SRM&rsquo;s tracked lead) &mdash; the standard Meta lead pixel no longer fires for this account, so leads are sourced from this conversion.
        </p>

        {/* 4-5. Charts */}
        {dailyData.length > 0 && (<>
          <ReportChart title="Lead Volume & Cost Trend" data={dailyData} xKey="date"
            lines={[
              { dataKey: 'leads', label: 'Leads', color: '#10B981', type: 'bar', yAxisId: 'left' },
              { dataKey: 'cpl', label: 'CPL', color: '#8B5CF6', yAxisId: 'right' },
            ]} formatY={(v) => v.toFixed(0)} formatYRight={(v) => `$${v.toFixed(0)}`} />
        </>)}

        {/* 6. Campaign Performance */}
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

        {/* 9. Ads Overview with Thumbnails */}
        {adsData.length > 0 && (() => {
          const processedAds = adsData.map((row) => {
            const r = row as Record<string, unknown>;
            const leads = sumConv(r, PREQ_MATCH);
            const spend = Number(r.spend ?? 0);
            return {
              adId: String(r.ad_id ?? r.id ?? ''),
              adName: String(r.ad_name ?? r.name ?? 'Unknown Ad'),
              impressions: Number(r.impressions ?? 0),
              linkClicks: Number(r.inline_link_clicks ?? r.clicks ?? 0),
              spend,
              leads,
              cpl: leads > 0 ? spend / leads : 0,
            };
          }).sort((a, b) => b.leads - a.leads).slice(0, 15);

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
                      <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-right">Leads</th>
                      <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-right">CPL</th>
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
                          <td className="text-sm text-right text-slate-700 py-3 px-4 tabular-nums">{fmt(ad.leads)}</td>
                          <td className="text-sm text-right text-slate-700 py-3 px-4 tabular-nums">{ad.leads > 0 ? fmtMoney(ad.cpl) : '--'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

      </>)}

      {/* 12. Notes */}
      <ReportNotesTimeline clientId={client.id} mode={mode} />
    </div>
  );
}

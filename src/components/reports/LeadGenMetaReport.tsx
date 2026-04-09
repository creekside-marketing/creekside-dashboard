'use client';

/**
 * LeadGenMetaReport — Lead generation report for Meta Ads clients.
 *
 * Fetches campaign, account, ad, and demographic data from `/api/meta/insights`,
 * normalizes lead actions (lead + offsite_conversion.fb_pixel_lead), and renders
 * KPIs, charts, campaign/ads tables, and notes.
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
import { SparklineKpiCard } from './shared';

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


const COOLDOWN_MS = 5 * 60 * 1000;
const ZERO: Omit<LeadGenRow, 'name'> = { impressions: 0, linkClicks: 0, spend: 0, leads: 0, reach: 0, frequency: 0, cpm: 0, cpl: 0, lctr: 0 };

// ── Component ────────────────────────────────────────────────────────────

export default function LeadGenMetaReport({ client, mode }: { client: ReportingClient; mode: 'internal' | 'public' }) {
  const [campaigns, setCampaigns] = useState<LeadGenRow[]>([]);
  const [totals, setTotals] = useState(ZERO);
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [adsData, setAdsData] = useState<Record<string, unknown>[]>([]);
  const [adCreatives, setAdCreatives] = useState<Record<string, { thumbnail: string | null; imageUrl: string | null }>>({});
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
          setKpiChanges({ leads: calcChange(t.leads, pt.leads), cpl: calcChange(t.cpl, pt.cpl),
            spend: calcChange(t.spend, pt.spend), cpm: calcChange(t.cpm, pt.cpm),
            frequency: calcChange(t.frequency, pt.frequency), linkClicks: calcChange(t.linkClicks, pt.linkClicks),
            lctr: calcChange(t.lctr, pt.lctr), impressions: calcChange(t.impressions, pt.impressions),
            reach: calcChange(t.reach, pt.reach) });
        } catch { setKpiChanges(null); }
      }
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

        {/* 4-5. Charts */}
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
            const actions = (r.actions ?? []) as MetaAction[];
            const leads = getLeads(actions);
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
                              <a
                                href={`https://www.facebook.com/ads/library/?id=${ad.adId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-[#2563eb] hover:text-blue-700 truncate max-w-[250px] transition-colors"
                              >
                                {ad.adName}
                              </a>
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
      <ReportNotes clientId={client.id} initialNotes={client.client_report_notes ?? ''} mode={mode} />
    </div>
  );
}

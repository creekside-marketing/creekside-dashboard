/**
 * useGoogleAdsData — Shared data-fetching hook for Google Ads report components.
 *
 * Handles API calls, normalization, prior-period comparisons, cooldown timer,
 * and date range management. Returns all data ready for rendering.
 *
 * CANNOT: Render UI — returns data only.
 * CANNOT: Write to any API — read-only fetching.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  DATE_RANGES,
  DEFAULT_RANGE_INDEX,
  computePriorPeriod,
  calcChange,
} from '@/components/reports/ReportHeader';

// ── Types ────────────────────────────────────────────────────────────────

export interface Campaign {
  name: string;
  status: string;
  type?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
}

export interface Totals {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cost: number;
  conversions: number;
}

export interface DailyRow {
  [key: string]: unknown;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
}

export interface KpiChangeSet {
  clicks: { pct: string; direction: 'up' | 'down' | 'flat' };
  impressions: { pct: string; direction: 'up' | 'down' | 'flat' };
  ctr: { pct: string; direction: 'up' | 'down' | 'flat' };
  cost: { pct: string; direction: 'up' | 'down' | 'flat' };
  costPerConversion: { pct: string; direction: 'up' | 'down' | 'flat' };
  convRate: { pct: string; direction: 'up' | 'down' | 'flat' };
  cpc: { pct: string; direction: 'up' | 'down' | 'flat' };
  conversions: { pct: string; direction: 'up' | 'down' | 'flat' };
}

export interface GoogleAdsData {
  campaigns: Campaign[];
  totals: Totals;
  dailyData: DailyRow[];
  keywords: Record<string, unknown>[];
  searchTerms: Record<string, unknown>[];
  geoData: Record<string, unknown>[];
  ageData: Record<string, unknown>[];
  genderData: Record<string, unknown>[];
  kpiChanges: KpiChangeSet | null;
  loading: boolean;
  error: string | null;
  lastRefreshed: Date | null;
  cooldownRemaining: number;
  dateRangeIndex: number;
  currentRange: { label: string; googleParam: string; metaParam: string };
  handleDateRangeChange: (index: number) => void;
  fetchData: () => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeGoogleCampaign(row: any): Campaign {
  return {
    name: row.campaign_name ?? 'Unknown Campaign',
    status: row.status ?? 'unknown',
    type: row.channel_type ?? undefined,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpc: Number(row.average_cpc ?? 0),
    cost: Number(row.cost ?? 0),
    conversions: Number(row.conversions ?? 0),
    costPerConversion: Number(row.cost_per_conversion ?? 0),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseBreakdown(res: Response | null): Promise<Record<string, any>[]> {
  if (!res?.ok) return [];
  try {
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch { return []; }
}

function computeTotals(campaigns: Campaign[]): Totals {
  const t = campaigns.reduce(
    (acc, c) => ({
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      cost: acc.cost + c.cost,
      conversions: acc.conversions + c.conversions,
      ctr: 0,
      cpc: 0,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, ctr: 0, cpc: 0 }
  );
  t.ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
  t.cpc = t.clicks > 0 ? t.cost / t.clicks : 0;
  return t;
}

const COOLDOWN_MS = 5 * 60 * 1000;

// ── Hook ─────────────────────────────────────────────────────────────────

export function useGoogleAdsData(adAccountId: string | null): GoogleAdsData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [totals, setTotals] = useState<Totals>({ impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0 });
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [keywords, setKeywords] = useState<Record<string, unknown>[]>([]);
  const [searchTerms, setSearchTerms] = useState<Record<string, unknown>[]>([]);
  const [geoData, setGeoData] = useState<Record<string, unknown>[]>([]);
  const [ageData, setAgeData] = useState<Record<string, unknown>[]>([]);
  const [genderData, setGenderData] = useState<Record<string, unknown>[]>([]);
  const [kpiChanges, setKpiChanges] = useState<KpiChangeSet | null>(null);
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
    if (!adAccountId) {
      setLoading(false);
      setError('No ad account linked');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const range = DATE_RANGES[dateRangeIndex];
      const cid = encodeURIComponent(adAccountId);
      const dr = range.googleParam;

      const campaignUrl = `/api/google/insights?customer_id=${cid}&level=campaign&date_range=${dr}`;
      const accountUrl = `/api/google/insights?customer_id=${cid}&level=account&date_range=${dr}`;
      const keywordUrl = `/api/google/insights?customer_id=${cid}&level=keyword&date_range=${dr}`;
      const searchTermUrl = `/api/google/insights?customer_id=${cid}&level=search_term&date_range=${dr}`;
      const geoUrl = `/api/google/insights?customer_id=${cid}&level=geo&date_range=${dr}`;
      const ageUrl = `/api/google/insights?customer_id=${cid}&level=age&date_range=${dr}`;
      const genderUrl = `/api/google/insights?customer_id=${cid}&level=gender&date_range=${dr}`;

      const periods = computePriorPeriod(dateRangeIndex);
      const priorCampaignUrl = `/api/google/insights?customer_id=${cid}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`;

      const [campaignRes, accountRes, priorRes, kwRes, stRes, geoRes, ageRes, genderRes] = await Promise.all([
        fetch(campaignUrl),
        fetch(accountUrl),
        fetch(priorCampaignUrl),
        fetch(keywordUrl).catch(() => null),
        fetch(searchTermUrl).catch(() => null),
        fetch(geoUrl).catch(() => null),
        fetch(ageUrl).catch(() => null),
        fetch(genderUrl).catch(() => null),
      ]);

      if (!campaignRes.ok) {
        const body = await campaignRes.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${campaignRes.status}`);
      }

      // Parse campaigns
      const campaignJson = await campaignRes.json();
      if (!campaignJson || typeof campaignJson !== 'object') throw new Error('Invalid API response');
      const rawData = campaignJson.data ?? campaignJson ?? [];
      const dataArr = Array.isArray(rawData) ? rawData : [];
      const normalized = dataArr.map(normalizeGoogleCampaign);
      setCampaigns(normalized);

      const t = computeTotals(normalized);
      setTotals(t);

      // Parse account-level daily data
      if (accountRes.ok) {
        try {
          const accountJson = await accountRes.json();
          const rows = accountJson.data ?? [];
          if (Array.isArray(rows)) {
            const daily: DailyRow[] = rows.map((r: Record<string, unknown>) => ({
              date: String(r.date ?? ''),
              impressions: Number(r.impressions ?? 0),
              clicks: Number(r.clicks ?? 0),
              ctr: Number(r.ctr ?? 0),
              cpc: Number(r.average_cpc ?? 0),
              cost: Number(r.cost ?? 0),
              conversions: Number(r.conversions ?? 0),
              costPerConversion: Number(r.cost_per_conversion ?? 0),
            })).sort((a, b) => a.date.localeCompare(b.date));
            setDailyData(daily);
          }
        } catch { /* optional */ }
      }

      // Parse prior period for KPI changes
      if (priorRes.ok) {
        try {
          const priorJson = await priorRes.json();
          const priorRaw = priorJson.data ?? priorJson ?? [];
          const priorArr = Array.isArray(priorRaw) ? priorRaw : [];
          const pt = computeTotals(priorArr.map(normalizeGoogleCampaign));

          const cpl = t.conversions > 0 ? t.cost / t.conversions : 0;
          const pCpl = pt.conversions > 0 ? pt.cost / pt.conversions : 0;
          const convRate = t.clicks > 0 ? t.conversions / t.clicks : 0;
          const pConvRate = pt.clicks > 0 ? pt.conversions / pt.clicks : 0;

          setKpiChanges({
            clicks: calcChange(t.clicks, pt.clicks),
            impressions: calcChange(t.impressions, pt.impressions),
            ctr: calcChange(t.ctr, pt.ctr),
            cost: calcChange(t.cost, pt.cost),
            costPerConversion: calcChange(cpl, pCpl),
            convRate: calcChange(convRate, pConvRate),
            cpc: calcChange(t.cpc, pt.cpc),
            conversions: calcChange(t.conversions, pt.conversions),
          });
        } catch { setKpiChanges(null); }
      }

      setKeywords(await parseBreakdown(kwRes));
      setSearchTerms(await parseBreakdown(stRes));
      setGeoData(await parseBreakdown(geoRes));
      setAgeData(await parseBreakdown(ageRes));
      setGenderData(await parseBreakdown(genderRes));

      setLastRefreshed(new Date());
      startCooldown();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [adAccountId, dateRangeIndex, startCooldown]);

  useEffect(() => {
    fetchData();
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeIndex]);

  const handleDateRangeChange = useCallback((index: number) => {
    setDateRangeIndex((prev) => {
      if (index === prev) return prev;
      setCooldownRemaining(0);
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      return index;
    });
  }, []);

  return {
    campaigns,
    totals,
    dailyData,
    keywords,
    searchTerms,
    geoData,
    ageData,
    genderData,
    kpiChanges,
    loading,
    error,
    lastRefreshed,
    cooldownRemaining,
    dateRangeIndex,
    currentRange,
    handleDateRangeChange,
    fetchData,
  };
}

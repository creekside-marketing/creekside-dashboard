'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import KpiCard from '@/components/KpiCard';
import CampaignsTable from '@/components/CampaignsTable';
import ReportHeader, {
  DATE_RANGES,
  DEFAULT_RANGE_INDEX,
  computePriorPeriod,
  calcChange,
  fmt,
  fmtMoney,
  fmtPct,
} from './ReportHeader';
import ReportChart from './ReportChart';
import BreakdownTable from './BreakdownTable';
import ReportNotesTimeline from './ReportNotesTimeline';

// ── Types ────────────────────────────────────────────────────────────────

interface ReportingClient {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  monthly_budget: number | null;
  client_report_notes: string | null;
}

interface Campaign {
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

interface Totals {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cost: number;
  conversions: number;
}

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

const COOLDOWN_MS = 5 * 60 * 1000;

// ── Component ────────────────────────────────────────────────────────────

export default function LeadGenReport({
  client,
  mode,
}: {
  client: ReportingClient;
  mode: 'internal' | 'public';
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [totals, setTotals] = useState<Totals>({ impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0 });
  const [dailyData, setDailyData] = useState<Record<string, unknown>[]>([]);
  const [keywords, setKeywords] = useState<Record<string, unknown>[]>([]);
  const [searchTerms, setSearchTerms] = useState<Record<string, unknown>[]>([]);
  const [geoData, setGeoData] = useState<Record<string, unknown>[]>([]);
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
      const cid = encodeURIComponent(client.ad_account_id);
      const dr = range.googleParam;

      // Current period URLs
      const campaignUrl = `/api/google/insights?customer_id=${cid}&level=campaign&date_range=${dr}`;
      const accountUrl = `/api/google/insights?customer_id=${cid}&level=account&date_range=${dr}`;
      const keywordUrl = `/api/google/insights?customer_id=${cid}&level=keyword&date_range=${dr}`;
      const searchTermUrl = `/api/google/insights?customer_id=${cid}&level=search_term&date_range=${dr}`;
      const geoUrl = `/api/google/insights?customer_id=${cid}&level=geo&date_range=${dr}`;
      const ageUrl = `/api/google/insights?customer_id=${cid}&level=age&date_range=${dr}`;
      const genderUrl = `/api/google/insights?customer_id=${cid}&level=gender&date_range=${dr}`;

      // Prior period
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
      const rawData = campaignJson.data ?? campaignJson ?? [];
      const dataArr = Array.isArray(rawData) ? rawData : [];
      const normalized = dataArr.map(normalizeGoogleCampaign);
      setCampaigns(normalized);

      // Compute totals
      const t = normalized.reduce(
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
      setTotals(t);

      // Parse account-level daily data for charts
      if (accountRes.ok) {
        try {
          const accountJson = await accountRes.json();
          const rows = accountJson.data ?? [];
          if (Array.isArray(rows)) {
            const daily = rows.map((r: Record<string, unknown>) => ({
              date: r.date,
              impressions: Number(r.impressions ?? 0),
              clicks: Number(r.clicks ?? 0),
              ctr: Number(r.ctr ?? 0),
              cpc: Number(r.average_cpc ?? 0),
              cost: Number(r.cost ?? 0),
              conversions: Number(r.conversions ?? 0),
              costPerConversion: Number(r.cost_per_conversion ?? 0),
            })).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
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
          const priorNorm = priorArr.map(normalizeGoogleCampaign);
          const pt = priorNorm.reduce(
            (acc, c) => ({
              impressions: acc.impressions + c.impressions,
              clicks: acc.clicks + c.clicks,
              cost: acc.cost + c.cost,
              conversions: acc.conversions + c.conversions,
              ctr: 0, cpc: 0,
            }),
            { impressions: 0, clicks: 0, cost: 0, conversions: 0, ctr: 0, cpc: 0 }
          );
          pt.ctr = pt.impressions > 0 ? pt.clicks / pt.impressions : 0;
          pt.cpc = pt.clicks > 0 ? pt.cost / pt.clicks : 0;

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

      // Parse breakdown data
      const parseBreakdown = async (res: Response | null) => {
        if (!res?.ok) return [];
        try {
          const json = await res.json();
          return Array.isArray(json.data) ? json.data : [];
        } catch { return []; }
      };

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

  const costPerLead = totals.conversions > 0 ? totals.cost / totals.conversions : 0;
  const convRate = totals.clicks > 0 ? totals.conversions / totals.clicks : 0;

  const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
  const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
  const numCol = (v: unknown) => fmt(Number(v ?? 0));

  return (
    <div className="space-y-6">
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
          {/* ── Primary KPIs ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Clicks"
              value={fmt(totals.clicks)}
              change={kpiChanges?.clicks.pct}
              changeDirection={kpiChanges?.clicks.direction}
              changeSentiment="positive-up"
              size="lg"
            />
            <KpiCard
              label="Impressions"
              value={fmt(totals.impressions)}
              change={kpiChanges?.impressions.pct}
              changeDirection={kpiChanges?.impressions.direction}
              changeSentiment="positive-up"
              size="lg"
            />
            <KpiCard
              label="CTR"
              value={fmtPct(totals.ctr)}
              change={kpiChanges?.ctr.pct}
              changeDirection={kpiChanges?.ctr.direction}
              changeSentiment="positive-up"
              size="lg"
            />
            <KpiCard
              label="Total Cost"
              value={fmtMoney(totals.cost)}
              change={kpiChanges?.cost.pct}
              changeDirection={kpiChanges?.cost.direction}
              changeSentiment="neutral"
              size="lg"
            />
          </div>

          {/* ── Secondary KPIs ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="Cost / Conv."
              value={totals.conversions > 0 ? fmtMoney(costPerLead) : '--'}
              change={kpiChanges?.costPerConversion.pct}
              changeDirection={kpiChanges?.costPerConversion.direction}
              changeSentiment="negative-up"
              size="sm"
            />
            <KpiCard
              label="Conv. Rate"
              value={fmtPct(convRate)}
              change={kpiChanges?.convRate.pct}
              changeDirection={kpiChanges?.convRate.direction}
              changeSentiment="positive-up"
              size="sm"
            />
            <KpiCard
              label="Avg. CPC"
              value={fmtMoney(totals.cpc)}
              change={kpiChanges?.cpc.pct}
              changeDirection={kpiChanges?.cpc.direction}
              changeSentiment="negative-up"
              size="sm"
            />
            <KpiCard
              label="Conversions"
              value={fmt(totals.conversions)}
              change={kpiChanges?.conversions.pct}
              changeDirection={kpiChanges?.conversions.direction}
              changeSentiment="positive-up"
              size="sm"
            />
          </div>

          {/* ── Charts ────────────────────────────────────────────────── */}
          {dailyData.length > 0 && (
            <>
              <ReportChart
                title="Click-Through Rate & Impressions"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'clicks', label: 'Clicks', color: '#2563eb', yAxisId: 'left' },
                  { dataKey: 'ctr', label: 'CTR', color: '#10b981', yAxisId: 'right' },
                ]}
                formatY={(v) => v.toLocaleString()}
                formatYRight={(v) => `${(v * 100).toFixed(1)}%`}
              />

              <ReportChart
                title="Conversion Rate & Cost"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'cost', label: 'Cost', color: '#6366f1', type: 'bar', yAxisId: 'left' },
                  { dataKey: 'conversions', label: 'Conversions', color: '#f59e0b', yAxisId: 'right' },
                ]}
                formatY={(v) => `$${v.toLocaleString()}`}
                formatYRight={(v) => v.toFixed(0)}
              />

              <ReportChart
                title="Cost Per Click"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'cpc', label: 'Avg. CPC', color: '#2563eb' },
                ]}
                formatY={(v) => `$${v.toFixed(2)}`}
                height={250}
              />
            </>
          )}

          {/* ── Campaigns Table ────────────────────────────────────────── */}
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Campaigns</h2>
            <CampaignsTable campaigns={campaigns} platform="google" />
          </div>

          {/* ── Breakdown Tables ───────────────────────────────────────── */}
          {keywords.length > 0 && (
            <BreakdownTable
              title="Top Keywords"
              columns={[
                { key: 'keyword', label: 'Keyword' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Conv.', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Conv.', align: 'right', format: moneyCol },
              ]}
              data={keywords}
            />
          )}

          {searchTerms.length > 0 && (
            <BreakdownTable
              title="Top Search Terms"
              columns={[
                { key: 'search_term', label: 'Search Term' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Conv.', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Conv.', align: 'right', format: moneyCol },
              ]}
              data={searchTerms}
            />
          )}

          {geoData.length > 0 && (
            <BreakdownTable
              title="Location Breakdown"
              columns={[
                { key: 'city', label: 'City' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Conv.', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Conv.', align: 'right', format: moneyCol },
              ]}
              data={geoData}
            />
          )}

          {ageData.length > 0 && (
            <BreakdownTable
              title="Age Breakdown"
              columns={[
                { key: 'age_range', label: 'Age' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Conv.', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Conv.', align: 'right', format: moneyCol },
              ]}
              data={ageData}
            />
          )}

          {genderData.length > 0 && (
            <BreakdownTable
              title="Gender Breakdown"
              columns={[
                { key: 'gender', label: 'Gender' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Conv.', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Conv.', align: 'right', format: moneyCol },
              ]}
              data={genderData}
            />
          )}
        </>
      )}

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <ReportNotesTimeline clientId={client.id} mode={mode} />
    </div>
  );
}

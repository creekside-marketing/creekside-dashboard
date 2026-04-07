'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import KpiCard from '@/components/KpiCard';
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
  cpci: number;
  cpp: number;
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
  cpp: number;
}

// ── Meta action helpers ──────────────────────────────────────────────────

function getActionValue(actions: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!actions) return 0;
  const found = actions.find((a) => a.action_type === type);
  return found ? Math.round(Number(found.value) || 0) : 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEcomCampaign(row: any): EcomCampaign {
  const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
  const linkClicks = Number(row.inline_link_clicks ?? row.clicks ?? 0);
  const impressions = Number(row.impressions ?? 0);
  const spend = Number(row.spend ?? 0);
  const atc = getActionValue(actions, 'offsite_conversion.fb_pixel_add_to_cart');
  const checkouts = getActionValue(actions, 'offsite_conversion.fb_pixel_initiate_checkout');
  const purchases = getActionValue(actions, 'offsite_conversion.fb_pixel_purchase');

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
    cpp: purchases > 0 ? spend / purchases : 0,
  };
}

const COOLDOWN_MS = 5 * 60 * 1000;

// ── Component ────────────────────────────────────────────────────────────

export default function EcomReport({
  client,
  mode,
}: {
  client: ReportingClient;
  mode: 'internal' | 'public';
}) {
  const [campaigns, setCampaigns] = useState<EcomCampaign[]>([]);
  const [totals, setTotals] = useState<EcomTotals>({ impressions: 0, linkClicks: 0, lctr: 0, spend: 0, atc: 0, checkouts: 0, purchases: 0, cpci: 0, cpp: 0 });
  const [dailyData, setDailyData] = useState<Record<string, unknown>[]>([]);
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
        if (prev <= 1000) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
  }, []);

  // ── Parse daily account data for charts ────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseDailyRows(rows: any[]): Record<string, unknown>[] {
    return rows
      .map((row) => {
        const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
        return {
          date: row.date_start ?? row.date ?? '',
          atc: getActionValue(actions, 'offsite_conversion.fb_pixel_add_to_cart'),
          checkouts: getActionValue(actions, 'offsite_conversion.fb_pixel_initiate_checkout'),
          purchases: getActionValue(actions, 'offsite_conversion.fb_pixel_purchase'),
          spend: Number(row.spend ?? 0),
          impressions: Number(row.impressions ?? 0),
          linkClicks: Number(row.inline_link_clicks ?? row.clicks ?? 0),
        };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // ── Compute ecom totals from campaigns ─────────────────────────────────

  function computeTotals(campaigns: EcomCampaign[]): EcomTotals {
    const t = campaigns.reduce(
      (acc, c) => ({
        impressions: acc.impressions + c.impressions,
        linkClicks: acc.linkClicks + c.linkClicks,
        spend: acc.spend + c.spend,
        atc: acc.atc + c.atc,
        checkouts: acc.checkouts + c.checkouts,
        purchases: acc.purchases + c.purchases,
      }),
      { impressions: 0, linkClicks: 0, spend: 0, atc: 0, checkouts: 0, purchases: 0 }
    );
    return {
      ...t,
      lctr: t.impressions > 0 ? t.linkClicks / t.impressions : 0,
      cpci: t.checkouts > 0 ? t.spend / t.checkouts : 0,
      cpp: t.purchases > 0 ? t.spend / t.purchases : 0,
    };
  }

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

      // Current period
      const campaignUrl = `/api/meta/insights?account_id=${aid}&level=campaign&time_range=${tr}`;
      const accountUrl = `/api/meta/insights?account_id=${aid}&level=account&time_range=${tr}`;
      const adUrl = `/api/meta/insights?account_id=${aid}&level=ad&time_range=${tr}`;
      const ageUrl = `/api/meta/insights?account_id=${aid}&level=age&time_range=${tr}`;
      const genderUrl = `/api/meta/insights?account_id=${aid}&level=gender&time_range=${tr}`;

      // Prior period
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

      // Parse daily data for charts
      if (accountRes.ok) {
        try {
          let accountJson = await accountRes.json();
          accountJson = unwrapPipeboardResponse(accountJson);
          const rows = accountJson.data ?? accountJson ?? [];
          if (Array.isArray(rows)) {
            setDailyData(parseDailyRows(rows));
          }
        } catch { /* optional */ }
      }

      // Parse prior period for KPI changes
      if (priorRes.ok) {
        try {
          let priorJson = await priorRes.json();
          priorJson = unwrapPipeboardResponse(priorJson);
          const priorRaw = priorJson.data ?? priorJson ?? [];
          const priorArr = Array.isArray(priorRaw) ? priorRaw : [];
          const priorNorm = priorArr.map(normalizeEcomCampaign);
          const pt = computeTotals(priorNorm);

          setKpiChanges({
            linkClicks: calcChange(t.linkClicks, pt.linkClicks),
            impressions: calcChange(t.impressions, pt.impressions),
            lctr: calcChange(t.lctr, pt.lctr),
            spend: calcChange(t.spend, pt.spend),
            checkouts: calcChange(t.checkouts, pt.checkouts),
            cpci: calcChange(t.cpci, pt.cpci),
            purchases: calcChange(t.purchases, pt.purchases),
            cpp: calcChange(t.cpp, pt.cpp),
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

  const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
  const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
  const numCol = (v: unknown) => fmt(Number(v ?? 0));
  const nullMoney = (v: unknown) => { const n = Number(v ?? 0); return n > 0 ? fmtMoney(n) : '--'; };

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
              label="Link Clicks"
              value={fmt(totals.linkClicks)}
              change={kpiChanges?.linkClicks.pct}
              changeDirection={kpiChanges?.linkClicks.direction}
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
              label="LC-CTR"
              value={fmtPct(totals.lctr)}
              change={kpiChanges?.lctr.pct}
              changeDirection={kpiChanges?.lctr.direction}
              changeSentiment="positive-up"
              size="lg"
            />
            <KpiCard
              label="Amount Spent"
              value={fmtMoney(totals.spend)}
              change={kpiChanges?.spend.pct}
              changeDirection={kpiChanges?.spend.direction}
              changeSentiment="neutral"
              size="lg"
            />
          </div>

          {/* ── Ecom KPIs ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="Checkouts Initiated"
              value={fmt(totals.checkouts)}
              change={kpiChanges?.checkouts.pct}
              changeDirection={kpiChanges?.checkouts.direction}
              changeSentiment="positive-up"
              size="sm"
            />
            <KpiCard
              label="CPCI"
              value={totals.checkouts > 0 ? fmtMoney(totals.cpci) : '--'}
              change={kpiChanges?.cpci.pct}
              changeDirection={kpiChanges?.cpci.direction}
              changeSentiment="negative-up"
              size="sm"
            />
            <KpiCard
              label="Purchases"
              value={fmt(totals.purchases)}
              change={kpiChanges?.purchases.pct}
              changeDirection={kpiChanges?.purchases.direction}
              changeSentiment="positive-up"
              size="sm"
            />
            <KpiCard
              label="Cost Per Purchase"
              value={totals.purchases > 0 ? fmtMoney(totals.cpp) : '--'}
              change={kpiChanges?.cpp.pct}
              changeDirection={kpiChanges?.cpp.direction}
              changeSentiment="negative-up"
              size="sm"
            />
          </div>

          {/* ── Charts ────────────────────────────────────────────────── */}
          {dailyData.length > 0 && (
            <>
              <ReportChart
                title="Add to Carts by Date"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'atc', label: 'Add to Carts', color: '#8b5cf6' },
                ]}
                formatY={(v) => v.toFixed(0)}
                height={250}
              />

              <ReportChart
                title="Checkouts Initiated by Date"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'checkouts', label: 'Checkouts', color: '#2563eb' },
                ]}
                formatY={(v) => v.toFixed(0)}
                height={250}
              />

              <ReportChart
                title="Purchases by Date"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'purchases', label: 'Purchases', color: '#10b981' },
                ]}
                formatY={(v) => v.toFixed(0)}
                height={250}
              />

              <ReportChart
                title="Spend & Purchases"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'spend', label: 'Spend', color: '#6366f1', type: 'bar', yAxisId: 'left' },
                  { dataKey: 'purchases', label: 'Purchases', color: '#f59e0b', yAxisId: 'right' },
                ]}
                formatY={(v) => `$${v.toLocaleString()}`}
                formatYRight={(v) => v.toFixed(0)}
              />
            </>
          )}

          {/* ── Campaigns Table ────────────────────────────────────────── */}
          <BreakdownTable
            title="Campaigns Overview"
            columns={[
              { key: 'name', label: 'Campaign' },
              { key: 'impressions', label: 'Impr.', align: 'right', format: numCol },
              { key: 'linkClicks', label: 'Clicks', align: 'right', format: numCol },
              { key: 'lctr', label: 'LC-CTR', align: 'right', format: pctCol },
              { key: 'spend', label: 'Spent', align: 'right', format: moneyCol },
              { key: 'atc', label: 'ATC', align: 'right', format: numCol },
              { key: 'cpa2c', label: 'CPA2C', align: 'right', format: nullMoney },
              { key: 'checkouts', label: 'Checkouts', align: 'right', format: numCol },
              { key: 'cpci', label: 'CPCI', align: 'right', format: nullMoney },
              { key: 'purchases', label: 'Purchases', align: 'right', format: numCol },
              { key: 'cpp', label: 'CPP', align: 'right', format: nullMoney },
            ]}
            data={campaigns}
            maxRows={15}
          />

          {/* ── Ads Overview ───────────────────────────────────────────── */}
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
                const actions = ((row as Record<string, unknown>).actions ?? []) as Array<{ action_type: string; value: string }>;
                const purchases = getActionValue(actions, 'offsite_conversion.fb_pixel_purchase');
                const spend = Number((row as Record<string, unknown>).spend ?? 0);
                return {
                  ...row,
                  purchases,
                  cpp: purchases > 0 ? spend / purchases : 0,
                };
              })}
              maxRows={15}
            />
          )}

          {/* ── Age & Gender ───────────────────────────────────────────── */}
          {ageData.length > 0 && (
            <BreakdownTable
              title="Age Overview"
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
              title="Gender Overview"
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
        </>
      )}

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <ReportNotes
        clientId={client.id}
        initialNotes={client.client_report_notes ?? ''}
        mode={mode}
      />
    </div>
  );
}

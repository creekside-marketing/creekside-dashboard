'use client';

/**
 * Custom report for South River Mortgage (Google).
 * Manually branched from LeadGenGoogleReport.tsx (imports shared leaf
 * components directly from ../ rather than a copied _slug/ folder).
 *
 * Customization: adds a highlighted "Pricing Qualified Leads" primary-KPI
 * section at the top. PQL is tracked SOLELY from the Google Ads conversion
 * action named "Pricing Qualified - Realtime (JT)" (per Peterson, 2026-05).
 * The count and Cost per PQL are computed live from the account-level
 * conversionBreakdown for the selected date range, with week-over-week
 * comparison against the prior period.
 *
 * CANNOT: Modify ad account settings or budgets.
 * CANNOT: Write to any API — read-only data fetching.
 * CANNOT: Display Meta Ads data — Google Ads only.
 */

import { useEffect, useState } from 'react';
import CampaignsTable from '@/components/CampaignsTable';
import ReportHeader, {
  DATE_RANGES,
  fmt,
  fmtMoney,
  fmtPct,
  computePriorPeriod,
  calcChange,
} from '../ReportHeader';
import ReportChart from '../ReportChart';
import BreakdownTable from '../BreakdownTable';
import ReportNotesTimeline from '../ReportNotesTimeline';
import { SparklineKpiCard, DemographicChart } from '../shared';
import { useGoogleAdsData } from '@/hooks/useGoogleAdsData';
import { ReportingClient } from '../types';

// ── Constants ──────────────────────────────────────────────────────────────

/** The ONLY conversion action counted as a Pricing Qualified Lead. */
const PQL_ACTION_NAME = 'Pricing Qualified - Realtime (JT)';

// ── Helpers ──────────────────────────────────────────────────────────────

const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
const numCol = (v: unknown) => fmt(Number(v ?? 0));

/**
 * Merges separate age and gender API responses into AgeGenderRow format
 * for DemographicChart. Distributes age-level clicks by the global
 * male/female ratio from the gender dataset.
 */
function mergeAgeGenderData(
  ageRows: Record<string, unknown>[],
  genderRows: Record<string, unknown>[],
): { ageRange: string; male: number; female: number }[] {
  const totalByGender: Record<string, number> = {};
  let totalClicks = 0;
  for (const row of genderRows) {
    const gender = String(row.gender ?? '').toLowerCase();
    const clicks = Number(row.clicks ?? 0);
    totalByGender[gender] = (totalByGender[gender] ?? 0) + clicks;
    totalClicks += clicks;
  }
  const maleRatio = totalClicks > 0 ? (totalByGender['male'] ?? 0) / totalClicks : 0.5;
  const femaleRatio = totalClicks > 0 ? (totalByGender['female'] ?? 0) / totalClicks : 0.5;

  return ageRows.map((row) => {
    const clicks = Number(row.clicks ?? 0);
    return {
      ageRange: String(row.age_range ?? 'Unknown'),
      male: Math.round(clicks * maleRatio),
      female: Math.round(clicks * femaleRatio),
    };
  });
}

// ── PQL data fetching ──────────────────────────────────────────────────────

interface PqlState {
  current: number;
  prior: number;
  costCurrent: number;
  costPrior: number;
  loading: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractPql(json: any): number {
  const breakdown = Array.isArray(json?.conversionBreakdown) ? json.conversionBreakdown : [];
  const row = breakdown.find(
    (x: any) => String(x?.name ?? '').trim() === PQL_ACTION_NAME,
  );
  return row ? Number(row.conversions ?? 0) : 0;
}

function extractCost(json: any): number {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows.reduce((sum: number, r: any) => sum + Number(r?.cost ?? 0), 0);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetches the PQL conversion-action count and spend for the current and
 * prior periods of the selected date range. Self-contained so the rest of
 * the report's data flow is untouched.
 */
function usePqlData(adAccountId: string | null, dateRangeIndex: number): PqlState {
  const [state, setState] = useState<PqlState>({
    current: 0,
    prior: 0,
    costCurrent: 0,
    costPrior: 0,
    loading: true,
  });

  useEffect(() => {
    if (!adAccountId) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      try {
        const cid = encodeURIComponent(adAccountId);
        const p = computePriorPeriod(dateRangeIndex);
        const currentUrl = `/api/google/insights?customer_id=${cid}&level=account&since=${p.currentSince}&until=${p.currentUntil}`;
        const priorUrl = `/api/google/insights?customer_id=${cid}&level=account&since=${p.priorSince}&until=${p.priorUntil}`;

        const [curRes, priRes] = await Promise.all([
          fetch(currentUrl),
          fetch(priorUrl),
        ]);

        const cur = curRes.ok ? await curRes.json() : {};
        const pri = priRes.ok ? await priRes.json() : {};

        if (cancelled) return;
        setState({
          current: extractPql(cur),
          prior: extractPql(pri),
          costCurrent: extractCost(cur),
          costPrior: extractCost(pri),
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setState({ current: 0, prior: 0, costCurrent: 0, costPrior: 0, loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adAccountId, dateRangeIndex]);

  return state;
}

// ── Component ────────────────────────────────────────────────────────────

export default function SouthRiverMortgageGoogleReport({
  client,
  mode,
}: {
  client: ReportingClient;
  mode: 'internal' | 'public';
}) {
  const data = useGoogleAdsData(client.ad_account_id);
  const {
    campaigns, totals, dailyData, keywords,
    geoData, ageData, genderData, kpiChanges,
    loading, error, lastRefreshed, cooldownRemaining,
    dateRangeIndex, currentRange, handleDateRangeChange, fetchData,
  } = data;

  // ── PQL primary KPI (custom) ───────────────────────────────────────────
  const pqlData = usePqlData(client.ad_account_id, dateRangeIndex);
  const pqlCount = pqlData.current;
  const pqlPrior = pqlData.prior;
  const pqlChange = calcChange(pqlCount, pqlPrior);
  const costPerPql = pqlCount > 0 ? pqlData.costCurrent / pqlCount : 0;
  const costPerPqlPrior = pqlPrior > 0 ? pqlData.costPrior / pqlPrior : 0;
  const costPerPqlChange = calcChange(costPerPql, costPerPqlPrior);

  // ── Derived values ───────────────────────────────────────────────────

  const costPerLead = totals.conversions > 0 ? totals.cost / totals.conversions : 0;
  const convRate = totals.clicks > 0 ? totals.conversions / totals.clicks : 0;

  // Days elapsed in current period — used for targetCpl pacing
  const daysElapsed = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const label = DATE_RANGES[dateRangeIndex].label;
    if (label === 'This Month') return Math.max(Math.floor((today.getTime() - new Date(today.getFullYear(), today.getMonth(), 1).getTime()) / 86400000), 1);
    if (label === 'Last Month') return new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    return label === '7d' ? 7 : label === '14d' ? 14 : 30;
  })();

  const sparkConversions = dailyData.map((d) => d.conversions);
  const sparkCpl = dailyData.map((d) => d.conversions > 0 ? d.cost / d.conversions : 0);
  const sparkCost = dailyData.map((d) => d.cost);
  const sparkConvRate = dailyData.map((d) => d.clicks > 0 ? d.conversions / d.clicks : 0);
  const sparkCpc = dailyData.map((d) => d.cpc);

  const targetCpl = client.monthly_budget && totals.conversions > 0
    ? client.monthly_budget / Math.max(totals.conversions * (30 / Math.max(daysElapsed, 1)), 1)
    : undefined;

  // ── Render ───────────────────────────────────────────────────────────

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
                value={pqlData.loading ? '…' : fmt(pqlCount)}
                change={pqlData.loading ? undefined : pqlChange.pct}
                changeDirection={pqlChange.direction}
                changeSentiment="positive-up"
                size="lg"
              />
              <SparklineKpiCard
                label="Cost per Pricing Qualified Lead"
                value={pqlData.loading ? '…' : pqlCount > 0 ? fmtMoney(costPerPql) : '--'}
                change={pqlData.loading ? undefined : costPerPqlChange.pct}
                changeDirection={costPerPqlChange.direction}
                changeSentiment="negative-up"
                size="lg"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-3">
              Counts only the &ldquo;{PQL_ACTION_NAME}&rdquo; conversion action. Recent days may rise as conversions finish attributing.
            </p>
          </div>

          {/* 2. Executive Summary KPIs — 5 SparklineKpiCards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <SparklineKpiCard
              label="Total Leads"
              value={fmt(totals.conversions)}
              change={kpiChanges?.conversions.pct}
              changeDirection={kpiChanges?.conversions.direction}
              changeSentiment="positive-up"
              size="lg"
              sparklineData={sparkConversions}
            />
            <SparklineKpiCard
              label="Cost Per Lead"
              value={totals.conversions > 0 ? fmtMoney(costPerLead) : '--'}
              change={kpiChanges?.costPerConversion.pct}
              changeDirection={kpiChanges?.costPerConversion.direction}
              changeSentiment="negative-up"
              size="lg"
              sparklineData={sparkCpl}
              target={targetCpl}
            />
            <SparklineKpiCard
              label="Total Spend"
              value={fmtMoney(totals.cost)}
              change={kpiChanges?.cost.pct}
              changeDirection={kpiChanges?.cost.direction}
              changeSentiment="neutral"
              size="lg"
              sparklineData={sparkCost}
            />
            <SparklineKpiCard
              label="Conv. Rate"
              value={fmtPct(convRate)}
              change={kpiChanges?.convRate.pct}
              changeDirection={kpiChanges?.convRate.direction}
              changeSentiment="positive-up"
              size="lg"
              sparklineData={sparkConvRate}
            />
            <SparklineKpiCard
              label="Avg CPC"
              value={fmtMoney(totals.cpc)}
              change={kpiChanges?.cpc.pct}
              changeDirection={kpiChanges?.cpc.direction}
              changeSentiment="negative-up"
              size="lg"
              sparklineData={sparkCpc}
            />
          </div>

          {/* 3. Lead Volume & Cost Trend */}
          {dailyData.length > 0 && (
            <>
              <ReportChart
                title="Lead Volume & Cost Trend"
                data={dailyData.map((d) => ({
                  ...d,
                  cpl: d.conversions > 0 ? d.cost / d.conversions : 0,
                }))}
                xKey="date"
                lines={[
                  { dataKey: 'conversions', label: 'Leads', color: '#10B981', type: 'bar', yAxisId: 'left' },
                  { dataKey: 'cpl', label: 'CPL', color: '#8B5CF6', yAxisId: 'right' },
                ]}
                formatY={(v) => v.toFixed(0)}
                formatYRight={(v) => `$${v.toFixed(0)}`}
              />

            </>
          )}

          {/* 6. Campaign Performance */}
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Campaigns</h2>
            <CampaignsTable campaigns={campaigns} platform="google" />
          </div>

          {/* 8. Top Keywords */}
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

          {/* Demographics — side by side */}
          {(ageData.length > 0 || genderData.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {ageData.length > 0 && genderData.length > 0 ? (
                <DemographicChart
                  title="Age & Gender Breakdown"
                  type="age-gender"
                  data={mergeAgeGenderData(ageData, genderData)}
                />
              ) : ageData.length > 0 ? (
                <BreakdownTable
                  title="Age Breakdown"
                  columns={[
                    { key: 'age_range', label: 'Age' },
                    { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                    { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                    { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                    { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                    { key: 'conversions', label: 'Conv.', align: 'right', format: numCol },
                  ]}
                  data={ageData}
                />
              ) : null}

              {genderData.length > 0 && (
                <BreakdownTable
                  title="Gender Breakdown"
                  columns={[
                    { key: 'gender', label: 'Gender' },
                    { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                    { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                    { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                    { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                    { key: 'conversions', label: 'Conv.', align: 'right', format: numCol },
                    { key: 'cost_per_conversion', label: 'Cost / Conv.', align: 'right', format: moneyCol },
                  ]}
                  data={genderData}
                />
              )}
            </div>
          )}

          {/* 11. Location Breakdown */}
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

        </>
      )}

      {/* 13. Notes */}
      <ReportNotesTimeline clientId={client.id} mode={mode} />
    </div>
  );
}

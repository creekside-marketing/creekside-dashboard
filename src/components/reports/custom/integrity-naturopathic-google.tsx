'use client';

/**
 * Branched from LeadGenGoogleReport.tsx for Integrity Naturopathic.
 * Standalone per-client fork — upstream template changes do NOT auto-propagate.
 *
 * Sub-components (ReportHeader, ReportChart, BreakdownTable, shared/*) are
 * imported from the shared template directory rather than copied, so styling
 * and chart fixes still reach this report. Only the report body is forked.
 */

/**
 * IntegrityNaturopathicGoogleReport — Lead Gen Google Ads report with a
 * Booked Consultations panel.
 *
 * Adds, on top of the shared lead-gen template:
 * - A Booked Consultations panel sourced from the offline "Booked" conversion
 *   action that FirstUp imports into Google Ads, with an explicit disclaimer
 *   that phone-call bookings are not matched and offline data backfills.
 *
 * CANNOT: Modify ad account settings or budgets.
 * CANNOT: Write to any API — read-only data fetching.
 * CANNOT: Display Meta Ads data — Google Ads only.
 */

import { useEffect, useState } from 'react';
import CampaignsTable from '@/components/CampaignsTable';
import ReportHeader, { DATE_RANGES, computePriorPeriod, fmt, fmtMoney, fmtPct } from '../ReportHeader';
import ReportChart from '../ReportChart';
import BreakdownTable from '../BreakdownTable';
import ReportNotesTimeline from '../ReportNotesTimeline';
import {
  SparklineKpiCard,
  DemographicChart,
} from '../shared';
import { useGoogleAdsData } from '@/hooks/useGoogleAdsData';
import { ReportingClient } from '../types';
import ReferralBanner from '../shared/ReferralBanner';

/**
 * Google Ads conversion action(s) that represent a booked consultation.
 * These are offline conversions imported from the client's CRM by FirstUp.
 * Hardcoded per-client, matching the pattern used by south-river-mortgage-google.
 */
const BOOKED_ACTION_NAMES = ['FirstUp - Offline Conversion - Qualified Lead - Booked'];

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

// ── Component ────────────────────────────────────────────────────────────

export default function IntegrityNaturopathicGoogleReport({
  client,
  mode,
}: {
  client: ReportingClient;
  mode: 'internal' | 'public';
}) {
  const data = useGoogleAdsData(client.ad_account_id);
  const {
    campaigns, totals, dailyData, keywords, searchTerms,
    geoData, ageData, genderData, kpiChanges,
    loading, error, lastRefreshed, cooldownRemaining,
    dateRangeIndex, currentRange, customSince, customUntil,
    handleDateRangeChange, handleCustomDateApply, fetchData,
  } = data;

  // ── Derived values ───────────────────────────────────────────────────

  const costPerLead = totals.conversions > 0 ? totals.cost / totals.conversions : 0;
  const convRate = totals.clicks > 0 ? totals.conversions / totals.clicks : 0;

  // Days elapsed in current period — used for targetCpl pacing
  const daysElapsed = (() => {
    if (customSince && customUntil) {
      return Math.max(Math.round((new Date(customUntil).getTime() - new Date(customSince).getTime()) / 86400000) + 1, 1);
    }
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

  // ── Booked consultations ─────────────────────────────────────────────
  // The account-level endpoint already returns `conversionBreakdown` (totals
  // per conversion action). We re-request it here rather than changing the
  // shared hook, keeping this fork fully self-contained.
  const [bookedCount, setBookedCount] = useState(0);

  useEffect(() => {
    const cid = client.ad_account_id;
    const period = (customSince && customUntil)
      ? { currentSince: customSince, currentUntil: customUntil }
      : computePriorPeriod(dateRangeIndex);

    let cancelled = false;
    (async () => {
      if (!cid) {
        if (!cancelled) setBookedCount(0);
        return;
      }
      try {
        const res = await fetch(
          `/api/google/insights?customer_id=${encodeURIComponent(cid)}&level=account` +
          `&since=${period.currentSince}&until=${period.currentUntil}`,
        );
        if (!res.ok) return;
        const json = await res.json();
        const rows: Array<{ name?: string; conversions?: number }> = json?.conversionBreakdown ?? [];
        const total = rows
          .filter((r) => BOOKED_ACTION_NAMES.includes(String(r.name ?? '')))
          .reduce((sum, r) => sum + Number(r.conversions ?? 0), 0);
        if (!cancelled) setBookedCount(total);
      } catch {
        if (!cancelled) setBookedCount(0);
      }
    })();

    return () => { cancelled = true; };
  }, [client.ad_account_id, dateRangeIndex, customSince, customUntil, lastRefreshed]);

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
        customSince={customSince}
        customUntil={customUntil}
        onCustomDateApply={handleCustomDateApply}
      />

      <ReferralBanner />

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

          {/* 2b. Booked Consultations */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Booked Consultations
                </h2>
                <p className="text-xs text-slate-400 mt-1">Google Ads form leads only</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-semibold text-slate-900 tabular-nums leading-none">
                  {fmt(bookedCount)}
                </div>
                {totals.conversions > 0 && (
                  <div className="text-xs text-slate-400 mt-1.5">
                    {fmtPct(bookedCount / totals.conversions)} of total leads
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mt-4 pt-4 border-t border-slate-100">
              This counts consultations booked by people who came in through a Google Ads
              form submission. Phone calls generated by the ads cannot be matched to a
              booking yet, so your real booked total is higher than the number shown here.
              Bookings are also imported after the appointment is set, so the most recent
              days fill in over time.
            </p>
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
// test

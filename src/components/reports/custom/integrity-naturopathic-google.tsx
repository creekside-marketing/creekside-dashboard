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
 * IntegrityNaturopathicGoogleReport — Lead Gen Google Ads report with
 * Booked Consultations and Phone Calls panels.
 *
 * Adds, on top of the shared lead-gen template:
 * - A Booked Consultations panel sourced from the offline "Booked" conversion
 *   action that FirstUp imports into Google Ads, with an explicit disclaimer
 *   that phone bookings are not matched and offline data backfills.
 * - A Phone Calls panel summing the two conversion actions that make up
 *   Google's own "Phone call lead" goal, so the number reconciles 1:1 with
 *   what the client sees in the Google Ads UI.
 *
 * Both panels are derived from a single /api/google/insights response behind
 * one window guard, so they can never show numbers from different date ranges.
 *
 * CANNOT: Modify ad account settings or budgets.
 * CANNOT: Write to any API — read-only data fetching.
 * CANNOT: Display Meta Ads data — Google Ads only.
 */

import { useEffect, useMemo, useState } from 'react';
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

/**
 * Google Ads conversion actions representing a real phone call driven by the
 * ads. These are exactly the two actions inside Google's own "Phone call lead"
 * goal, so this panel reconciles 1:1 with the Google Ads UI.
 *
 * Deliberately EXCLUDED:
 * - "Clicks to call" and the "Local actions - *" set. Those are Google Business
 *   Profile interactions, not ad-driven calls, and Google itself leaves them out
 *   of the primary conversion total.
 * - "FirstUp - Offline Conversion - Calls From Funnel". That is the CRM-side
 *   import of these same calls; counting it here would double count.
 */
const CALL_ACTION_NAMES = ['Calls from ads', 'Calls from Website'];

/** Sums `conversions` across every breakdown row whose name is in `names`. */
function sumActions(
  rows: Array<{ name?: string; conversions?: number }>,
  names: readonly string[],
): number {
  return rows
    .filter((r) => names.includes(String(r.name ?? '')))
    .reduce((sum, r) => sum + Number(r.conversions ?? 0), 0);
}

// ── Helpers ──────────────────────────────────────────────────────────────

const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
const numCol = (v: unknown) => fmt(Number(v ?? 0));


/**
 * One headline-number panel. Shared by Booked Consultations and Phone Calls so
 * the two stay visually identical and only their copy differs.
 *
 * `count` is a three-state value: undefined while the current window is still
 * loading, null when its request failed, a number otherwise. Rounded on render
 * because Google reports modelled call conversions as fractions.
 */
function ConversionPanel({
  title, subtitle, count, totalLeads, note, loadingLabel,
}: {
  title: string;
  subtitle: string;
  count: number | null | undefined;
  totalLeads: number;
  note: string;
  loadingLabel: string;
}) {
  // Round ONCE and drive both the headline and the percentage off the same
  // value. Deriving the percentage from the raw figure instead produced
  // "0" sitting next to "0.04% of total leads" on a window where the offline
  // import had modelled 0.029 conversions.
  const shown = typeof count === 'number' ? Math.round(count) : count;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</h2>
          <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
        </div>
        <div className="text-right">
          {shown === undefined ? (
            <div
              className="h-[30px] w-12 ml-auto rounded-md bg-slate-100 animate-pulse"
              aria-label={loadingLabel}
            />
          ) : shown === null ? (
            <div className="text-sm font-medium text-slate-400 leading-[30px]">Unavailable</div>
          ) : (
            <>
              <div className="text-3xl font-semibold text-slate-900 tabular-nums leading-none">
                {fmt(shown)}
              </div>
              {totalLeads > 0 && (
                <div className="text-xs text-slate-400 mt-1.5">
                  {fmtPct(shown / totalLeads)} of total leads
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mt-4 pt-4 border-t border-slate-100">
        {note}
      </p>
    </div>
  );
}

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
  //
  // The count is stored with the exact window it was fetched for and is only
  // displayed when that window matches the one on screen, so a previous
  // range's number can never be shown as if it belonged to the current one.
  const panelKey = useMemo(() => {
    if (customSince && customUntil) return `${customSince}|${customUntil}`;
    const p = computePriorPeriod(dateRangeIndex);
    return `${p.currentSince}|${p.currentUntil}`;
  }, [customSince, customUntil, dateRangeIndex]);

  // A null count means the request for that window failed. Booked and calls
  // are read off the SAME response, so the two panels can never disagree about
  // which date range they are describing.
  const [panel, setPanel] = useState<
    { key: string; booked: number | null; calls: number | null } | null
  >(null);

  // Bumped only by the manual Refresh button. Deliberately NOT the shared
  // hook's lastRefreshed: that also changes the moment the rest of the report
  // finishes loading, which cancelled this panel's in-flight request and left
  // the previous range's number on screen for several seconds.
  const [panelRefreshNonce, setPanelRefreshNonce] = useState(0);

  useEffect(() => {
    const cid = client.ad_account_id;
    const [since, until] = panelKey.split('|');
    let cancelled = false;

    (async () => {
      let booked: number | null = null;
      let calls: number | null = null;
      if (cid) {
        try {
          const res = await fetch(
            `/api/google/insights?customer_id=${encodeURIComponent(cid)}&level=account` +
            `&since=${since}&until=${until}`,
          );
          if (res.ok) {
            const json = await res.json();
            const rows: Array<{ name?: string; conversions?: number }> = json?.conversionBreakdown ?? [];
            booked = sumActions(rows, BOOKED_ACTION_NAMES);
            calls = sumActions(rows, CALL_ACTION_NAMES);
          }
        } catch {
          booked = null;
          calls = null;
        }
      }
      if (!cancelled) setPanel({ key: panelKey, booked, calls });
    })();

    return () => { cancelled = true; };
  }, [client.ad_account_id, panelKey, panelRefreshNonce]);

  // undefined = still loading this window, null = failed, number = result.
  const bookedCount = panel?.key === panelKey ? panel.booked : undefined;
  const callCount = panel?.key === panelKey ? panel.calls : undefined;

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
        onRefresh={() => { setPanelRefreshNonce((n) => n + 1); fetchData(); }}
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

          {/* 2b. Booked Consultations & Phone Calls */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ConversionPanel
              title="Booked Consultations"
              subtitle="Google Ads form leads only"
              count={bookedCount}
              totalLeads={totals.conversions}
              loadingLabel="Loading booked consultations"
              note="Consultations booked by people who arrived through a Google Ads form submission. Consultations booked over the phone are not included here; those calls are counted in the Phone Calls panel. Bookings are imported from the CRM after the appointment is set, so the most recent days fill in over the following days."
            />
            <ConversionPanel
              title="Phone Calls"
              subtitle="Calls driven by Google Ads"
              count={callCount}
              totalLeads={totals.conversions}
              loadingLabel="Loading phone calls"
              note="Phone calls generated by your ads, counted the same way Google counts them under its Phone call lead goal: calls placed directly from an ad, plus calls to the tracking number on your website. Taps on your Google Business Profile, such as directions or website visits, are not included."
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
// test

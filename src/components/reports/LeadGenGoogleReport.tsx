'use client';

/**
 * LeadGenGoogleReport — Upgraded Lead Gen report for Google Ads clients.
 *
 * Replaces the original LeadGenReport with richer visualizations:
 * - SparklineKpiCards with inline trend lines
 * - BudgetPacingGauge for spend pacing
 * - FunnelChart (Impressions -> Clicks -> Conversions)
 * - InsightsBlock with auto-generated data-driven insights
 * - DemographicChart for age/gender breakdowns
 *
 * CANNOT: Modify ad account settings or budgets.
 * CANNOT: Write to any API — read-only data fetching.
 * CANNOT: Display Meta Ads data — Google Ads only.
 */

import CampaignsTable from '@/components/CampaignsTable';
import ReportHeader, { DATE_RANGES, fmt, fmtMoney, fmtPct } from './ReportHeader';
import ReportChart from './ReportChart';
import BreakdownTable from './BreakdownTable';
import ReportNotes from './ReportNotes';
import {
  SparklineKpiCard,
  FunnelChart,
  BudgetPacingGauge,
  InsightsBlock,
  DemographicChart,
} from './shared';
import { useGoogleAdsData, type Campaign, type Totals, type KpiChangeSet } from '@/hooks/useGoogleAdsData';

// ── Types ────────────────────────────────────────────────────────────────

interface ReportingClient {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  monthly_budget: number | null;
  client_report_notes: string | null;
}

type InsightEntry = { type: 'win' | 'concern' | 'action'; text: string };

// ── Helpers ──────────────────────────────────────────────────────────────

const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
const numCol = (v: unknown) => fmt(Number(v ?? 0));

function computePacingDays(rangeIndex: number): { daysElapsed: number; daysInPeriod: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const label = DATE_RANGES[rangeIndex].label;

  switch (label) {
    case '7d':
      return { daysElapsed: 7, daysInPeriod: 7 };
    case '14d':
      return { daysElapsed: 14, daysInPeriod: 14 };
    case '30d':
      return { daysElapsed: 30, daysInPeriod: 30 };
    case 'This Month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const elapsed = Math.max(Math.floor((today.getTime() - first.getTime()) / 86400000), 1);
      return { daysElapsed: elapsed, daysInPeriod: lastDay };
    }
    case 'Last Month': {
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
      return { daysElapsed: lastDay, daysInPeriod: lastDay };
    }
    default:
      return { daysElapsed: 30, daysInPeriod: 30 };
  }
}

function generateInsights(
  totals: Totals,
  kpiChanges: KpiChangeSet | null,
  campaigns: Campaign[],
  budget: number | null,
  spent: number,
  daysElapsed: number,
  daysInPeriod: number,
): InsightEntry[] {
  const insights: InsightEntry[] = [];
  const cpl = totals.conversions > 0 ? totals.cost / totals.conversions : 0;

  if (kpiChanges?.costPerConversion.direction === 'down' && kpiChanges.costPerConversion.pct !== '--') {
    insights.push({ type: 'win', text: `Cost per lead decreased ${kpiChanges.costPerConversion.pct} vs. prior period.` });
  }
  if (kpiChanges?.conversions.direction === 'up' && kpiChanges.conversions.pct !== '--') {
    insights.push({ type: 'win', text: `Lead volume increased ${kpiChanges.conversions.pct} vs. prior period (${fmt(totals.conversions)} total).` });
  }
  if (budget && daysInPeriod > 0) {
    const expectedPct = daysElapsed / daysInPeriod;
    const spentPct = spent / budget;
    if (spentPct > expectedPct * 1.2) {
      insights.push({ type: 'concern', text: `Spend is pacing ${((spentPct / expectedPct - 1) * 100).toFixed(0)}% above expected rate. Consider reducing daily budgets.` });
    }
  }
  const zeroCampaigns = campaigns.filter((c) => {
    const s = String(c.status ?? '').toLowerCase();
    return (s === 'active' || s === 'enabled') && c.conversions === 0 && c.cost > 100;
  });
  if (zeroCampaigns.length > 0) {
    const names = zeroCampaigns.slice(0, 3).map((c) => c.name).join(', ');
    insights.push({ type: 'concern', text: `${zeroCampaigns.length} active campaign(s) have $100+ spend with 0 conversions: ${names}.` });
  }
  if (cpl > 0 && kpiChanges?.costPerConversion.direction === 'up') {
    insights.push({ type: 'concern', text: `CPL rose to ${fmtMoney(cpl)} — review keyword bids and negative keyword list.` });
  }
  insights.push({ type: 'action', text: 'Review search term report for new negative keyword opportunities and bid adjustments in the next optimization cycle.' });

  return insights;
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

export default function LeadGenGoogleReport({
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
    dateRangeIndex, currentRange, handleDateRangeChange, fetchData,
  } = data;

  // ── Derived values ───────────────────────────────────────────────────

  const costPerLead = totals.conversions > 0 ? totals.cost / totals.conversions : 0;
  const convRate = totals.clicks > 0 ? totals.conversions / totals.clicks : 0;
  const { daysElapsed, daysInPeriod } = computePacingDays(dateRangeIndex);

  const sparkConversions = dailyData.map((d) => d.conversions);
  const sparkCpl = dailyData.map((d) => d.conversions > 0 ? d.cost / d.conversions : 0);
  const sparkCost = dailyData.map((d) => d.cost);
  const sparkConvRate = dailyData.map((d) => d.clicks > 0 ? d.conversions / d.clicks : 0);
  const sparkCpc = dailyData.map((d) => d.cpc);

  const targetCpl = client.monthly_budget && totals.conversions > 0
    ? client.monthly_budget / Math.max(totals.conversions * (30 / Math.max(daysElapsed, 1)), 1)
    : undefined;

  const insights = generateInsights(
    totals, kpiChanges, campaigns,
    client.monthly_budget, totals.cost, daysElapsed, daysInPeriod,
  );

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

          {/* 3. Budget Pacing */}
          {client.monthly_budget != null && client.monthly_budget > 0 && (
            <BudgetPacingGauge
              spent={totals.cost}
              budget={client.monthly_budget}
              daysElapsed={daysElapsed}
              daysInPeriod={daysInPeriod}
            />
          )}

          {/* 4. Lead Volume & Cost Trend */}
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

              {/* 5. Spend & Conversions */}
              <ReportChart
                title="Spend & Conversions"
                data={dailyData}
                xKey="date"
                lines={[
                  { dataKey: 'cost', label: 'Spend', color: '#3B82F6', type: 'bar', yAxisId: 'left' },
                  { dataKey: 'conversions', label: 'Conversions', color: '#F59E0B', yAxisId: 'right' },
                ]}
                formatY={(v) => `$${v.toLocaleString()}`}
                formatYRight={(v) => v.toFixed(0)}
              />
            </>
          )}

          {/* 6. Conversion Funnel */}
          {totals.impressions > 0 && (
            <FunnelChart
              title="Conversion Funnel"
              stages={[
                { label: 'Impressions', value: totals.impressions },
                { label: 'Clicks', value: totals.clicks },
                { label: 'Conversions', value: totals.conversions },
              ]}
            />
          )}

          {/* 7. Campaign Performance */}
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

          {/* 9. Top Search Terms */}
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

          {/* 10. Demographics — side by side */}
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

          {/* 12. Insights */}
          <InsightsBlock insights={insights} />
        </>
      )}

      {/* 13. Notes */}
      <ReportNotes
        clientId={client.id}
        initialNotes={client.client_report_notes ?? ''}
        mode={mode}
      />
    </div>
  );
}

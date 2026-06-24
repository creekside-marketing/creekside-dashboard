'use client';

/**
 * Custom report for South River Mortgage (Google).
 * Manually branched from LeadGenGoogleReport.tsx (imports shared leaf
 * components directly from ../ rather than a copied _slug/ folder).
 *
 * Customizations vs the shared lead-gen Google template:
 *  - Highlighted "Pricing Qualified Leads" primary-KPI section at the top.
 *    PQL is tracked SOLELY from the conversion action named
 *    "Pricing Qualified - Realtime (JT)" (per Peterson, single source of
 *    truth, no double-counting).
 *  - Every breakdown table (Keywords, Search Terms, Location, Age, Gender,
 *    and a dedicated Campaign PQL Performance table) shows both
 *    Cost per Lead (cost / total conversions) and Cost per PQL
 *    (cost / "Pricing Qualified - Realtime (JT)" conversions).
 *  - A new Search Terms table that the default template doesn't show.
 *
 * The per-row PQL data comes from the shared API's opt-in pql_action param
 * (additive; only fires when the param is set, so other clients are
 * unaffected). The shared CampaignsTable stays untouched; we add a separate
 * BreakdownTable below it for the PQL-focused per-campaign view.
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
import ReferralBanner from '../shared/ReferralBanner';
import ReportChart from '../ReportChart';
import BreakdownTable from '../BreakdownTable';
import ReportNotesTimeline from '../ReportNotesTimeline';
import { SparklineKpiCard, DemographicChart } from '../shared';
import { useGoogleAdsData } from '@/hooks/useGoogleAdsData';
import { ReportingClient } from '../types';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Conversion actions counted as a Pricing Qualified Lead.
 * All three are in the CONVERTED_LEAD goal category and primary_for_goal,
 * representing the pricing-qualified step and the two downstream stages
 * (Clear to Close → Funded). Per Peterson + Ahmed (2026-06).
 *
 * Note: a user who progresses through multiple stages is counted at each
 * stage, so total PQL volume is a weighted sum favouring campaigns that
 * drive downstream outcomes (Clear to Close, Funded). This is intentional
 * for weekly review reporting.
 */
const PQL_ACTION_NAMES: readonly string[] = [
  'Pricing Qualified - Realtime (JT)',
  'Clear to Close - JTC',
  'Funded (Offline-API) [JTC]',
] as const;
const PQL_ACTION_PARAM = PQL_ACTION_NAMES.join(',');
/** Short human-readable list for caption text in the UI. */
const PQL_ACTION_LABELS = 'Realtime (JT), Clear to Close (JTC), Funded (JTC)';

// ── Helpers ────────────────────────────────────────────────────────────────

const moneyCol = (v: unknown) => fmtMoney(Number(v ?? 0));
const pctCol = (v: unknown) => fmtPct(Number(v ?? 0));
const numCol = (v: unknown) => fmt(Number(v ?? 0));

/** Money formatter that shows "--" when the underlying numeric is 0/empty. */
const moneyOrDashCol = (v: unknown) => {
  const n = Number(v ?? 0);
  return n > 0 ? fmtMoney(n) : '--';
};

/** Integer formatter that shows "--" when the underlying numeric is 0/empty. */
const numOrDashCol = (v: unknown) => {
  const n = Number(v ?? 0);
  return n > 0 ? fmt(n) : '--';
};

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

// ── PQL data fetching (account-level, for the highlighted KPI block) ───────

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
  const wanted = new Set<string>(PQL_ACTION_NAMES);
  let total = 0;
  for (const row of breakdown) {
    const name = String(row?.name ?? '').trim();
    if (wanted.has(name)) total += Number(row?.conversions ?? 0);
  }
  return total;
}

function extractCost(json: any): number {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows.reduce((sum: number, r: any) => sum + Number(r?.cost ?? 0), 0);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetches the PQL conversion-action count and spend for the current and
 * prior periods of the selected date range.
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

// ── Per-dimension data with PQL columns ────────────────────────────────────

type Row = Record<string, unknown>;

interface DimensionsWithPql {
  keywords: Row[];
  searchTerms: Row[];
  geoData: Row[];
  ageData: Row[];
  genderData: Row[];
  campaigns: Row[];
  loading: boolean;
}

const EMPTY_DIMENSIONS: DimensionsWithPql = {
  keywords: [],
  searchTerms: [],
  geoData: [],
  ageData: [],
  genderData: [],
  campaigns: [],
  loading: true,
};

/**
 * Fetches each dimension's data with the pql_action param set, so every
 * returned row already includes `pql_conversions` and `cost_per_pql`.
 * This runs in parallel with (and shadows) the equivalent fetches inside
 * useGoogleAdsData — the hook's dimension data is ignored by this report
 * in favor of this PQL-augmented data.
 */
function useDimensionsWithPql(
  adAccountId: string | null,
  dateRangeIndex: number,
): DimensionsWithPql {
  const [state, setState] = useState<DimensionsWithPql>(EMPTY_DIMENSIONS);

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
        const action = encodeURIComponent(PQL_ACTION_PARAM);
        const range = DATE_RANGES[dateRangeIndex];
        const dr = range.googleParam;
        const base = `/api/google/insights?customer_id=${cid}&date_range=${dr}&pql_action=${action}`;

        const urls = {
          keyword: `${base}&level=keyword`,
          search_term: `${base}&level=search_term`,
          geo: `${base}&level=geo`,
          age: `${base}&level=age`,
          gender: `${base}&level=gender`,
          campaign: `${base}&level=campaign`,
        };

        const [kRes, sRes, gRes, aRes, geRes, cRes] = await Promise.all([
          fetch(urls.keyword).catch(() => null),
          fetch(urls.search_term).catch(() => null),
          fetch(urls.geo).catch(() => null),
          fetch(urls.age).catch(() => null),
          fetch(urls.gender).catch(() => null),
          fetch(urls.campaign).catch(() => null),
        ]);

        const parse = async (res: Response | null): Promise<Row[]> => {
          if (!res || !res.ok) return [];
          try {
            const j = await res.json();
            return Array.isArray(j?.data) ? (j.data as Row[]) : [];
          } catch {
            return [];
          }
        };

        const [keywords, searchTerms, geoData, ageData, genderData, campaigns] = await Promise.all([
          parse(kRes),
          parse(sRes),
          parse(gRes),
          parse(aRes),
          parse(geRes),
          parse(cRes),
        ]);

        if (cancelled) return;
        setState({ keywords, searchTerms, geoData, ageData, genderData, campaigns, loading: false });
      } catch {
        if (!cancelled) {
          setState({ ...EMPTY_DIMENSIONS, loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adAccountId, dateRangeIndex]);

  return state;
}

// ── Internal funnel-health data (INTERNAL MODE ONLY) ──────────────────────

/** Single conversion action whose name flags Pre-Qualified Leads.
 *  Per Peterson + Ahmed (2026-06): the "Pre-Qualified Lead" concept maps to
 *  the SUBMIT_LEAD_FORM action "Lead Instant Quote - (JTC)" — not the
 *  similarly-named "Pre-Qualified Lead" action that's being deprecated. */
const PREQ_ACTION_NAME = 'Lead Instant Quote - (JTC)';

interface InternalFunnelState {
  dailyActions: Array<{ date: string; action_name: string; conversions: number }>;
  dailyCost: Record<string, number>;
  perCampaignPreQ: Record<string, number>;
  accountPql: number;
  accountPreQ: number;
  accountCost: number;
  loading: boolean;
}

const EMPTY_FUNNEL: InternalFunnelState = {
  dailyActions: [],
  dailyCost: {},
  perCampaignPreQ: {},
  accountPql: 0,
  accountPreQ: 0,
  accountCost: 0,
  loading: false,
};

/**
 * Fetches the data needed for the internal Funnel Health sections:
 *   - daily Pre-Qualified and PQL counts (for the day-to-day chart)
 *   - daily account cost (to compute rolling cost-per-PQL)
 *   - per-campaign Pre-Qualified counts (for the funnel table; the PQL count
 *     and spend per campaign are already in useDimensionsWithPql)
 *   - account-level totals for the KPI block
 *
 * Only runs when `enabled` is true (i.e. mode === 'internal'). Public viewers
 * never trigger these fetches, so there is no extra Google Ads API quota cost
 * for client-facing report loads.
 */
function useInternalFunnelData(
  adAccountId: string | null,
  dateRangeIndex: number,
  enabled: boolean,
): InternalFunnelState {
  const [state, setState] = useState<InternalFunnelState>({ ...EMPTY_FUNNEL, loading: enabled });

  useEffect(() => {
    if (!enabled || !adAccountId) {
      setState({ ...EMPTY_FUNNEL, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      try {
        const cid = encodeURIComponent(adAccountId);
        const p = computePriorPeriod(dateRangeIndex);
        const actionsParam = encodeURIComponent(`${PQL_ACTION_PARAM},${PREQ_ACTION_NAME}`);
        const preqEncoded = encodeURIComponent(PREQ_ACTION_NAME);

        const accountUrl =
          `/api/google/insights?customer_id=${cid}&level=account` +
          `&since=${p.currentSince}&until=${p.currentUntil}` +
          `&daily_actions=${actionsParam}`;

        const campaignPreQUrl =
          `/api/google/insights?customer_id=${cid}&level=campaign` +
          `&since=${p.currentSince}&until=${p.currentUntil}` +
          `&pql_action=${preqEncoded}`;

        const [accountRes, campaignRes] = await Promise.all([
          fetch(accountUrl).catch(() => null),
          fetch(campaignPreQUrl).catch(() => null),
        ]);

        /* eslint-disable @typescript-eslint/no-explicit-any */
        const account: any = accountRes && accountRes.ok ? await accountRes.json() : {};
        const campaigns: any = campaignRes && campaignRes.ok ? await campaignRes.json() : {};
        /* eslint-enable @typescript-eslint/no-explicit-any */

        const dailyActions = Array.isArray(account?.dailyActionBreakdown)
          ? (account.dailyActionBreakdown as Array<{ date: string; action_name: string; conversions: number }>)
          : [];

        const dailyCost: Record<string, number> = {};
        let accountCost = 0;
        const accountData = Array.isArray(account?.data) ? account.data : [];
        for (const row of accountData) {
          const date = String(row?.date ?? '');
          const cost = Number(row?.cost ?? 0);
          if (date) dailyCost[date] = cost;
          accountCost += cost;
        }

        let accountPql = 0;
        let accountPreQ = 0;
        const pqlNameSet = new Set<string>(PQL_ACTION_NAMES);
        const breakdown = Array.isArray(account?.conversionBreakdown) ? account.conversionBreakdown : [];
        for (const item of breakdown) {
          const name = String(item?.name ?? '').trim();
          if (pqlNameSet.has(name)) accountPql += Number(item?.conversions ?? 0);
          if (name === PREQ_ACTION_NAME) accountPreQ = Number(item?.conversions ?? 0);
        }

        // The campaign endpoint with pql_action=Pre-Qualified Lead returns
        // per-row pql_conversions = Pre-Q count under that param. We re-key
        // it as perCampaignPreQ for clarity.
        const perCampaignPreQ: Record<string, number> = {};
        const campaignData = Array.isArray(campaigns?.data) ? campaigns.data : [];
        for (const c of campaignData) {
          const id = String(c?.campaign_id ?? '');
          if (!id) continue;
          perCampaignPreQ[id] = Number(c?.pql_conversions ?? 0);
        }

        if (cancelled) return;
        setState({
          dailyActions,
          dailyCost,
          perCampaignPreQ,
          accountPql,
          accountPreQ,
          accountCost,
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ ...EMPTY_FUNNEL, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adAccountId, dateRangeIndex, enabled]);

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
    campaigns, totals, dailyData,
    kpiChanges,
    loading, error, lastRefreshed, cooldownRemaining,
    dateRangeIndex, currentRange, handleDateRangeChange, fetchData,
  } = data;

  // ── PQL primary KPI (account-level) ────────────────────────────────────
  const pqlData = usePqlData(client.ad_account_id, dateRangeIndex);
  const pqlCount = pqlData.current;
  const pqlPrior = pqlData.prior;
  const pqlChange = calcChange(pqlCount, pqlPrior);
  const costPerPql = pqlCount > 0 ? pqlData.costCurrent / pqlCount : 0;
  const costPerPqlPrior = pqlPrior > 0 ? pqlData.costPrior / pqlPrior : 0;
  const costPerPqlChange = calcChange(costPerPql, costPerPqlPrior);

  // ── Per-dimension data with PQL columns ────────────────────────────────
  const dims = useDimensionsWithPql(client.ad_account_id, dateRangeIndex);

  // ── Internal funnel-health data (only fetched in internal mode) ────────
  const isInternal = mode === 'internal';
  const funnel = useInternalFunnelData(client.ad_account_id, dateRangeIndex, isInternal);

  // Account-level funnel KPIs (internal only)
  const funnelRate = funnel.accountPreQ > 0 ? funnel.accountPql / funnel.accountPreQ : 0;
  const funnelCostPerPql = funnel.accountPql > 0 ? funnel.accountCost / funnel.accountPql : 0;

  // Daily series for the Pre-Q vs PQL chart (internal only).
  // Pivot dailyActions [{date, action_name, conversions}] into one row per
  // date with separate fields for each action, then merge in dailyCost so we
  // can show a rolling cost-per-PQL line on the same chart.
  const funnelDaily = (() => {
    if (!isInternal) return [] as Array<{ date: string; preq: number; pql: number; cost: number; rollingCostPerPql: number }>;
    const map = new Map<string, { date: string; preq: number; pql: number; cost: number }>();
    const pqlNameSet = new Set<string>(PQL_ACTION_NAMES);
    for (const row of funnel.dailyActions) {
      const d = row.date;
      if (!map.has(d)) map.set(d, { date: d, preq: 0, pql: 0, cost: 0 });
      const rec = map.get(d)!;
      if (row.action_name === PREQ_ACTION_NAME) rec.preq += row.conversions;
      if (pqlNameSet.has(row.action_name)) rec.pql += row.conversions;
    }
    for (const [date, cost] of Object.entries(funnel.dailyCost)) {
      if (!map.has(date)) map.set(date, { date, preq: 0, pql: 0, cost: 0 });
      map.get(date)!.cost = cost;
    }
    const sorted = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    // 7-day trailing rolling Cost / PQL (smoother than per-day since PQL is sparse)
    const WIN = 7;
    return sorted.map((r, i) => {
      const start = Math.max(0, i - WIN + 1);
      let costSum = 0;
      let pqlSum = 0;
      for (let j = start; j <= i; j++) {
        costSum += sorted[j].cost;
        pqlSum += sorted[j].pql;
      }
      return { ...r, rollingCostPerPql: pqlSum > 0 ? costSum / pqlSum : 0 };
    });
  })();

  // Per-campaign funnel rows (internal only). Merge spend + PQL from dims.campaigns
  // (already fetched with pql_action=PQL_ACTION_NAME) with Pre-Q from funnel.perCampaignPreQ.
  const funnelCampaignRows: Array<Record<string, unknown>> = isInternal
    ? dims.campaigns
        .map((c) => {
          const id = String(c.campaign_id ?? '');
          const pql = Number(c.pql_conversions ?? 0);
          const preq = funnel.perCampaignPreQ[id] ?? 0;
          const spend = Number(c.cost ?? 0);
          return {
            campaign_name: c.campaign_name,
            cost: spend,
            preq_conversions: preq,
            pql_conversions: pql,
            preq_to_pql_rate: preq > 0 ? pql / preq : 0,
            cost_per_pql: pql > 0 ? spend / pql : 0,
          };
        })
        // Only show campaigns that actually generated either a Pre-Q or a PQL in the window
        .filter((r) => Number(r.preq_conversions) > 0 || Number(r.pql_conversions) > 0)
        // Sort by spend desc so the biggest budgets sit at top
        .sort((a, b) => Number(b.cost) - Number(a.cost))
    : [];

  // ── Derived values ─────────────────────────────────────────────────────

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
              Counts the combined Pricing Qualified conversion actions ({PQL_ACTION_LABELS}). Recent days may rise as conversions finish attributing.
            </p>
          </div>

          {/* ───────────────────────────────────────────────────────────────────
              INTERNAL FUNNEL HEALTH SECTIONS
              Only rendered when the viewer has the dashboard cm_auth cookie
              (mode === 'internal'). Public token viewers (clients) never see
              this block. Sections: Funnel Health KPIs, daily Pre-Q vs PQL
              chart, rolling Cost per PQL chart, per-campaign Funnel table.
              ─────────────────────────────────────────────────────────────── */}
          {isInternal && (
            <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-5 space-y-6">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-600" />
                <h2 className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                  Internal Ops View &mdash; Funnel Health
                </h2>
                <span className="text-[10px] font-medium text-amber-700/70 ml-2">
                  Visible only to logged-in Creekside team. Not shown to clients.
                </span>
              </div>

              {/* Funnel Health KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SparklineKpiCard
                  label="Pre-Q → PQL Rate"
                  value={funnel.loading ? '…' : funnel.accountPreQ > 0 ? fmtPct(funnelRate) : '--'}
                  changeSentiment="positive-up"
                  size="lg"
                />
                <SparklineKpiCard
                  label="Pre-Qualified Leads"
                  value={funnel.loading ? '…' : fmt(funnel.accountPreQ)}
                  changeSentiment="positive-up"
                  size="lg"
                />
                <SparklineKpiCard
                  label="Pricing Qualified Leads"
                  value={funnel.loading ? '…' : fmt(funnel.accountPql)}
                  changeSentiment="positive-up"
                  size="lg"
                />
                <SparklineKpiCard
                  label="Cost per PQL"
                  value={funnel.loading ? '…' : funnel.accountPql > 0 ? fmtMoney(funnelCostPerPql) : '--'}
                  changeSentiment="negative-up"
                  size="lg"
                />
              </div>

              {/* Daily Pre-Q vs PQL chart */}
              {funnelDaily.length > 0 && (
                <ReportChart
                  title="Daily Pre-Qualified vs Pricing Qualified Leads"
                  data={funnelDaily}
                  xKey="date"
                  lines={[
                    { dataKey: 'preq', label: 'Pre-Qualified', color: '#10B981', type: 'bar', yAxisId: 'left' },
                    { dataKey: 'pql', label: 'Pricing Qualified (JT)', color: '#8B5CF6', yAxisId: 'right' },
                  ]}
                  formatY={(v) => v.toFixed(0)}
                  formatYRight={(v) => v.toFixed(0)}
                />
              )}

              {/* Rolling Cost per PQL trend */}
              {funnelDaily.length > 0 && (
                <ReportChart
                  title="Cost per Pricing Qualified Lead (7-day rolling)"
                  data={funnelDaily}
                  xKey="date"
                  lines={[
                    { dataKey: 'rollingCostPerPql', label: 'Cost / PQL', color: '#F59E0B', yAxisId: 'left' },
                  ]}
                  formatY={(v) => `$${v.toFixed(0)}`}
                />
              )}

              {/* Per-campaign funnel table */}
              {funnelCampaignRows.length > 0 && (
                <BreakdownTable
                  title="Per-Campaign Funnel Health"
                  columns={[
                    { key: 'campaign_name', label: 'Campaign' },
                    { key: 'cost', label: 'Spend', align: 'right', format: moneyCol },
                    { key: 'preq_conversions', label: 'Pre-Q', align: 'right', format: numOrDashCol },
                    { key: 'pql_conversions', label: 'PQL', align: 'right', format: numOrDashCol },
                    { key: 'preq_to_pql_rate', label: 'Pre-Q → PQL', align: 'right', format: (v) => Number(v ?? 0) > 0 ? fmtPct(Number(v)) : '--' },
                    { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
                  ]}
                  data={funnelCampaignRows}
                />
              )}

              <p className="text-[11px] text-amber-700/80 mt-1">
                Pre-Q → PQL rate measures how many Pre-Qualified Leads (Lead Instant Quote - JTC submissions) progress to any of the combined Pricing Qualified actions ({PQL_ACTION_LABELS}). Recent days may rise as PQL conversions finish attributing (~5-day lag).
              </p>
            </div>
          )}

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
          )}

          {/* 4. Campaigns (shared component, untouched) */}
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Campaigns</h2>
            <CampaignsTable campaigns={campaigns} platform="google" />
          </div>

          {/* 5. Campaign PQL Performance (PQL-focused per-campaign view) */}
          {dims.campaigns.length > 0 && (
            <BreakdownTable
              title="Campaign PQL Performance"
              columns={[
                { key: 'campaign_name', label: 'Campaign' },
                { key: 'cost', label: 'Spend', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Leads', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: moneyOrDashCol },
                { key: 'pql_conversions', label: 'PQLs', align: 'right', format: numOrDashCol },
                { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
              ]}
              data={dims.campaigns}
            />
          )}

          {/* 6. Top Keywords */}
          {dims.keywords.length > 0 && (
            <BreakdownTable
              title="Top Keywords"
              columns={[
                { key: 'keyword', label: 'Keyword' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Leads', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: moneyOrDashCol },
                { key: 'pql_conversions', label: 'PQLs', align: 'right', format: numOrDashCol },
                { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
              ]}
              data={dims.keywords}
            />
          )}

          {/* 7. Top Search Terms */}
          {dims.searchTerms.length > 0 && (
            <BreakdownTable
              title="Top Search Terms"
              columns={[
                { key: 'search_term', label: 'Search Term' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Leads', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: moneyOrDashCol },
                { key: 'pql_conversions', label: 'PQLs', align: 'right', format: numOrDashCol },
                { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
              ]}
              data={dims.searchTerms}
            />
          )}

          {/* 8. Demographics — side by side */}
          {(dims.ageData.length > 0 || dims.genderData.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {dims.ageData.length > 0 && dims.genderData.length > 0 ? (
                <DemographicChart
                  title="Age & Gender Breakdown"
                  type="age-gender"
                  data={mergeAgeGenderData(dims.ageData, dims.genderData)}
                />
              ) : dims.ageData.length > 0 ? (
                <BreakdownTable
                  title="Age Breakdown"
                  columns={[
                    { key: 'age_range', label: 'Age' },
                    { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                    { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                    { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                    { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                    { key: 'conversions', label: 'Leads', align: 'right', format: numCol },
                    { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: moneyOrDashCol },
                    { key: 'pql_conversions', label: 'PQLs', align: 'right', format: numOrDashCol },
                    { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
                  ]}
                  data={dims.ageData}
                />
              ) : null}

              {dims.genderData.length > 0 && (
                <BreakdownTable
                  title="Gender Breakdown"
                  columns={[
                    { key: 'gender', label: 'Gender' },
                    { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                    { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                    { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                    { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                    { key: 'conversions', label: 'Leads', align: 'right', format: numCol },
                    { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: moneyOrDashCol },
                    { key: 'pql_conversions', label: 'PQLs', align: 'right', format: numOrDashCol },
                    { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
                  ]}
                  data={dims.genderData}
                />
              )}
            </div>
          )}

          {/* 9. Stand-alone Age Breakdown table when both age and gender are present
              (DemographicChart shows the visual; this table gives the numeric detail
              including the new PQL columns the chart can't display). */}
          {dims.ageData.length > 0 && dims.genderData.length > 0 && (
            <BreakdownTable
              title="Age Breakdown"
              columns={[
                { key: 'age_range', label: 'Age' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Leads', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: moneyOrDashCol },
                { key: 'pql_conversions', label: 'PQLs', align: 'right', format: numOrDashCol },
                { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
              ]}
              data={dims.ageData}
            />
          )}

          {/* 10. Location Breakdown */}
          {dims.geoData.length > 0 && (
            <BreakdownTable
              title="Location Breakdown"
              columns={[
                { key: 'city', label: 'City' },
                { key: 'impressions', label: 'Impressions', align: 'right', format: numCol },
                { key: 'clicks', label: 'Clicks', align: 'right', format: numCol },
                { key: 'ctr', label: 'CTR', align: 'right', format: pctCol },
                { key: 'average_cpc', label: 'Avg. CPC', align: 'right', format: moneyCol },
                { key: 'cost', label: 'Cost', align: 'right', format: moneyCol },
                { key: 'conversions', label: 'Leads', align: 'right', format: numCol },
                { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: moneyOrDashCol },
                { key: 'pql_conversions', label: 'PQLs', align: 'right', format: numOrDashCol },
                { key: 'cost_per_pql', label: 'Cost / PQL', align: 'right', format: moneyOrDashCol },
              ]}
              data={dims.geoData}
            />
          )}

        </>
      )}

      {/* 11. Notes */}
      <ReportNotesTimeline clientId={client.id} mode={mode} />
    </div>
  );
}

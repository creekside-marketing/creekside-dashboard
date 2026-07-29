'use client';

/**
 * SRMMetaReport -- Custom report for South River Mortgage (Meta).
 *
 * Renders a Pricing Qualified Leads KPI strip above the standard LeadGen
 * Meta report. The strip pulls conversion data LIVE from the Meta campaigns
 * via PipeBoard (no Google Sheet dependency).
 *
 * Data sources (all from the `conversions` field, NOT `actions`):
 *   - Pricing Qualified Leads: offsite_conversion.fb_pixel_custom.(JTC) Pricing Qualified
 *   - Pre-Qualified Leads: offsite_conversion.fb_pixel_custom.(JTC) Pre-qualified Lead
 *   - Spend: from the same campaign-level response
 *
 * Defaults to 7-day view (index 0).
 */

import { useEffect, useState, useCallback } from 'react';
import LeadGenMetaReport from '../../LeadGenMetaReport';
import {
  DATE_RANGES, computePriorPeriod,
  calcChange, fmt, fmtMoney, fmtPct, unwrapPipeboardResponse,
} from '../../ReportHeader';
import BreakdownTable from '../../BreakdownTable';
import type { ReportProps } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────

type MetaAction = { action_type: string; value: string };

interface KpiData {
  currentPql: number;
  priorPql: number;
  currentPreq: number;
  priorPreq: number;
  currentSpend: number;
  priorSpend: number;
}

const ZERO_KPI: KpiData = {
  currentPql: 0, priorPql: 0,
  currentPreq: 0, priorPreq: 0,
  currentSpend: 0, priorSpend: 0,
};

// ── Helpers ──────────────────────────────────────────────────────────────

const PQL_ACTION = 'offsite_conversion.fb_pixel_custom.(JTC) Pricing Qualified';
const PREQ_ACTION = 'offsite_conversion.fb_pixel_custom.(JTC) Pre-qualified Lead';

function conversionVal(conversions: MetaAction[] | undefined, actionType: string): number {
  if (!conversions) return 0;
  const match = conversions.find((a) => a.action_type === actionType);
  return match ? Math.round(Number(match.value) || 0) : 0;
}

function extractMetrics(json: Record<string, unknown>): { pql: number; preq: number; spend: number } {
  const unwrapped = unwrapPipeboardResponse(json);
  const arr = unwrapped.data ?? unwrapped.segmented_metrics ?? unwrapped;
  if (!Array.isArray(arr)) {
    return { pql: 0, preq: 0, spend: Number((unwrapped as Record<string, unknown>).spend ?? 0) };
  }
  let pql = 0, preq = 0, spend = 0;
  for (const row of arr) {
    const r = row as Record<string, unknown>;
    const conversions = (r.conversions ?? []) as MetaAction[];
    pql += conversionVal(conversions, PQL_ACTION);
    preq += conversionVal(conversions, PREQ_ACTION);
    spend += Number(r.spend ?? 0);
  }
  return { pql, preq, spend };
}

// ── KPI Card ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, change, changeSentiment,
}: {
  label: string;
  value: string;
  change?: { pct: string; direction: 'up' | 'down' | 'flat' };
  changeSentiment?: 'positive-up' | 'negative-up' | 'neutral';
}) {
  let changeColor = 'text-slate-400';
  if (change && change.direction !== 'flat') {
    const isGood =
      (changeSentiment === 'positive-up' && change.direction === 'up') ||
      (changeSentiment === 'negative-up' && change.direction === 'down');
    changeColor = isGood ? 'text-emerald-600' : 'text-red-500';
  }
  const arrow = change?.direction === 'up' ? '\u25B2' : change?.direction === 'down' ? '\u25BC' : '';

  return (
    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
      {change && change.pct !== '--' && (
        <p className={`text-xs font-medium mt-1 ${changeColor}`}>
          {arrow} {change.pct} vs prior period
        </p>
      )}
    </div>
  );
}

// ── Internal: Landing Page Performance ───────────────────────────────────

type LandingPageRow = Record<string, unknown>;

interface LandingPageState {
  data: LandingPageRow[];
  hasUrls: boolean;
  urlResolutionFailed: boolean;
  droppedCampaigns: number;
  loading: boolean;
  error: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: Record<string, any> | null;
}

function useMetaLandingPageData(
  adAccountId: string | null,
  dateRangeIndex: number,
  enabled: boolean,
): LandingPageState {
  const [state, setState] = useState<LandingPageState>({
    data: [], hasUrls: false, urlResolutionFailed: false, droppedCampaigns: 0, loading: false, error: false, debug: null,
  });

  useEffect(() => {
    if (!enabled || !adAccountId) {
      setState({ data: [], hasUrls: false, urlResolutionFailed: false, droppedCampaigns: 0, loading: false, error: false, debug: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: false }));

    (async () => {
      try {
        const { currentSince, currentUntil } = computePriorPeriod(dateRangeIndex);
        const aid = encodeURIComponent(adAccountId);
        const res = await fetch(
          `/api/meta/landing-pages?account_id=${aid}&since=${currentSince}&until=${currentUntil}`,
        );
        const json = res.ok ? await res.json() : {};
        if (cancelled) return;
        setState({
          data: Array.isArray(json?.data) ? json.data : [],
          hasUrls: !!json?.hasUrls,
          urlResolutionFailed: !!json?.urlResolutionFailed,
          droppedCampaigns: Number(json?.droppedCampaigns ?? 0),
          loading: false,
          error: !res.ok,
          debug: json?._debug ?? null,
        });
      } catch {
        if (!cancelled) setState({ data: [], hasUrls: false, urlResolutionFailed: false, droppedCampaigns: 0, loading: false, error: true, debug: null });
      }
    })();

    return () => { cancelled = true; };
  }, [adAccountId, dateRangeIndex, enabled]);

  return state;
}

// ── Component ────────────────────────────────────────────────────────────

const SRM_DEFAULT_RANGE_INDEX = 0; // 7d

export default function SRMMetaReport({ client, mode }: ReportProps) {
  const [kpi, setKpi] = useState<KpiData>(ZERO_KPI);
  const [dateRangeIndex, setDateRangeIndex] = useState(SRM_DEFAULT_RANGE_INDEX);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isInternal = mode === 'internal';
  const lpData = useMetaLandingPageData(client.ad_account_id, dateRangeIndex, isInternal);

  const fetchData = useCallback(async () => {
    if (!client.ad_account_id) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    const periods = computePriorPeriod(dateRangeIndex);
    const aid = encodeURIComponent(client.ad_account_id);
    const base = `/api/meta/insights?account_id=${aid}&level=campaign&fields=conversions`;
    try {
      const [curRes, priorRes] = await Promise.all([
        fetch(`${base}&since=${periods.currentSince}&until=${periods.currentUntil}`),
        fetch(`${base}&since=${periods.priorSince}&until=${periods.priorUntil}`),
      ]);
      const [curJson, priorJson] = await Promise.all([
        curRes.ok ? curRes.json() : {},
        priorRes.ok ? priorRes.json() : {},
      ]);
      const cur = extractMetrics(curJson);
      const prior = extractMetrics(priorJson);
      setKpi({
        currentPql: cur.pql, priorPql: prior.pql,
        currentPreq: cur.preq, priorPreq: prior.preq,
        currentSpend: cur.spend, priorSpend: prior.spend,
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [client.ad_account_id, dateRangeIndex]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const currentCPL = kpi.currentPql > 0 ? kpi.currentSpend / kpi.currentPql : 0;
  const priorCPL = kpi.priorPql > 0 ? kpi.priorSpend / kpi.priorPql : 0;
  const pqlChange = calcChange(kpi.currentPql, kpi.priorPql);
  const preqChange = calcChange(kpi.currentPreq, kpi.priorPreq);
  const cplChange = calcChange(currentCPL, priorCPL);
  const convRate = kpi.currentPreq > 0 ? kpi.currentPql / kpi.currentPreq : 0;
  const priorConvRate = kpi.priorPreq > 0 ? kpi.priorPql / kpi.priorPreq : 0;
  const convRateChange = calcChange(convRate, priorConvRate);

  return (
    <div className="space-y-6">
      {/* ── Pricing Qualified Leads KPI Strip ──────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-800">
            Pricing Qualified Leads
            <span className="ml-2 text-xs font-normal text-slate-400">(live from Meta campaigns)</span>
          </h2>
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-1 gap-0.5">
            {DATE_RANGES.map((range, i) => (
              <button
                key={range.label}
                onClick={() => setDateRangeIndex(i)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  i === dateRangeIndex
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-200 border-t-[#2563eb]" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-500">Unable to load conversion data from Meta.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard label="Pricing Qualified Leads" value={fmt(kpi.currentPql)}
                change={pqlChange} changeSentiment="positive-up" />
              <KpiCard label="Pre-Qualified Leads" value={fmt(kpi.currentPreq)}
                change={preqChange} changeSentiment="positive-up" />
              <KpiCard label="Ad Spend"
                value={kpi.currentSpend > 0 ? fmtMoney(kpi.currentSpend) : '--'}
                change={calcChange(kpi.currentSpend, kpi.priorSpend)} changeSentiment="neutral" />
              <KpiCard label="Cost Per PQL"
                value={currentCPL > 0 ? fmtMoney(currentCPL) : '--'}
                change={cplChange} changeSentiment="negative-up" />
              <KpiCard label="Pre-Q to PQL Rate"
                value={convRate > 0 ? fmtPct(convRate) : '--'}
                change={convRateChange} changeSentiment="positive-up" />
            </div>
          )}
        </div>
      </div>

      {/* ── Internal: Landing Page Performance ────────────────────────────────── */}
      {isInternal && (
        <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-600" />
            <h2 className="text-xs font-bold text-amber-800 uppercase tracking-wider">
              Internal Ops View &mdash; Landing Page Performance
            </h2>
            <span className="text-[10px] font-medium text-amber-700/70 ml-2">
              Visible only to logged-in Creekside team. Not shown to clients.
            </span>
          </div>

          {lpData.loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-200 border-t-[#2563eb]" />
            </div>
          ) : lpData.error ? (
            <p className="text-sm text-red-500">Unable to load landing page data from Meta.</p>
          ) : lpData.urlResolutionFailed ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-700/60">
                Could not resolve destination URLs from ad creatives for this account.
              </p>
              {lpData.debug && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer font-mono text-amber-800/70 hover:text-amber-900 select-none">
                    debug info (click to expand)
                  </summary>
                  <pre className="mt-2 p-3 bg-amber-100/60 rounded text-amber-900 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                    {JSON.stringify(lpData.debug, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : lpData.data.length === 0 ? (
            <p className="text-sm text-amber-700/60">No landing page data returned for this date range.</p>
          ) : (
            <>
              {lpData.droppedCampaigns > 0 && (
              <p className="text-[11px] text-amber-700/70">
                {lpData.droppedCampaigns} campaign{lpData.droppedCampaigns > 1 ? 's' : ''} excluded — no destination URL found in creative.
              </p>
            )}
            <BreakdownTable
                title=""
                defaultSortKey="spend"
                columns={[
                  {
                    key: 'landing_page',
                    label: 'Landing Page',
                    format: (v: unknown) => {
                      const raw = String(v ?? '').trim();
                      if (!raw) return '--';
                      try {
                        const u = new URL(raw);
                        return u.pathname + (u.search || '');
                      } catch {
                        return raw;
                      }
                    },
                  },
                  { key: 'impressions',         label: 'Impressions', align: 'right', format: (v) => fmt(Number(v ?? 0)) },
                  { key: 'clicks',              label: 'Clicks',      align: 'right', format: (v) => fmt(Number(v ?? 0)) },
                  { key: 'ctr',                 label: 'CTR',         align: 'right', format: (v) => fmtPct(Number(v ?? 0)) },
                  { key: 'conversions',         label: 'Pre-Q Leads', align: 'right', format: (v) => { const n = Number(v ?? 0); return n > 0 ? fmt(n) : '--'; } },
                  { key: 'cost_per_conversion', label: 'Cost / Lead', align: 'right', format: (v) => { const n = Number(v ?? 0); return n > 0 ? fmtMoney(n) : '--'; } },
                  { key: 'pql_conversions',     label: 'PQLs',        align: 'right', format: (v) => { const n = Number(v ?? 0); return n > 0 ? fmt(n) : '--'; } },
                  { key: 'cost_per_pql',        label: 'Cost / PQL',  align: 'right', format: (v) => { const n = Number(v ?? 0); return n > 0 ? fmtMoney(n) : '--'; } },
                  { key: 'spend',               label: 'Spend',       align: 'right', format: (v) => fmtMoney(Number(v ?? 0)) },
                ]}
                data={lpData.data}
              />
            </>
          )}
        </div>
      )}

      {/* ── Standard LeadGen Meta Report (Pre-Q leads + PQL columns in campaign table) */}
      <LeadGenMetaReport client={client} mode={mode} leadConversionTypes={[PREQ_ACTION]} pqlConversionType={PQL_ACTION} hideReferralBanner />
    </div>
  );
}

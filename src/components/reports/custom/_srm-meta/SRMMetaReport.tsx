'use client';

/**
 * SRMMetaReport -- Custom report for South River Mortgage (Meta).
 *
 * Renders a Pricing Qualified Leads KPI strip above the standard LeadGen
 * Meta report. The strip pulls conversion data LIVE from the Meta campaigns
 * via AdKit (no Google Sheet dependency).
 *
 * Data sources (all from the `conversions` field, NOT `actions`):
 *   - Pricing Qualified Leads: offsite_conversion.fb_pixel_custom.(JTC) Pricing Qualified
 *   - Pre-Qualified Leads: offsite_conversion.fb_pixel_custom.(JTC) Pre-qualified Lead
 *   - Spend: from the same campaign-level response
 *
 * Defaults to 7-day view (index 0).
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import LeadGenMetaReport from '../../LeadGenMetaReport';
import {
  DATE_RANGES, computePriorPeriod,
  calcChange, fmt, fmtMoney, fmtPct, unwrapPipeboardResponse,
} from '../../ReportHeader';
import BreakdownTable from '../../BreakdownTable';
import type { ReportProps } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Compute prior period for a custom date range — same number of days,
 * immediately preceding the selected window.
 */
function computeCustomPrior(since: string, until: string): { priorSince: string; priorUntil: string } {
  const sinceDate = new Date(since + 'T00:00:00');
  const untilDate = new Date(until + 'T00:00:00');
  const days = Math.round((untilDate.getTime() - sinceDate.getTime()) / 86400000) + 1;
  const priorUntil = new Date(sinceDate);
  priorUntil.setDate(priorUntil.getDate() - 1);
  const priorSince = new Date(priorUntil);
  priorSince.setDate(priorSince.getDate() - (days - 1));
  const f = (d: Date) => d.toISOString().split('T')[0];
  return { priorSince: f(priorSince), priorUntil: f(priorUntil) };
}

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
  loading: boolean;
  error: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: Record<string, any> | null;
}

function useMetaLandingPageData(
  adAccountId: string | null,
  since: string,
  until: string,
  enabled: boolean,
): LandingPageState {
  const [state, setState] = useState<LandingPageState>({
    data: [], hasUrls: false, urlResolutionFailed: false, loading: false, error: false, debug: null,
  });

  useEffect(() => {
    if (!enabled || !adAccountId) {
      setState({ data: [], hasUrls: false, urlResolutionFailed: false, loading: false, error: false, debug: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: false }));

    (async () => {
      try {
        const aid = encodeURIComponent(adAccountId);
        const res = await fetch(
          `/api/meta/landing-pages?account_id=${aid}&since=${since}&until=${until}`,
        );
        const json = res.ok ? await res.json() : {};
        if (cancelled) return;
        setState({
          data: Array.isArray(json?.data) ? json.data : [],
          hasUrls: !!json?.hasUrls,
          urlResolutionFailed: !!json?.urlResolutionFailed,
          loading: false,
          error: !res.ok,
          debug: json?._debug ?? null,
        });
      } catch {
        if (!cancelled) setState({ data: [], hasUrls: false, urlResolutionFailed: false, loading: false, error: true, debug: null });
      }
    })();

    return () => { cancelled = true; };
  }, [adAccountId, since, until, enabled]);

  return state;
}

// ── Component ────────────────────────────────────────────────────────────

const SRM_DEFAULT_RANGE_INDEX = 0; // 7d

export default function SRMMetaReport({ client, mode }: ReportProps) {
  const [kpi, setKpi] = useState<KpiData>(ZERO_KPI);
  const [dateRangeIndex, setDateRangeIndex] = useState(SRM_DEFAULT_RANGE_INDEX);
  const [dateMode, setDateMode] = useState<'preset' | 'custom'>('preset');
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  const [pendingSince, setPendingSince] = useState('');
  const [pendingUntil, setPendingUntil] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isInternal = mode === 'internal';

  const activePeriod = useMemo(() => {
    if (dateMode === 'custom' && customSince && customUntil) {
      return {
        currentSince: customSince,
        currentUntil: customUntil,
        ...computeCustomPrior(customSince, customUntil),
      };
    }
    const p = computePriorPeriod(dateRangeIndex);
    return { currentSince: p.currentSince, currentUntil: p.currentUntil, priorSince: p.priorSince, priorUntil: p.priorUntil };
  }, [dateMode, customSince, customUntil, dateRangeIndex]);

  const lpData = useMetaLandingPageData(client.ad_account_id, activePeriod.currentSince, activePeriod.currentUntil, true);

  const fetchData = useCallback(async () => {
    if (!client.ad_account_id) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    const aid = encodeURIComponent(client.ad_account_id);
    const base = `/api/meta/insights?account_id=${aid}&level=campaign&fields=conversions`;
    try {
      const [curRes, priorRes] = await Promise.all([
        fetch(`${base}&since=${activePeriod.currentSince}&until=${activePeriod.currentUntil}`),
        fetch(`${base}&since=${activePeriod.priorSince}&until=${activePeriod.priorUntil}`),
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
  }, [client.ad_account_id, activePeriod.currentSince, activePeriod.currentUntil, activePeriod.priorSince, activePeriod.priorUntil]);

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
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center rounded-lg bg-slate-100 p-1 gap-0.5">
              {DATE_RANGES.map((range, i) => (
                <button
                  key={range.label}
                  onClick={() => { setDateRangeIndex(i); setDateMode('preset'); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateMode === 'preset' && i === dateRangeIndex
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {range.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setDateMode('custom');
                  if (!pendingSince) setPendingSince(activePeriod.currentSince);
                  if (!pendingUntil) setPendingUntil(activePeriod.currentUntil);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  dateMode === 'custom'
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                Custom
              </button>
            </div>
            {dateMode === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={pendingSince}
                  onChange={(e) => setPendingSince(e.target.value)}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={pendingUntil}
                  onChange={(e) => setPendingUntil(e.target.value)}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    if (pendingSince && pendingUntil && pendingSince <= pendingUntil) {
                      setCustomSince(pendingSince);
                      setCustomUntil(pendingUntil);
                    }
                  }}
                  disabled={!pendingSince || !pendingUntil || pendingSince > pendingUntil}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#2563eb] text-white disabled:bg-slate-200 disabled:text-slate-400 transition-all"
                >
                  Apply
                </button>
              </div>
            )}
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

      {/* ── Landing Page Performance ────────────────────────────────────────── */}
      {lpData.loading ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Landing Page Performance</h2>
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-200 border-t-[#2563eb]" />
          </div>
        </div>
      ) : lpData.error ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-2">Landing Page Performance</h2>
          <p className="text-sm text-red-500">Unable to load landing page data from Meta.</p>
        </div>
      ) : lpData.urlResolutionFailed ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-2">Landing Page Performance</h2>
          <p className="text-sm text-slate-500">Could not resolve destination URLs from ad creatives for this account.</p>
          {isInternal && lpData.debug && (
            <details className="text-[11px] mt-2">
              <summary className="cursor-pointer font-mono text-slate-500 hover:text-slate-700 select-none">
                debug info (click to expand)
              </summary>
              <pre className="mt-2 p-3 bg-slate-100 rounded text-slate-700 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(lpData.debug, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ) : lpData.data.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-2">Landing Page Performance</h2>
          <p className="text-sm text-slate-500">No landing page data returned for this date range.</p>
        </div>
      ) : (
        <BreakdownTable
          title="Landing Page Performance"
          defaultSortKey="spend"
          columns={[
            {
              key: 'landing_page',
              label: 'Landing Page',
              format: (v: unknown) => {
                const raw = String(v ?? '').trim();
                if (!raw) return '--';
                if (raw.startsWith('(')) return raw;
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
      )}

      {/* ── Standard LeadGen Meta Report (Pre-Q leads + PQL columns in campaign table) */}
      <LeadGenMetaReport client={client} mode={mode} leadConversionTypes={[PREQ_ACTION]} pqlConversionType={PQL_ACTION} hideReferralBanner controlledPeriod={activePeriod} />
    </div>
  );
}

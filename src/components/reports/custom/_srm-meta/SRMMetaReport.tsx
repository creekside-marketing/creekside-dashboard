'use client';

/**
 * SRMMetaReport -- Wraps the default LeadGenMetaReport with a prequalified-leads
 * KPI strip above it. The strip shows: Prequalified Leads, Spend, CPL, and
 * period-over-period deltas for Leads and CPL.
 *
 * Data sources:
 *   - Prequalified leads: /api/leads/srm-prequalified (Google Sheet, fbclid filter)
 *   - Spend: /api/meta/insights (account-level, same API the standard report uses)
 *
 * The KPI strip manages its own date range state. The standard report below
 * operates independently with its own date range tabs.
 */

import { useEffect, useState, useCallback } from 'react';
import LeadGenMetaReport from '../../LeadGenMetaReport';
import {
  DATE_RANGES, DEFAULT_RANGE_INDEX, computePriorPeriod,
  calcChange, fmt, fmtMoney, unwrapPipeboardResponse,
} from '../../ReportHeader';
import type { ReportProps } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────

interface SheetLead {
  event_time: string; // ISO 8601
  fbclid: string;
}

interface KpiData {
  currentLeads: number;
  priorLeads: number;
  currentSpend: number;
  priorSpend: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function countLeadsInRange(leads: SheetLead[], since: string, until: string): number {
  return leads.filter((l) => {
    const d = l.event_time.slice(0, 10); // YYYY-MM-DD
    return d >= since && d <= until;
  }).length;
}

function extractSpend(json: Record<string, unknown>): number {
  const unwrapped = unwrapPipeboardResponse(json);
  // Account-level response: { data: [{ spend: "123.45", ... }] } or segmented_metrics
  const arr = unwrapped.data ?? unwrapped.segmented_metrics ?? unwrapped;
  if (Array.isArray(arr)) {
    return arr.reduce((sum: number, row: Record<string, unknown>) => {
      const metrics = (row.metrics ?? row) as Record<string, unknown>;
      return sum + Number(metrics.spend ?? 0);
    }, 0);
  }
  return Number((unwrapped as Record<string, unknown>).spend ?? 0);
}

// ── KPI Strip ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  change,
  changeSentiment,
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

// ── Component ────────────────────────────────────────────────────────────

export default function SRMMetaReport({ client, mode }: ReportProps) {
  const [leads, setLeads] = useState<SheetLead[]>([]);
  const [kpi, setKpi] = useState<KpiData>({ currentLeads: 0, priorLeads: 0, currentSpend: 0, priorSpend: 0 });
  const [dateRangeIndex, setDateRangeIndex] = useState(DEFAULT_RANGE_INDEX);
  const [loading, setLoading] = useState(true);
  const [sheetError, setSheetError] = useState(false);

  // Fetch all sheet leads once on mount
  useEffect(() => {
    fetch('/api/leads/srm-prequalified')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLeads(d.leads ?? []))
      .catch(() => setSheetError(true))
      .finally(() => setLoading(false));
  }, []);

  // Fetch Meta spend for the current + prior periods whenever date range changes
  const fetchSpend = useCallback(async () => {
    if (!client.ad_account_id) return;
    const periods = computePriorPeriod(dateRangeIndex);
    const aid = encodeURIComponent(client.ad_account_id);
    const base = `/api/meta/insights?account_id=${aid}&level=account`;
    try {
      const [curRes, priorRes] = await Promise.all([
        fetch(`${base}&since=${periods.currentSince}&until=${periods.currentUntil}`),
        fetch(`${base}&since=${periods.priorSince}&until=${periods.priorUntil}`),
      ]);
      const [curJson, priorJson] = await Promise.all([
        curRes.ok ? curRes.json() : {},
        priorRes.ok ? priorRes.json() : {},
      ]);
      setKpi((prev) => ({
        ...prev,
        currentSpend: extractSpend(curJson),
        priorSpend: extractSpend(priorJson),
      }));
    } catch { /* spend unavailable -- KPI will show dashes */ }
  }, [client.ad_account_id, dateRangeIndex]);

  useEffect(() => { fetchSpend(); }, [fetchSpend]);

  // Recompute lead counts when leads array or date range changes
  useEffect(() => {
    if (loading) return;
    const periods = computePriorPeriod(dateRangeIndex);
    setKpi((prev) => ({
      ...prev,
      currentLeads: countLeadsInRange(leads, periods.currentSince, periods.currentUntil),
      priorLeads: countLeadsInRange(leads, periods.priorSince, periods.priorUntil),
    }));
  }, [leads, dateRangeIndex, loading]);

  // Derived KPIs
  const currentCPL = kpi.currentLeads > 0 ? kpi.currentSpend / kpi.currentLeads : 0;
  const priorCPL = kpi.priorLeads > 0 ? kpi.priorSpend / kpi.priorLeads : 0;
  const leadsChange = calcChange(kpi.currentLeads, kpi.priorLeads);
  const cplChange = calcChange(currentCPL, priorCPL);

  return (
    <div className="space-y-6">
      {/* ── Prequalified Leads KPI Strip ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-800">
            Prequalified Leads
            <span className="ml-2 text-xs font-normal text-slate-400">(Meta-attributed, from lead sheet)</span>
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
          ) : sheetError ? (
            <p className="text-sm text-red-500">Unable to load prequalified leads from sheet.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                label="Prequalified Leads"
                value={fmt(kpi.currentLeads)}
                change={leadsChange}
                changeSentiment="positive-up"
              />
              <KpiCard
                label="Ad Spend"
                value={kpi.currentSpend > 0 ? fmtMoney(kpi.currentSpend) : '--'}
                change={calcChange(kpi.currentSpend, kpi.priorSpend)}
                changeSentiment="neutral"
              />
              <KpiCard
                label="Cost Per Lead"
                value={currentCPL > 0 ? fmtMoney(currentCPL) : '--'}
                change={cplChange}
                changeSentiment="negative-up"
              />
              <KpiCard
                label={'\u0394 Leads'}
                value={leadsChange.pct}
                change={leadsChange}
                changeSentiment="positive-up"
              />
              <KpiCard
                label={'\u0394 CPL'}
                value={cplChange.pct}
                change={cplChange}
                changeSentiment="negative-up"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Standard LeadGen Meta Report (untouched) ─────────────────────── */}
      <LeadGenMetaReport client={client} mode={mode} />
    </div>
  );
}

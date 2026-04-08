'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import KpiCard from './KpiCard';
import CampaignsTable from './CampaignsTable';

const PARTNER_NOTES: Record<string, string> = {
  'Chris Ideson Meal Prep': 'via Bottle.com',
  'Punch Drunk Chef Meal Prep': 'via Bottle.com',
  'Unrefined Meal Prep': 'via Bottle.com',
  'Tilly Mill Auto Center': 'via FirstUp Marketing',
  'Polaris Dentistry': 'via FirstUp Marketing',
};

// ── Types ────────────────────────────────────────────────────────────────

interface ReportingClient {
  id: string;
  client_name: string;
  platform: 'meta' | 'google';
  ad_account_id: string | null;
  ad_account_name: string | null;
  monthly_budget: number | null;
  monthly_revenue: number | null;
  goals: string | null;
  notes: string | null;
  priority: string | null;
  account_manager: string | null;
  platform_operator: string | null;
  status: string;
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

interface ConversionEntry {
  type: string;
  label: string;
  count: number;
}

// ── Date range config ────────────────────────────────────────────────────

interface DateRangeOption {
  label: string;
  metaParam: string;
  googleParam: string;
}

const DATE_RANGES: DateRangeOption[] = [
  { label: '7d', metaParam: 'last_7d', googleParam: 'LAST_7_DAYS' },
  { label: '14d', metaParam: 'last_14d', googleParam: 'LAST_14_DAYS' },
  { label: '30d', metaParam: 'last_30d', googleParam: 'LAST_30_DAYS' },
  { label: 'This Month', metaParam: 'this_month', googleParam: 'THIS_MONTH' },
  { label: 'Last Month', metaParam: 'last_month', googleParam: 'LAST_MONTH' },
];

const DEFAULT_RANGE_INDEX = 2; // 30d

// ── Prior-period date computation ─────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

interface PriorPeriodDates {
  currentSince: string;
  currentUntil: string;
  priorSince: string;
  priorUntil: string;
}

function computePriorPeriod(rangeIndex: number): PriorPeriodDates {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const label = DATE_RANGES[rangeIndex].label;
  let currentSince: Date;
  let currentUntil: Date;
  let priorSince: Date;
  let priorUntil: Date;

  switch (label) {
    case '7d': {
      currentUntil = new Date(today);
      currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil);
      currentSince.setDate(currentSince.getDate() - 6);
      priorUntil = new Date(currentSince);
      priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil);
      priorSince.setDate(priorSince.getDate() - 6);
      break;
    }
    case '14d': {
      currentUntil = new Date(today);
      currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil);
      currentSince.setDate(currentSince.getDate() - 13);
      priorUntil = new Date(currentSince);
      priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil);
      priorSince.setDate(priorSince.getDate() - 13);
      break;
    }
    case '30d': {
      currentUntil = new Date(today);
      currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil);
      currentSince.setDate(currentSince.getDate() - 29);
      priorUntil = new Date(currentSince);
      priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil);
      priorSince.setDate(priorSince.getDate() - 29);
      break;
    }
    case 'This Month': {
      currentSince = new Date(today.getFullYear(), today.getMonth(), 1);
      currentUntil = new Date(today);
      currentUntil.setDate(currentUntil.getDate() - 1);
      priorSince = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      priorUntil = new Date(today.getFullYear(), today.getMonth(), 0);
      break;
    }
    case 'Last Month': {
      currentSince = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      currentUntil = new Date(today.getFullYear(), today.getMonth(), 0);
      priorSince = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      priorUntil = new Date(today.getFullYear(), today.getMonth() - 1, 0);
      break;
    }
    default: {
      currentUntil = new Date(today);
      currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil);
      currentSince.setDate(currentSince.getDate() - 29);
      priorUntil = new Date(currentSince);
      priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil);
      priorSince.setDate(priorSince.getDate() - 29);
    }
  }

  return {
    currentSince: formatDate(currentSince),
    currentUntil: formatDate(currentUntil),
    priorSince: formatDate(priorSince),
    priorUntil: formatDate(priorUntil),
  };
}

// ── Change calculation ────────────────────────────────────────────────────

interface KpiChanges {
  leads: { pct: string; direction: 'up' | 'down' | 'flat' };
  cpl: { pct: string; direction: 'up' | 'down' | 'flat' };
  spend: { pct: string; direction: 'up' | 'down' | 'flat' };
  impressions: { pct: string; direction: 'up' | 'down' | 'flat' };
  clicks: { pct: string; direction: 'up' | 'down' | 'flat' };
  ctr: { pct: string; direction: 'up' | 'down' | 'flat' };
  cpc: { pct: string; direction: 'up' | 'down' | 'flat' };
}

function calcChange(current: number, prior: number): { pct: string; direction: 'up' | 'down' | 'flat' } {
  if (prior === 0 && current === 0) return { pct: '--', direction: 'flat' };
  if (prior === 0) return { pct: 'New', direction: 'up' };
  const change = ((current - prior) / prior) * 100;
  if (Math.abs(change) < 0.5) return { pct: '0%', direction: 'flat' };
  return {
    pct: `${Math.abs(change).toFixed(1)}%`,
    direction: change > 0 ? 'up' : 'down',
  };
}

function computeKpiChanges(current: Totals, prior: Totals): KpiChanges {
  const currentCpl = current.conversions > 0 ? current.cost / current.conversions : 0;
  const priorCpl = prior.conversions > 0 ? prior.cost / prior.conversions : 0;

  return {
    leads: calcChange(current.conversions, prior.conversions),
    cpl: calcChange(currentCpl, priorCpl),
    spend: calcChange(current.cost, prior.cost),
    impressions: calcChange(current.impressions, prior.impressions),
    clicks: calcChange(current.clicks, prior.clicks),
    ctr: calcChange(current.ctr, prior.ctr),
    cpc: calcChange(current.cpc, prior.cpc),
  };
}

// ── Constants ────────────────────────────────────────────────────────────

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Meta conversion labels — only track actual business outcomes
const META_CONVERSION_LABELS: Record<string, string> = {
  'offsite_conversion.fb_pixel_purchase': 'Purchase',
  'offsite_conversion.fb_pixel_lead': 'Lead',
  'offsite_conversion.fb_pixel_complete_registration': 'Registration',
  'offsite_conversion.fb_pixel_schedule': 'Schedule',
  'offsite_conversion.fb_pixel_contact': 'Contact',
  'offsite_conversion.fb_pixel_submit_application': 'Application',
  'offsite_conversion.fb_pixel_subscribe': 'Subscribe',
  'offsite_conversion.fb_pixel_custom': 'Custom Event',
  'onsite_conversion.messaging_first_reply': 'Messaging Reply',
  'submit_form': 'Form Submit',
};

const META_CONVERSION_TYPES = new Set(Object.keys(META_CONVERSION_LABELS));

// ── Utilities ────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function unwrapPipeboardResponse(json: Record<string, unknown>): Record<string, unknown> {
  if (json.structuredContent) {
    const sc = json.structuredContent as Record<string, unknown>;
    if (typeof sc.result === 'string') {
      try { return JSON.parse(sc.result); } catch { /* fall through */ }
    }
  }
  if (Array.isArray(json.content) && json.content.length > 0) {
    const first = json.content[0] as Record<string, unknown>;
    if (typeof first.text === 'string') {
      try { return JSON.parse(first.text); } catch { /* fall through */ }
    }
  }
  return json;
}

// ── Normalizers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMetaCampaign(row: any): Campaign {
  // Sum all business-outcome conversions for this campaign
  let totalConversions = 0;
  const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
  for (const action of actions) {
    if (META_CONVERSION_TYPES.has(action.action_type)) {
      totalConversions += parseInt(action.value, 10) || 0;
    }
  }

  // Find cost per lead from cost_per_action_type
  let costPerLead = 0;
  if (totalConversions > 0) {
    costPerLead = Number(row.spend ?? 0) / totalConversions;
  }

  return {
    name: row.campaign_name ?? 'Unknown Campaign',
    status: row.campaign_status ?? row.status ?? 'unknown',
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(row.ctr ?? 0) / 100,  // Meta returns CTR as percentage (2.5 = 2.5%), normalize to decimal
    cpc: Number(row.cpc ?? 0),
    cost: Number(row.spend ?? 0),
    conversions: totalConversions,
    costPerConversion: costPerLead,
  };
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

// ── Sub-components ───────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: string }) {
  const isMeta = platform?.toLowerCase() === 'meta';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
      isMeta
        ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20'
        : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isMeta ? 'bg-blue-500' : 'bg-emerald-500'}`} />
      {isMeta ? 'Meta' : 'Google'}
    </span>
  );
}

function _PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const lower = priority.toLowerCase();
  const styles: Record<string, string> = {
    high: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20',
    medium: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
    low: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold capitalize ${styles[lower] || styles.low}`}>
      {priority}
    </span>
  );
}

function DateRangeSelector({
  selectedIndex,
  onChange,
}: {
  selectedIndex: number;
  onChange: (index: number) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-slate-100 p-1 gap-0.5">
      {DATE_RANGES.map((range, i) => (
        <button
          key={range.label}
          onClick={() => onChange(i)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            i === selectedIndex
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

function ConversionBreakdownCard({ entries, platform }: { entries: ConversionEntry[]; platform: string }) {
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const maxCount = entries[0]?.count ?? 1;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
        Conversion Breakdown
        <span className="ml-2 text-slate-400 font-normal normal-case">
          ({platform === 'meta' ? 'Meta Pixel' : 'Google Ads'})
        </span>
      </h3>
      <div className="space-y-3">
        {entries.map((entry) => {
          const pct = total > 0 ? (entry.count / total) * 100 : 0;
          const barWidth = maxCount > 0 ? (entry.count / maxCount) * 100 : 0;
          return (
            <div key={entry.type}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-slate-700">{entry.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-900 tabular-nums">{fmt(entry.count)}</span>
                  <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                </div>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    platform === 'meta' ? 'bg-blue-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Total</span>
        <span className="text-sm font-bold text-slate-900 tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  );
}

function BudgetPacingCard({
  totalSpend,
  monthlyBudget,
  dateRange,
}: {
  totalSpend: number;
  monthlyBudget: number | null;
  dateRange: string;
}) {
  if (!monthlyBudget || monthlyBudget <= 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Budget Pacing</h3>
        <p className="text-sm text-slate-400">No budget set for this account.</p>
      </div>
    );
  }

  if (dateRange !== 'This Month') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Budget Pacing</h3>
        <p className="text-lg font-bold text-slate-900 tabular-nums mb-1">{fmtMoney(monthlyBudget)}</p>
        <p className="text-xs text-slate-400">monthly budget</p>
        <p className="text-sm text-slate-400 mt-3">Budget pacing available for &lsquo;This Month&rsquo; range only.</p>
      </div>
    );
  }

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = daysInMonth - dayOfMonth;

  const dailyRunRate = dayOfMonth > 0 ? totalSpend / dayOfMonth : 0;
  const projectedSpend = dailyRunRate * daysInMonth;
  const pacingPct = (totalSpend / monthlyBudget) * 100;
  const projectedPct = (projectedSpend / monthlyBudget) * 100;

  // Color coding: green (on track), yellow (80-100%), red (over budget)
  let barColor = 'bg-emerald-500';
  let projectedColor = 'text-emerald-600';
  if (projectedPct > 100) {
    barColor = 'bg-red-500';
    projectedColor = 'text-red-600';
  } else if (projectedPct >= 80) {
    barColor = 'bg-amber-500';
    projectedColor = 'text-amber-600';
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Budget Pacing</h3>

      {/* Progress bar */}
      <div className="relative">
        <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
          <div
            className={`h-4 rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(pacingPct, 100)}%` }}
          />
        </div>
        {/* Projected marker */}
        {projectedPct > 0 && projectedPct <= 150 && (
          <div
            className="absolute top-0 h-4 w-0.5 bg-slate-900/60"
            style={{ left: `${Math.min(projectedPct, 100)}%` }}
            title={`Projected: ${fmtMoney(projectedSpend)}`}
          />
        )}
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-500">Current Spend</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums">{fmtMoney(totalSpend)}</p>
          <p className="text-xs text-slate-400 mt-0.5">of {fmtMoney(monthlyBudget)} budget</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Projected Monthly</p>
          <p className={`text-lg font-bold tabular-nums ${projectedColor}`}>{fmtMoney(projectedSpend)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{projectedPct.toFixed(0)}% of budget</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          Pacing: <span className="font-semibold text-slate-700">{pacingPct.toFixed(1)}%</span> used
        </span>
        <span className="text-slate-500">
          <span className="font-semibold text-slate-700">{daysRemaining}</span> day{daysRemaining !== 1 ? 's' : ''} remaining
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-400">
        Daily run rate: {fmtMoney(dailyRunRate)}/day
      </div>
    </div>
  );
}

// ── Inline editing components ────────────────────────────────────────────

function InlineSelect({
  clientId,
  field,
  value,
  options,
  placeholder,
  onSaved,
}: {
  clientId: string;
  field: string;
  value: string | null;
  options: { value: string; label: string }[];
  placeholder: string;
  onSaved: (field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleChange = async (newValue: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, [field]: newValue }),
      });
      if (res.ok) {
        onSaved(field, newValue);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setEditing(false)}
        className="text-sm border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)]"
      >
        <option value="">-- {placeholder} --</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer hover:text-[var(--creekside-blue)] transition-colors border-b border-dashed border-slate-300 hover:border-[var(--creekside-blue)]"
      title={`Click to change ${field.replace('_', ' ')}`}
    >
      {saving ? 'Saving...' : saved ? 'Saved!' : value || placeholder}
    </span>
  );
}

function InlineInput({
  clientId,
  field,
  value,
  type = 'text',
  placeholder,
  prefix,
  onSaved,
}: {
  clientId: string;
  field: string;
  value: string | number | null;
  type?: 'text' | 'number';
  placeholder: string;
  prefix?: string;
  onSaved: (field: string, value: string | number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(value ?? ''));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const newValue = type === 'number' ? Number(inputValue) : inputValue;
    if (String(newValue) === String(value)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, [field]: newValue }),
      });
      if (res.ok) {
        onSaved(field, newValue);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1">
        {prefix && <span className="text-sm text-slate-500">{prefix}</span>}
        <input
          autoFocus
          type={type}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          className="text-sm border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] w-32"
        />
      </div>
    );
  }

  const displayValue = value != null && value !== ''
    ? (prefix ? `${prefix}${type === 'number' ? Number(value).toLocaleString() : value}` : String(value))
    : null;

  return (
    <span
      onClick={() => { setInputValue(String(value ?? '')); setEditing(true); }}
      className="cursor-pointer hover:text-[var(--creekside-blue)] transition-colors border-b border-dashed border-slate-300 hover:border-[var(--creekside-blue)]"
      title={`Click to edit ${field.replace('_', ' ')}`}
    >
      {saving ? 'Saving...' : saved ? 'Saved!' : displayValue || placeholder}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export default function ClientReport({ client }: { client: ReportingClient }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [totals, setTotals] = useState<Totals>({ impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0 });
  const [conversionBreakdown, setConversionBreakdown] = useState<ConversionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dateRangeIndex, setDateRangeIndex] = useState(DEFAULT_RANGE_INDEX);
  const [kpiChanges, setKpiChanges] = useState<KpiChanges | null>(null);

  // Inline editing state
  const [teamMembers, setTeamMembers] = useState<{id: string; name: string; role: string}[]>([]);
  const [clientData, setClientData] = useState(client);

  // Notes state
  const [notes, setNotes] = useState(client.notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const currentRange = DATE_RANGES[dateRangeIndex];

  // ── Team members fetch ──────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/team')
      .then(res => res.ok ? res.json() : [])
      .then(data => setTeamMembers(Array.isArray(data) ? data : []))
      .catch(() => setTeamMembers([]));
  }, []);

  const handleFieldSaved = useCallback((field: string, value: string | number) => {
    setClientData(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    // Guard: skip API calls if no ad account is linked
    if (!client.ad_account_id) {
      setLoading(false);
      setError('No Meta ad account linked');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const range = DATE_RANGES[dateRangeIndex];

      // Fetch campaign-level data
      let campaignUrl: string;
      if (client.platform === 'meta') {
        campaignUrl = `/api/meta/insights?account_id=${encodeURIComponent(client.ad_account_id)}&level=campaign&time_range=${range.metaParam}`;
      } else {
        campaignUrl = `/api/google/insights?customer_id=${encodeURIComponent(client.ad_account_id)}&level=campaign&date_range=${range.googleParam}`;
      }

      // Fetch account-level data (for conversion breakdown)
      let accountUrl: string;
      if (client.platform === 'meta') {
        accountUrl = `/api/meta/insights?account_id=${encodeURIComponent(client.ad_account_id)}&level=account&time_range=${range.metaParam}`;
      } else {
        accountUrl = `/api/google/insights?customer_id=${encodeURIComponent(client.ad_account_id)}&level=account&date_range=${range.googleParam}`;
      }

      // Compute prior period dates for comparison
      const periods = computePriorPeriod(dateRangeIndex);

      let priorCampaignUrl: string;
      if (client.platform === 'meta') {
        priorCampaignUrl = `/api/meta/insights?account_id=${encodeURIComponent(client.ad_account_id)}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`;
      } else {
        priorCampaignUrl = `/api/google/insights?customer_id=${encodeURIComponent(client.ad_account_id)}&level=campaign&since=${periods.priorSince}&until=${periods.priorUntil}`;
      }

      // Fetch current + prior in parallel
      const [campaignRes, accountRes, priorCampaignRes] = await Promise.all([
        fetch(campaignUrl),
        fetch(accountUrl),
        fetch(priorCampaignUrl),
      ]);

      if (!campaignRes.ok) {
        const body = await campaignRes.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${campaignRes.status}`);
      }

      // ── Parse campaign data ──────────────────────────────────────────
      let campaignJson = await campaignRes.json();

      // Unwrap PipeBoard response for Meta
      if (client.platform === 'meta') {
        campaignJson = unwrapPipeboardResponse(campaignJson);
      }

      const rawData = campaignJson.data ?? campaignJson ?? [];
      const dataArr = Array.isArray(rawData) ? rawData : [];

      const normalized =
        client.platform === 'meta'
          ? dataArr.map(normalizeMetaCampaign)
          : dataArr.map(normalizeGoogleCampaign);

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

      // ── Parse prior-period campaign data ──────────────────────────────
      let priorT: Totals | null = null;
      if (priorCampaignRes.ok) {
        try {
          let priorJson = await priorCampaignRes.json();
          if (client.platform === 'meta') {
            priorJson = unwrapPipeboardResponse(priorJson);
          }
          const priorRawData = priorJson.data ?? priorJson ?? [];
          const priorDataArr = Array.isArray(priorRawData) ? priorRawData : [];
          const priorNormalized =
            client.platform === 'meta'
              ? priorDataArr.map(normalizeMetaCampaign)
              : priorDataArr.map(normalizeGoogleCampaign);

          priorT = priorNormalized.reduce(
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
          priorT.ctr = priorT.impressions > 0 ? priorT.clicks / priorT.impressions : 0;
          priorT.cpc = priorT.clicks > 0 ? priorT.cost / priorT.clicks : 0;
        } catch {
          // Prior period data is optional
        }
      }

      if (priorT) {
        setKpiChanges(computeKpiChanges(t, priorT));
      } else {
        setKpiChanges(null);
      }

      // ── Parse account/conversion data ────────────────────────────────
      let breakdown: ConversionEntry[] = [];

      if (accountRes.ok) {
        try {
          let accountJson = await accountRes.json();

          if (client.platform === 'meta') {
            accountJson = unwrapPipeboardResponse(accountJson);
            // Parse Meta conversion breakdown from account-level actions
            const rows = accountJson?.data ?? [];
            const breakdownMap: Record<string, number> = {};
            for (const row of (Array.isArray(rows) ? rows : [])) {
              const actions = ((row as Record<string, unknown>).actions ?? []) as Array<{ action_type: string; value: string }>;
              for (const action of actions) {
                if (META_CONVERSION_TYPES.has(action.action_type)) {
                  const count = parseInt(action.value, 10) || 0;
                  breakdownMap[action.action_type] = (breakdownMap[action.action_type] ?? 0) + count;
                }
              }
            }
            breakdown = Object.entries(breakdownMap)
              .map(([type, count]) => ({ type, label: META_CONVERSION_LABELS[type] || type, count }))
              .sort((a, b) => b.count - a.count);
          } else {
            // Google — use conversionBreakdown from API
            const convBreakdown = accountJson?.conversionBreakdown ?? [];
            breakdown = (convBreakdown as Array<{ name: string; conversions: number }>)
              .map((cb) => ({ type: cb.name, label: cb.name, count: cb.conversions }))
              .filter((e) => e.count > 0)
              .sort((a, b) => b.count - a.count);
          }
        } catch {
          // Account-level data is optional, don't fail
        }
      }

      setConversionBreakdown(breakdown);
      setLastRefreshed(new Date());
      startCooldown();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [client.platform, client.ad_account_id, dateRangeIndex]);

  const startCooldown = () => {
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
  };

  useEffect(() => {
    fetchData();
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeIndex]);

  const handleDateRangeChange = (index: number) => {
    if (index === dateRangeIndex) return;
    setDateRangeIndex(index);
    // Reset cooldown on range change so data fetches immediately
    setCooldownRemaining(0);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  };

  // ── Notes ────────────────────────────────────────────────────────────

  const handleSaveNotes = async () => {
    setNotesSaving(true);
    setNotesSaved(false);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: client.id, notes }),
      });
      if (!res.ok) throw new Error('Failed to save notes');
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
    } catch {
      alert('Failed to save notes. Please try again.');
    } finally {
      setNotesSaving(false);
    }
  };

  // ── Derived values ───────────────────────────────────────────────────

  const costPerLead = useMemo(
    () => (totals.conversions > 0 ? totals.cost / totals.conversions : 0),
    [totals.cost, totals.conversions]
  );

  const cooldownMin = Math.floor(cooldownRemaining / 60000);
  const cooldownSec = Math.floor((cooldownRemaining % 60000) / 1000);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">{client.client_name}</h1>
            {PARTNER_NOTES[client.client_name] && (
              <span className="text-sm text-slate-400 font-normal">{PARTNER_NOTES[client.client_name]}</span>
            )}
            <PlatformBadge platform={client.platform} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 flex-wrap">
            <span className="tabular-nums">
              Account: <span className="text-slate-700 font-medium">{client.ad_account_id}</span>
              {client.ad_account_name && (
                <span className="text-slate-400"> &mdash; {client.ad_account_name}</span>
              )}
            </span>
            <span>
              Manager: <InlineSelect
                clientId={client.id}
                field="account_manager"
                value={clientData.account_manager}
                options={teamMembers.map(t => ({ value: t.name, label: t.name }))}
                placeholder="Assign manager"
                onSaved={handleFieldSaved}
              />
            </span>
            <span>
              Operator: <InlineSelect
                clientId={client.id}
                field="platform_operator"
                value={clientData.platform_operator}
                options={teamMembers.map(t => ({ value: t.name, label: t.name }))}
                placeholder="Assign operator"
                onSaved={handleFieldSaved}
              />
            </span>
            <span>
              Priority: <InlineSelect
                clientId={client.id}
                field="priority"
                value={clientData.priority}
                options={[
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' },
                ]}
                placeholder="Set priority"
                onSaved={handleFieldSaved}
              />
            </span>
            <span>
              Budget: <InlineInput
                clientId={client.id}
                field="monthly_budget"
                value={clientData.monthly_budget}
                type="number"
                prefix="$"
                placeholder="Set budget"
                onSaved={handleFieldSaved}
              />
            </span>
          </div>
          {lastRefreshed && (
            <p className="text-xs text-slate-400 mt-1">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <DateRangeSelector selectedIndex={dateRangeIndex} onChange={handleDateRangeChange} />
          <button
            onClick={fetchData}
            disabled={loading || cooldownRemaining > 0}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              loading || cooldownRemaining > 0
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-[var(--creekside-blue)] text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20 hover:shadow-md active:scale-[0.98]'
            }`}
          >
            {loading
              ? 'Loading...'
              : cooldownRemaining > 0
              ? `Wait ${cooldownMin}:${cooldownSec.toString().padStart(2, '0')}`
              : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 ring-1 ring-inset ring-red-600/10">
          <p className="font-semibold">Error loading campaign data</p>
          <p className="text-sm mt-1 text-red-600">{error}</p>
        </div>
      )}

      {/* ── Loading spinner ─────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[var(--creekside-blue)]" />
            <span className="text-sm text-slate-500">Fetching {currentRange.label} data...</span>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Primary KPI Cards (large) ────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Leads"
              value={fmt(totals.conversions)}
              change={kpiChanges?.leads.pct ?? '--'}
              changeDirection={kpiChanges?.leads.direction}
              changeSentiment="positive-up"
              size="lg"
            />
            <KpiCard
              label="Cost Per Lead"
              value={totals.conversions > 0 ? fmtMoney(costPerLead) : '--'}
              change={kpiChanges?.cpl.pct ?? '--'}
              changeDirection={kpiChanges?.cpl.direction}
              changeSentiment="negative-up"
              size="lg"
            />
            <KpiCard
              label="Total Spend"
              value={fmtMoney(totals.cost)}
              change={kpiChanges?.spend.pct ?? '--'}
              changeDirection={kpiChanges?.spend.direction}
              changeSentiment="neutral"
              size="lg"
            />
            <KpiCard
              label="Budget Pacing"
              value={
                clientData.monthly_budget && clientData.monthly_budget > 0
                  ? `${((totals.cost / clientData.monthly_budget) * 100).toFixed(0)}%`
                  : '--'
              }
              change={
                clientData.monthly_budget && clientData.monthly_budget > 0
                  ? `${fmtMoney(totals.cost)} of ${fmtMoney(clientData.monthly_budget)}`
                  : 'No budget set'
              }
              changeSentiment="neutral"
              size="lg"
            />
          </div>

          {/* ── Secondary KPI Cards (small) ──────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="Impressions"
              value={fmt(totals.impressions)}
              change={kpiChanges?.impressions.pct ?? '--'}
              changeDirection={kpiChanges?.impressions.direction}
              changeSentiment="positive-up"
              size="sm"
            />
            <KpiCard
              label="Clicks"
              value={fmt(totals.clicks)}
              change={kpiChanges?.clicks.pct ?? '--'}
              changeDirection={kpiChanges?.clicks.direction}
              changeSentiment="positive-up"
              size="sm"
            />
            <KpiCard
              label="CTR"
              value={fmtPct(totals.ctr)}
              change={kpiChanges?.ctr.pct ?? '--'}
              changeDirection={kpiChanges?.ctr.direction}
              changeSentiment="positive-up"
              size="sm"
            />
            <KpiCard
              label="Avg CPC"
              value={fmtMoney(totals.cpc)}
              change={kpiChanges?.cpc.pct ?? '--'}
              changeDirection={kpiChanges?.cpc.direction}
              changeSentiment="negative-up"
              size="sm"
            />
          </div>

          {/* ── Budget Pacing + Goals ────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BudgetPacingCard totalSpend={totals.cost} monthlyBudget={clientData.monthly_budget} dateRange={currentRange.label} />

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Goals</h3>
                <p className="text-sm text-slate-700">
                  <InlineInput
                    clientId={client.id}
                    field="goals"
                    value={clientData.goals}
                    type="text"
                    placeholder="Click to set goals"
                    onSaved={handleFieldSaved}
                  />
                </p>
              </div>
              {client.monthly_revenue != null && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Monthly Revenue</h3>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">{fmtMoney(client.monthly_revenue)}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Conversion Breakdown ────────────────────────────────────── */}
          <ConversionBreakdownCard entries={conversionBreakdown} platform={client.platform} />

          {/* ── Campaigns Table ─────────────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Campaigns</h2>
            <CampaignsTable campaigns={campaigns} platform={client.platform} />
          </div>
        </>
      )}

      {/* ── Notes Section ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Notes</h2>
          <div className="flex items-center gap-3">
            {notesSaved && (
              <span className="text-xs text-emerald-600 font-medium">Saved</span>
            )}
            <button
              onClick={handleSaveNotes}
              disabled={notesSaving}
              className="bg-[var(--creekside-blue)] text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              {notesSaving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes about this client..."
          rows={4}
          className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent resize-y ring-1 ring-inset ring-slate-200"
        />
      </div>
    </div>
  );
}

'use client';

interface DateRangeOption {
  label: string;
  metaParam: string;
  googleParam: string;
}

export const DATE_RANGES: DateRangeOption[] = [
  { label: '7d', metaParam: 'last_7d', googleParam: 'LAST_7_DAYS' },
  { label: '14d', metaParam: 'last_14d', googleParam: 'LAST_14_DAYS' },
  { label: '30d', metaParam: 'last_30d', googleParam: 'LAST_30_DAYS' },
  { label: 'This Month', metaParam: 'this_month', googleParam: 'THIS_MONTH' },
  { label: 'Last Month', metaParam: 'last_month', googleParam: 'LAST_MONTH' },
];

export const DEFAULT_RANGE_INDEX = 2; // 30d

interface ReportHeaderProps {
  clientName: string;
  platform: string;
  dateRangeIndex: number;
  onDateRangeChange: (index: number) => void;
  loading: boolean;
  onRefresh: () => void;
  lastRefreshed: Date | null;
  cooldownRemaining: number;
}

export default function ReportHeader({
  clientName,
  platform,
  dateRangeIndex,
  onDateRangeChange,
  loading,
  onRefresh,
  lastRefreshed,
  cooldownRemaining,
}: ReportHeaderProps) {
  const platformKey = platform?.toLowerCase();
  const isOther = platformKey === 'other';
  const isMeta = platformKey === 'meta';
  const cooldownMin = Math.floor(cooldownRemaining / 60000);
  const cooldownSec = Math.floor((cooldownRemaining % 60000) / 1000);

  const badgeClasses = isOther
    ? 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-600/20'
    : isMeta
    ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20'
    : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20';

  const dotClasses = isOther
    ? 'bg-red-500'
    : isMeta
    ? 'bg-blue-500'
    : 'bg-emerald-500';

  const badgeLabel = isOther
    ? 'AI Agent'
    : isMeta
    ? 'Meta Ads'
    : 'Google Ads';

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{clientName}</h1>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${badgeClasses}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dotClasses}`} />
            {badgeLabel}
          </span>
        </div>
        {lastRefreshed && (
          <p className="text-xs text-slate-400 mt-1">
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="inline-flex items-center rounded-lg bg-slate-100 p-1 gap-0.5">
          {DATE_RANGES.map((range, i) => (
            <button
              key={range.label}
              onClick={() => onDateRangeChange(i)}
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
        <button
          onClick={onRefresh}
          disabled={loading || cooldownRemaining > 0}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            loading || cooldownRemaining > 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-[#2563eb] text-white hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98]'
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
  );
}

// ── Prior-period date computation ───────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export interface PriorPeriodDates {
  currentSince: string;
  currentUntil: string;
  priorSince: string;
  priorUntil: string;
}

export function computePriorPeriod(rangeIndex: number): PriorPeriodDates {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const label = DATE_RANGES[rangeIndex].label;
  let currentSince: Date;
  let currentUntil: Date;
  let priorSince: Date;
  let priorUntil: Date;

  switch (label) {
    case '7d': {
      currentUntil = new Date(today); currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil); currentSince.setDate(currentSince.getDate() - 6);
      priorUntil = new Date(currentSince); priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil); priorSince.setDate(priorSince.getDate() - 6);
      break;
    }
    case '14d': {
      currentUntil = new Date(today); currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil); currentSince.setDate(currentSince.getDate() - 13);
      priorUntil = new Date(currentSince); priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil); priorSince.setDate(priorSince.getDate() - 13);
      break;
    }
    case '30d': {
      currentUntil = new Date(today); currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil); currentSince.setDate(currentSince.getDate() - 29);
      priorUntil = new Date(currentSince); priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil); priorSince.setDate(priorSince.getDate() - 29);
      break;
    }
    case 'This Month': {
      currentSince = new Date(today.getFullYear(), today.getMonth(), 1);
      currentUntil = new Date(today); currentUntil.setDate(currentUntil.getDate() - 1);
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
      currentUntil = new Date(today); currentUntil.setDate(currentUntil.getDate() - 1);
      currentSince = new Date(currentUntil); currentSince.setDate(currentSince.getDate() - 29);
      priorUntil = new Date(currentSince); priorUntil.setDate(priorUntil.getDate() - 1);
      priorSince = new Date(priorUntil); priorSince.setDate(priorSince.getDate() - 29);
    }
  }

  return {
    currentSince: formatDate(currentSince),
    currentUntil: formatDate(currentUntil),
    priorSince: formatDate(priorSince),
    priorUntil: formatDate(priorUntil),
  };
}

// ── Change calculation ──────────────────────────────────────────────────

export function calcChange(current: number, prior: number): { pct: string; direction: 'up' | 'down' | 'flat' } {
  if (prior === 0 && current === 0) return { pct: '--', direction: 'flat' };
  if (prior === 0) return { pct: 'New', direction: 'up' };
  const change = ((current - prior) / prior) * 100;
  if (Math.abs(change) < 0.5) return { pct: '0%', direction: 'flat' };
  return {
    pct: `${Math.abs(change).toFixed(1)}%`,
    direction: change > 0 ? 'up' : 'down',
  };
}

// ── Formatting helpers ──────────────────────────────────────────────────

export function fmt(n: number): string {
  return n.toLocaleString();
}

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// ── PipeBoard response unwrapper ────────────────────────────────────────

export function unwrapPipeboardResponse(json: Record<string, unknown>): Record<string, unknown> {
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

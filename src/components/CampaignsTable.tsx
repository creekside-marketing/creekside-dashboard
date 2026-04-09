'use client';

import { useState, useMemo } from 'react';

interface Campaign {
  name: string;
  status: string | number;
  type?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
}

interface CampaignsTableProps {
  campaigns: Campaign[];
  platform: 'meta' | 'google';
}

type SortKey = keyof Campaign;

function StatusDot({ status }: { status: string | number }) {
  const lower = String(status ?? '').toLowerCase();
  const dotColor =
    lower === 'active' || lower === 'enabled'
      ? 'bg-emerald-500'
      : lower === 'paused'
      ? 'bg-amber-500'
      : 'bg-slate-300';
  const textColor =
    lower === 'active' || lower === 'enabled'
      ? 'text-emerald-700'
      : lower === 'paused'
      ? 'text-amber-700'
      : 'text-slate-500';

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium capitalize ${textColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      {lower}
    </span>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-all ${active ? 'text-slate-700' : 'text-slate-300 group-hover:text-slate-400'}`}
      viewBox="0 0 14 14"
      fill="currentColor"
    >
      {active && direction === 'asc' ? (
        <path d="M7 3l5 8H2z" />
      ) : active && direction === 'desc' ? (
        <path d="M7 11L2 3h10z" />
      ) : (
        <>
          <path d="M7 3l4 5H3z" opacity="0.4" />
          <path d="M7 11L3 6h8z" opacity="0.4" />
        </>
      )}
    </svg>
  );
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export default function CampaignsTable({ campaigns, platform }: CampaignsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeOnly, setActiveOnly] = useState(true);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filtered = useMemo(() => {
    if (!activeOnly) return campaigns;
    return campaigns.filter((c) => {
      const s = String(c.status ?? '').toLowerCase() ?? '';
      return s === 'active' || s === 'enabled';
    });
  }, [campaigns, activeOnly]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, c) => ({
        impressions: acc.impressions + c.impressions,
        clicks: acc.clicks + c.clicks,
        cost: acc.cost + c.cost,
        conversions: acc.conversions + c.conversions,
      }),
      { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    );
  }, [filtered]);

  const totalCtr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const totalCpc = totals.clicks > 0 ? totals.cost / totals.clicks : 0;
  const totalCostPerConv = totals.conversions > 0 ? totals.cost / totals.conversions : 0;

  const columns: { key: SortKey; label: string; align?: 'right' }[] = [
    { key: 'name', label: 'Campaign Name' },
    { key: 'status', label: 'Status' },
    ...(platform === 'google' ? [{ key: 'type' as SortKey, label: 'Type' }] : []),
    { key: 'impressions', label: 'Impressions', align: 'right' as const },
    { key: 'clicks', label: 'Clicks', align: 'right' as const },
    { key: 'ctr', label: 'CTR', align: 'right' as const },
    { key: 'cpc', label: 'Avg CPC', align: 'right' as const },
    { key: 'cost', label: 'Spend', align: 'right' as const },
    { key: 'conversions', label: 'Leads', align: 'right' as const },
    { key: 'costPerConversion', label: 'CPL', align: 'right' as const },
  ];

  const pausedCount = campaigns.length - campaigns.filter((c) => {
    const s = String(c.status ?? '').toLowerCase() ?? '';
    return s === 'active' || s === 'enabled';
  }).length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Filter toggle */}
      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          {filtered.length} campaign{filtered.length !== 1 ? 's' : ''}
          {activeOnly && pausedCount > 0 && (
            <span className="text-slate-400 font-normal ml-1">
              ({pausedCount} paused hidden)
            </span>
          )}
        </h3>
        <button
          onClick={() => setActiveOnly((v) => !v)}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
            activeOnly
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100'
              : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300/50 hover:bg-slate-200'
          }`}
        >
          {activeOnly ? 'Active only' : 'All campaigns'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-4 cursor-pointer select-none hover:text-slate-900 transition-colors group ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <SortIcon active={sortKey === col.key} direction={sortDir} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center text-slate-400 py-12 text-sm">
                  No campaign data available.
                </td>
              </tr>
            ) : (
              sorted.map((c, idx) => (
                <tr
                  key={`${c.name}-${idx}`}
                  className="border-b border-slate-100 transition-colors hover:bg-blue-50/50"
                >
                  <td className="text-sm font-medium text-slate-900 py-3.5 px-4 max-w-[280px] truncate">
                    {c.name}
                  </td>
                  <td className="text-sm py-3.5 px-4">
                    <StatusDot status={c.status} />
                  </td>
                  {platform === 'google' && (
                    <td className="text-sm text-slate-600 py-3.5 px-4">{c.type ?? '--'}</td>
                  )}
                  <td className="text-sm text-slate-700 py-3.5 px-4 tabular-nums text-right">{fmt(c.impressions)}</td>
                  <td className="text-sm text-slate-700 py-3.5 px-4 tabular-nums text-right">{fmt(c.clicks)}</td>
                  <td className="text-sm text-slate-700 py-3.5 px-4 tabular-nums text-right">{fmtPct(c.ctr)}</td>
                  <td className="text-sm text-slate-700 py-3.5 px-4 tabular-nums text-right">{fmtMoney(c.cpc)}</td>
                  <td className="text-sm text-slate-700 py-3.5 px-4 tabular-nums text-right">{fmtMoney(c.cost)}</td>
                  <td className="text-sm text-slate-700 py-3.5 px-4 tabular-nums text-right font-medium">{fmt(c.conversions)}</td>
                  <td className="text-sm text-slate-700 py-3.5 px-4 tabular-nums text-right">
                    {c.conversions > 0 ? fmtMoney(c.costPerConversion) : <span className="text-slate-300">--</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50/80 border-t-2 border-slate-300">
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4">{activeOnly ? 'Totals (active)' : 'Totals'}</td>
                <td className="text-sm py-3.5 px-4" />
                {platform === 'google' && <td className="text-sm py-3.5 px-4" />}
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4 tabular-nums text-right">{fmt(totals.impressions)}</td>
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4 tabular-nums text-right">{fmt(totals.clicks)}</td>
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4 tabular-nums text-right">{fmtPct(totalCtr)}</td>
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4 tabular-nums text-right">{fmtMoney(totalCpc)}</td>
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4 tabular-nums text-right">{fmtMoney(totals.cost)}</td>
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4 tabular-nums text-right">{fmt(totals.conversions)}</td>
                <td className="text-sm font-bold text-slate-900 py-3.5 px-4 tabular-nums text-right">
                  {totals.conversions > 0 ? fmtMoney(totalCostPerConv) : <span className="text-slate-300">--</span>}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

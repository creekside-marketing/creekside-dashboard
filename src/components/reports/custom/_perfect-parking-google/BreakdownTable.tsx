'use client';

import { useState, useMemo } from 'react';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: (value: unknown) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataRow = Record<string, any>;

interface BreakdownTableProps {
  title: string;
  columns: Column[];
  data: DataRow[];
  maxRows?: number;
}

function defaultFormat(value: unknown): string {
  if (value == null) return '--';
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value.toLocaleString();
    return '--';
  }
  return String(value);
}

export default function BreakdownTable({ title, columns, data, maxRows = 10 }: BreakdownTableProps) {
  const [sortKey, setSortKey] = useState<string>(columns.length > 1 ? columns[columns.length - 1].key : columns[0].key);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState(false);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    const arr = [...data];
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
  }, [data, sortKey, sortDir]);

  const displayed = expanded ? sorted : sorted.slice(0, maxRows);
  const hasMore = sorted.length > maxRows;

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{title}</h3>
        <p className="text-sm text-slate-400">No data available</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-left w-10">#</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 cursor-pointer select-none hover:text-slate-900 transition-colors ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((row, idx) => (
              <tr key={idx} className="border-b border-slate-100 hover:bg-blue-50/50 transition-colors">
                <td className="text-xs text-yellow-400 py-3 px-4">{idx + 1}.</td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`text-sm py-3 px-4 tabular-nums ${
                      col.align === 'right' ? 'text-right text-yellow-400' : 'text-left text-slate-900 font-medium'
                    } ${idx === 0 && col.key === columns[0].key ? 'max-w-[300px] truncate' : ''}`}
                  >
                    {col.format ? col.format(row[col.key]) : defaultFormat(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 text-center">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-sm text-[#2563eb] hover:text-blue-700 font-medium transition-colors"
          >
            {expanded ? 'Show less' : `Show all ${sorted.length} rows`}
          </button>
        </div>
      )}
    </div>
  );
}

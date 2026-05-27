'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';

interface AllocationRow {
  client_name: string;
  platform: string | null;
  hours_per_week: number | null;
  monthly_amount: number;
}

interface TeamMemberPayload {
  id: string;
  name: string;
  role: string | null;
  hourly_rate: number | null;
  monthly_retainer: number | null;
  status: string;
  bandwidth_remaining_hours: number | null;
  current_hours_per_week: number;
  total_monthly_pay: number;
  allocations: AllocationRow[];
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '--';
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatHours(value: number | null | undefined): string {
  if (value == null) return '--';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}`;
}

function PlatformBadge({ platform }: { platform: string | null }) {
  if (!platform) return <span className="text-slate-300 text-sm">--</span>;
  const lower = platform.toLowerCase();
  const config: Record<string, { bg: string; dot: string; label: string }> = {
    meta: { bg: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20', dot: 'bg-blue-500', label: 'Meta' },
    google: { bg: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20', dot: 'bg-emerald-500', label: 'Google' },
    other: { bg: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20', dot: 'bg-red-500', label: 'Other' },
    programmatic: { bg: 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20', dot: 'bg-yellow-500', label: 'Programmatic' },
    email: { bg: 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20', dot: 'bg-purple-500', label: 'Email' },
    chatgpt: { bg: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20', dot: 'bg-red-500', label: 'ChatGPT Ads' },
  };
  const c = config[lower] ?? { bg: 'bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-500/20', dot: 'bg-slate-500', label: platform };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${c.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'amber' | 'slate' }) {
  const accentStyles =
    accent === 'green'
      ? 'border-emerald-200 bg-white text-emerald-700'
      : accent === 'amber'
      ? 'border-amber-200 bg-white text-amber-700'
      : 'border-slate-200 bg-white text-slate-700';
  return (
    <div className={`rounded-lg border ${accentStyles} px-3 py-2 min-w-[120px]`}>
      <div className="text-[10px] uppercase tracking-wide opacity-60">{label}</div>
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
    </div>
  );
}

function MemberCard({ m }: { m: TeamMemberPayload }) {
  const compLabel = m.monthly_retainer
    ? `$${m.monthly_retainer.toLocaleString()}/mo retainer`
    : m.hourly_rate
    ? `$${m.hourly_rate}/hr`
    : 'Rate not set';

  const totalRow = (
    <tr className="bg-slate-50 font-semibold border-t-2 border-slate-300">
      <td className="px-4 py-2 text-sm text-slate-900">Total</td>
      <td className="px-4 py-2"></td>
      <td className="px-4 py-2 text-sm text-slate-900 tabular-nums text-right">
        {m.current_hours_per_week > 0 ? formatHours(m.current_hours_per_week) : '--'}
      </td>
      <td className="px-4 py-2 text-sm text-slate-900 tabular-nums text-right">
        {m.total_monthly_pay > 0 ? formatCurrency(m.total_monthly_pay) : '--'}
      </td>
    </tr>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{m.name}</h2>
            <div className="text-xs text-slate-500 mt-0.5">
              {m.role || 'Team member'} · {compLabel}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatPill
              label="Pay / Mo"
              value={formatCurrency(m.monthly_retainer ?? m.total_monthly_pay)}
              accent="green"
            />
            <StatPill
              label="Current Hrs / Wk"
              value={formatHours(m.current_hours_per_week)}
              accent="slate"
            />
            <StatPill
              label="Bandwidth Left"
              value={m.bandwidth_remaining_hours != null ? `${m.bandwidth_remaining_hours} hrs` : '--'}
              accent={
                m.bandwidth_remaining_hours == null
                  ? 'slate'
                  : m.bandwidth_remaining_hours >= 10
                  ? 'green'
                  : 'amber'
              }
            />
          </div>
        </div>
      </div>

      {m.allocations.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          No active client allocations.
          {m.bandwidth_remaining_hours != null && (
            <span> Has {m.bandwidth_remaining_hours} hrs/wk of available bandwidth.</span>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Platform</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Hrs / Wk</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pay / Mo</th>
              </tr>
            </thead>
            <tbody>
              {m.allocations.map((a, idx) => (
                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 text-sm text-slate-900">{a.client_name}</td>
                  <td className="px-4 py-2"><PlatformBadge platform={a.platform} /></td>
                  <td className="px-4 py-2 text-sm text-slate-700 tabular-nums text-right">
                    {a.hours_per_week != null ? formatHours(a.hours_per_week) : <span className="text-slate-300">--</span>}
                  </td>
                  <td className="px-4 py-2 text-sm text-slate-700 tabular-nums text-right">
                    {formatCurrency(a.monthly_amount)}
                  </td>
                </tr>
              ))}
              {totalRow}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMemberPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/team/allocations', { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as TeamMemberPayload[];
      setMembers(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summary = useMemo(() => {
    const totalHours = members.reduce((s, m) => s + m.current_hours_per_week, 0);
    const totalPay = members.reduce(
      (s, m) => s + (m.monthly_retainer ?? m.total_monthly_pay),
      0,
    );
    const bandwidth = members.reduce((s, m) => s + (m.bandwidth_remaining_hours ?? 0), 0);
    return { totalHours, totalPay, bandwidth, count: members.length };
  }, [members]);

  return (
    <div className="min-h-screen bg-[var(--creekside-navy,#0b1530)] text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-sm text-slate-400 mt-1">
            Per-freelancer view: clients, hours, pay, and bandwidth. Bandwidth values come from the May 18 2026 Peterson + Cade check-in.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Team Members</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{summary.count}</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Total Hours / Wk</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{formatHours(summary.totalHours)}</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Total Pay / Mo</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{formatCurrency(summary.totalPay)}</div>
          </div>
          <div className="bg-white rounded-lg border border-emerald-200 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700">Bandwidth Left</div>
            <div className="text-xl font-bold text-emerald-700 tabular-nums">{summary.bandwidth} hrs</div>
          </div>
        </div>

        {loading && <div className="text-slate-300">Loading team data…</div>}
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 text-red-700 px-4 py-3 text-sm">
            Error: {error}
          </div>
        )}
        {!loading && !error && (
          <div className="space-y-6">
            {members.map(m => (
              <MemberCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

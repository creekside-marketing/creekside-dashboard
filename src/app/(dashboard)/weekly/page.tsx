'use client';

import { useEffect, useState } from 'react';

interface WeeklyData {
  weekOf: string;
  // Revenue
  newMRR: number;
  lostMRR: number;
  netNewMRR: number;
  // Sales
  callsBooked: number;
  callsShowed: number;
  dealsClose: number;
  closeRate: number;
  qualifiedCallRate: number;
  // Operations
  qaErrors: number;
  lostClients: number;
  mrrAtRisk: number;
  activeOnboarding: number;
}

interface GoalProgress {
  targetMRR: number;
  goalDate: string;
  currentMRR: number;
  mrrNeededPerWeek: number;
  weeksRemaining: number;
  onTrack: boolean;
}

function MetricCard({ label, value, subtext, trend }: {
  label: string;
  value: string;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  const trendColor = trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-500' : 'text-slate-400';
  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-4">
      <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{value}</p>
      {subtext && <p className={`text-xs mt-1 ${trendColor}`}>{subtext}</p>}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{title}</h3>;
}

export default function WeeklyScorecardPage() {
  const [goal, setGoal] = useState<GoalProgress | null>(null);
  const [weeks, setWeeks] = useState<WeeklyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/weekly-scorecard');
        const data = await res.json();
        if (data.goal) setGoal(data.goal);
        if (data.weeks) setWeeks(data.weeks);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const current = weeks[0] ?? null;
  const previous = weeks[1] ?? null;

  function fmt(n: number | undefined): string {
    if (n == null) return '--';
    return n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toLocaleString()}`;
  }

  function pct(n: number | undefined): string {
    if (n == null) return '--';
    return `${(n * 100).toFixed(0)}%`;
  }

  function delta(curr: number | undefined, prev: number | undefined): { text: string; trend: 'up' | 'down' | 'neutral' } {
    if (curr == null || prev == null) return { text: '', trend: 'neutral' };
    const diff = curr - prev;
    if (diff === 0) return { text: 'No change', trend: 'neutral' };
    return {
      text: `${diff > 0 ? '+' : ''}${diff >= 1000 || diff <= -1000 ? `$${(diff / 1000).toFixed(1)}K` : diff.toLocaleString()} vs last week`,
      trend: diff > 0 ? 'up' : 'down',
    };
  }

  if (loading) {
    return <div className="p-12 text-center text-slate-400 text-sm">Loading weekly scorecard...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Weekly Scorecard</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Track progress toward MRR goal with weekly sales and operations metrics</p>
      </div>

      {/* MRR Goal Progress */}
      {goal && (
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-6">
          <div className="flex items-center justify-between mb-4">
            <SectionHeader title="MRR Goal Progress" />
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${goal.onTrack ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {goal.onTrack ? 'On Track' : 'Behind Pace'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Target MRR</p>
              <p className="text-lg font-bold text-[var(--text-primary)]">{fmt(goal.targetMRR)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Current MRR</p>
              <p className="text-lg font-bold text-[var(--text-primary)]">{fmt(goal.currentMRR)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Needed / Week</p>
              <p className="text-lg font-bold text-[var(--text-primary)]">{fmt(goal.mrrNeededPerWeek)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Goal Date</p>
              <p className="text-lg font-bold text-[var(--text-primary)]">{goal.goalDate}</p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
              <span>{fmt(goal.currentMRR)}</span>
              <span>{fmt(goal.targetMRR)}</span>
            </div>
            <div className="w-full bg-[var(--bg-tertiary)] rounded-full h-3">
              <div
                className="bg-[var(--accent)] h-3 rounded-full transition-all"
                style={{ width: `${Math.min((goal.currentMRR / goal.targetMRR) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* This Week's Metrics */}
      {current && (
        <>
          {/* Revenue */}
          <div className="space-y-3">
            <SectionHeader title="Revenue" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard
                label="New MRR"
                value={fmt(current.newMRR)}
                subtext={delta(current.newMRR, previous?.newMRR).text}
                trend={delta(current.newMRR, previous?.newMRR).trend}
              />
              <MetricCard
                label="Lost MRR"
                value={fmt(current.lostMRR)}
                subtext={delta(current.lostMRR, previous?.lostMRR).text}
                trend={current.lostMRR <= (previous?.lostMRR ?? 0) ? 'up' : 'down'}
              />
              <MetricCard
                label="Net New MRR"
                value={fmt(current.netNewMRR)}
                subtext={delta(current.netNewMRR, previous?.netNewMRR).text}
                trend={delta(current.netNewMRR, previous?.netNewMRR).trend}
              />
            </div>
          </div>

          {/* Sales */}
          <div className="space-y-3">
            <SectionHeader title="Sales" />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <MetricCard label="Calls Booked" value={String(current.callsBooked)} />
              <MetricCard label="Calls Showed" value={String(current.callsShowed)} />
              <MetricCard label="Deals Closed" value={String(current.dealsClose)} />
              <MetricCard label="Close Rate" value={pct(current.closeRate)} />
              <MetricCard label="Qualified Rate" value={pct(current.qualifiedCallRate)} />
            </div>
          </div>

          {/* Operations */}
          <div className="space-y-3">
            <SectionHeader title="Operations" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <MetricCard
                label="QA Errors"
                value={String(current.qaErrors)}
                trend={current.qaErrors === 0 ? 'up' : 'down'}
              />
              <MetricCard label="Lost Clients" value={String(current.lostClients)} />
              <MetricCard label="MRR at Risk" value={fmt(current.mrrAtRisk)} />
              <MetricCard label="Active Onboarding" value={String(current.activeOnboarding)} />
            </div>
          </div>
        </>
      )}

      {/* Weekly History Table */}
      {weeks.length > 0 && (
        <div className="space-y-3">
          <SectionHeader title="Weekly History" />
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">Week</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">New MRR</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">Lost MRR</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">Net</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">Booked</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">Showed</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">Closed</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">Close %</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase">QA Err</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.weekOf} className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50">
                      <td className="py-3 px-4 text-sm font-medium text-[var(--text-primary)]">{w.weekOf}</td>
                      <td className="py-3 px-4 text-sm text-right text-emerald-600">{fmt(w.newMRR)}</td>
                      <td className="py-3 px-4 text-sm text-right text-red-500">{fmt(w.lostMRR)}</td>
                      <td className={`py-3 px-4 text-sm text-right font-medium ${w.netNewMRR >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(w.netNewMRR)}</td>
                      <td className="py-3 px-4 text-sm text-right text-[var(--text-secondary)]">{w.callsBooked}</td>
                      <td className="py-3 px-4 text-sm text-right text-[var(--text-secondary)]">{w.callsShowed}</td>
                      <td className="py-3 px-4 text-sm text-right text-[var(--text-secondary)]">{w.dealsClose}</td>
                      <td className="py-3 px-4 text-sm text-right text-[var(--text-secondary)]">{pct(w.closeRate)}</td>
                      <td className={`py-3 px-4 text-sm text-right ${w.qaErrors > 0 ? 'text-red-500 font-medium' : 'text-slate-400'}`}>{w.qaErrors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!current && !loading && (
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-12 text-center">
          <p className="text-slate-400 text-sm">No weekly scorecard data yet. Data will appear here once the weekly scorecard API is populated.</p>
        </div>
      )}
    </div>
  );
}

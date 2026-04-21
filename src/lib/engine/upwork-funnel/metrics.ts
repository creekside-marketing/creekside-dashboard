import type {
  UpworkJob,
  FunnelMetrics,
  MonthlyDataPoint,
  ScriptPerformanceRow,
  HoursAfterPostBucket,
  BreakdownRow,
} from '@/lib/types/upwork-funnel';

/* ── Helpers ── */

function safeDiv(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/* ── Overall funnel ── */

/**
 * All rates (viewRate, replyRate, callRate, winRate) use totalApplications as
 * the denominator — not the prior funnel stage. This matches Peterson's analysis
 * convention: "what % of all applications reached this stage."
 * The one exception is callToCloseRate which is won/salesCalls.
 *
 * Averages (avgConnectsPerApp, avgCompetingProposals, avgHoursAfterPost) are
 * computed only over rows where the value is non-null.
 */
export function computeFunnelMetrics(jobs: UpworkJob[]): FunnelMetrics {
  const total = jobs.length;
  const viewed = jobs.filter((j) => j.viewed).length;
  const messaged = jobs.filter((j) => j.messaged).length;
  const calls = jobs.filter((j) => j.sales_call).length;
  const won = jobs.filter((j) => j.won).length;

  const connects = jobs.map((j) => j.connects_spent).filter((c): c is number => c != null);
  const totalConnects = connects.reduce((a, b) => a + b, 0);

  const competition = jobs.map((j) => j.competing_proposals).filter((c): c is number => c != null);
  const hours = jobs.map((j) => j.hours_after_post).filter((h): h is number => h != null);

  return {
    totalApplications: total,
    totalViewed: viewed,
    totalMessaged: messaged,
    totalSalesCalls: calls,
    totalWon: won,
    viewRate: safeDiv(viewed, total),
    replyRate: safeDiv(messaged, total),
    callRate: safeDiv(calls, total),
    winRate: safeDiv(won, total),
    callToCloseRate: safeDiv(won, calls),
    totalConnectsSpent: totalConnects,
    avgConnectsPerApp: avg(connects),
    connectsPerCall: safeDiv(totalConnects, calls),
    connectsPerWin: safeDiv(totalConnects, won),
    avgCompetingProposals: avg(competition),
    avgHoursAfterPost: avg(hours),
  };
}

/* ── Monthly trend ── */

export function computeMonthlyTrend(jobs: UpworkJob[]): MonthlyDataPoint[] {
  const byMonth = new Map<string, UpworkJob[]>();

  for (const job of jobs) {
    if (!job.application_date) continue;
    const month = job.application_date.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(job);
    byMonth.set(month, arr);
  }

  // Exclude current (incomplete) month, keep last 12 complete months
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return Array.from(byMonth.entries())
    .filter(([month]) => month < currentMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, group]) => {
      const total = group.length;
      const competition = group.map((j) => j.competing_proposals).filter((c): c is number => c != null);
      const hours = group.map((j) => j.hours_after_post).filter((h): h is number => h != null);
      return {
        month,
        applications: total,
        viewRate: safeDiv(group.filter((j) => j.viewed).length, total),
        replyRate: safeDiv(group.filter((j) => j.messaged).length, total),
        callRate: safeDiv(group.filter((j) => j.sales_call).length, total),
        winRate: safeDiv(group.filter((j) => j.won).length, total),
        avgCompetingProposals: avg(competition),
        avgHoursAfterPost: avg(hours),
      };
    });
}

/* ── Script performance ── */

export function computeScriptPerformance(jobs: UpworkJob[]): ScriptPerformanceRow[] {
  const byScript = new Map<string, UpworkJob[]>();

  for (const job of jobs) {
    const key = job.script_used ?? 'Unknown';
    const arr = byScript.get(key) ?? [];
    arr.push(job);
    byScript.set(key, arr);
  }

  const excludedScripts = new Set(['Unknown', 'Steven + Chat', 'Grace + Chat']);
  return Array.from(byScript.entries())
    .filter(([name, group]) => group.length >= 50 && !excludedScripts.has(name))
    .map(([scriptName, group]) => {
      const total = group.length;
      const connects = group.map((j) => j.connects_spent).filter((c): c is number => c != null);
      return {
        scriptName,
        count: total,
        viewRate: safeDiv(group.filter((j) => j.viewed).length, total),
        replyRate: safeDiv(group.filter((j) => j.messaged).length, total),
        callRate: safeDiv(group.filter((j) => j.sales_call).length, total),
        winRate: safeDiv(group.filter((j) => j.won).length, total),
        avgConnects: avg(connects),
      };
    })
    .sort((a, b) => b.count - a.count);
}

/* ── Hours after post buckets ── */

const HOUR_BUCKETS: { label: string; range: [number, number] }[] = [
  { label: '0-2h', range: [0, 2] },
  { label: '2-6h', range: [2, 6] },
  { label: '6-12h', range: [6, 12] },
  { label: '12-24h', range: [12, 24] },
  { label: '24h+', range: [24, Infinity] },
];

export function computeHoursAfterPostBuckets(jobs: UpworkJob[]): HoursAfterPostBucket[] {
  return HOUR_BUCKETS.map(({ label, range }) => {
    const group = jobs.filter((j) => {
      if (j.hours_after_post == null) return false;
      return j.hours_after_post >= range[0] && j.hours_after_post < range[1];
    });
    const total = group.length;
    return {
      label,
      range,
      count: total,
      viewRate: safeDiv(group.filter((j) => j.viewed).length, total),
      replyRate: safeDiv(group.filter((j) => j.messaged).length, total),
      callRate: safeDiv(group.filter((j) => j.sales_call).length, total),
      winRate: safeDiv(group.filter((j) => j.won).length, total),
    };
  });
}

/* ── Generic breakdown (source type, profile, business type, platform) ── */

export function computeBreakdown(jobs: UpworkJob[], keyFn: (j: UpworkJob) => string): BreakdownRow[] {
  const byKey = new Map<string, UpworkJob[]>();

  for (const job of jobs) {
    const key = keyFn(job);
    const arr = byKey.get(key) ?? [];
    arr.push(job);
    byKey.set(key, arr);
  }

  return Array.from(byKey.entries())
    .map(([name, group]) => {
      const total = group.length;
      return {
        name,
        count: total,
        viewRate: safeDiv(group.filter((j) => j.viewed).length, total),
        replyRate: safeDiv(group.filter((j) => j.messaged).length, total),
        callRate: safeDiv(group.filter((j) => j.sales_call).length, total),
        winRate: safeDiv(group.filter((j) => j.won).length, total),
      };
    })
    .sort((a, b) => b.count - a.count);
}

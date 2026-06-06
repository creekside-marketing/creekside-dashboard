import type {
  UpworkJob,
  FunnelMetrics,
  MonthlyDataPoint,
  WeeklyDataPoint,
  ScriptPerformanceRow,
  ScriptMonthCell,
  ScriptMonthlyComparison,
  HoursAfterPostBucket,
  BreakdownRow,
  BoostComparisonMetrics,
  TrendGranularity,
  TrendDataPoint,
} from '@/lib/types/upwork-funnel';

/* ── Helpers ── */

function safeDiv(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Format a Date as YYYY-MM-DD in local time (avoids UTC shift from toISOString) */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/* ── Unified trend (monthly / weekly / daily) ── */

function getGroupKey(dateStr: string, granularity: TrendGranularity): string {
  if (granularity === 'monthly') return dateStr.slice(0, 7); // YYYY-MM
  if (granularity === 'daily') return dateStr; // YYYY-MM-DD
  // weekly: find Monday of that week
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return localDateStr(monday);
}

function getCurrentPeriodKey(granularity: TrendGranularity): string {
  const now = new Date();
  if (granularity === 'monthly') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (granularity === 'daily') return localDateStr(now);
  // weekly: current week's Monday
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  return localDateStr(monday);
}

function formatTrendLabel(key: string, granularity: TrendGranularity): string {
  if (granularity === 'monthly') return key.slice(2); // YY-MM
  // For weekly and daily, show M/D/YY
  const d = new Date(key + 'T00:00:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const y = String(d.getFullYear()).slice(2);
  return `${m}/${day}/${y}`;
}

const TREND_LIMITS: Record<TrendGranularity, number> = {
  monthly: 12,
  weekly: 26,
  daily: 90,
};

export function computeTrend(jobs: UpworkJob[], granularity: TrendGranularity): TrendDataPoint[] {
  const byPeriod = new Map<string, UpworkJob[]>();

  for (const job of jobs) {
    if (!job.application_date) continue;
    const key = getGroupKey(job.application_date, granularity);
    const arr = byPeriod.get(key) ?? [];
    arr.push(job);
    byPeriod.set(key, arr);
  }

  const currentKey = getCurrentPeriodKey(granularity);
  const limit = TREND_LIMITS[granularity];

  return Array.from(byPeriod.entries())
    .filter(([key]) => key < currentKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([key, group]) => {
      const total = group.length;
      const viewed = group.filter((j) => j.viewed).length;
      const messaged = group.filter((j) => j.messaged).length;
      const calls = group.filter((j) => j.sales_call).length;
      const won = group.filter((j) => j.won).length;
      return {
        label: formatTrendLabel(key, granularity),
        applications: total,
        viewRate: safeDiv(viewed, total),
        replyRate: safeDiv(messaged, total),
        callRate: safeDiv(calls, total),
        winRate: safeDiv(won, total),
        viewToReply: safeDiv(messaged, viewed),
        replyToCall: safeDiv(calls, messaged),
        callToWin: safeDiv(won, calls),
        replyToWin: safeDiv(won, messaged),
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

/* ── Script performance by month (apples-to-apples) ── */

export function computeScriptMonthlyComparison(jobs: UpworkJob[]): ScriptMonthlyComparison {
  const excludedScripts = new Set(['Unknown', 'Steven + Chat', 'Grace + Chat']);

  // Group by month+script
  const data = new Map<string, Map<string, UpworkJob[]>>();
  const scriptCounts = new Map<string, number>();

  for (const job of jobs) {
    if (!job.application_date) continue;
    const script = job.script_used ?? 'Unknown';
    if (excludedScripts.has(script)) continue;

    scriptCounts.set(script, (scriptCounts.get(script) ?? 0) + 1);
    const month = job.application_date.slice(0, 7);

    if (!data.has(month)) data.set(month, new Map());
    const monthMap = data.get(month)!;
    if (!monthMap.has(script)) monthMap.set(script, []);
    monthMap.get(script)!.push(job);
  }

  // Only include scripts with >= 30 total applications
  const qualifiedScripts = Array.from(scriptCounts.entries())
    .filter(([, count]) => count >= 30)
    .map(([name]) => name)
    .sort();

  // Build cell data
  const cellData = new Map<string, Map<string, ScriptMonthCell>>();
  const months: string[] = [];

  for (const [month, scriptMap] of Array.from(data.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const hasQualified = qualifiedScripts.some((s) => scriptMap.has(s));
    if (!hasQualified) continue;
    months.push(month);

    cellData.set(month, new Map());
    for (const script of qualifiedScripts) {
      const group = scriptMap.get(script);
      if (!group || group.length === 0) continue;
      const total = group.length;
      cellData.get(month)!.set(script, {
        count: total,
        viewRate: safeDiv(group.filter((j) => j.viewed).length, total),
        replyRate: safeDiv(group.filter((j) => j.messaged).length, total),
        callRate: safeDiv(group.filter((j) => j.sales_call).length, total),
      });
    }
  }

  return { months: months.slice(-12), scripts: qualifiedScripts, data: cellData };
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

/* ── Weekly trend ── */

/**
 * Groups jobs by ISO week (Monday start) and computes per-week counts
 * and stage-to-stage conversion rates. Excludes the current incomplete week.
 */
export function computeWeeklyTrend(jobs: UpworkJob[]): WeeklyDataPoint[] {
  const byWeek = new Map<string, UpworkJob[]>();

  for (const job of jobs) {
    if (!job.application_date) continue;
    const d = new Date(job.application_date + 'T00:00:00');
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const key = localDateStr(monday);
    const arr = byWeek.get(key) ?? [];
    arr.push(job);
    byWeek.set(key, arr);
  }

  // Find current week's Monday to exclude incomplete week
  const now = new Date();
  const nowDay = now.getDay();
  const currentMonday = new Date(now);
  currentMonday.setDate(now.getDate() - ((nowDay + 6) % 7));
  const currentWeekKey = localDateStr(currentMonday);

  return Array.from(byWeek.entries())
    .filter(([weekOf]) => weekOf < currentWeekKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekOf, group]) => {
      const d = new Date(weekOf + 'T00:00:00');
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const y = String(d.getFullYear()).slice(2);
      const applied = group.length;
      const viewed = group.filter((j) => j.viewed).length;
      const messaged = group.filter((j) => j.messaged).length;
      const salesCalls = group.filter((j) => j.sales_call).length;
      const won = group.filter((j) => j.won).length;
      return {
        weekOf,
        weekLabel: `${m}/${day}/${y}`,
        applied,
        viewed,
        messaged,
        salesCalls,
        won,
        viewRate: safeDiv(viewed, applied) * 100,
        viewsToReplies: safeDiv(messaged, viewed) * 100,
        repliesToCalls: safeDiv(salesCalls, messaged) * 100,
        callsToClients: safeDiv(won, salesCalls) * 100,
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

/* ── Boost comparison ── */

const CONNECT_COST = 0.15;

function computeBoostSegment(jobs: UpworkJob[], label: string, useTotalCost: boolean): BoostComparisonMetrics {
  const applications = jobs.length;
  const views = jobs.filter((j) => j.viewed).length;
  const replies = jobs.filter((j) => j.messaged).length;
  const calls = jobs.filter((j) => j.sales_call).length;
  const won = jobs.filter((j) => j.won).length;
  const totalConnects = jobs.reduce((sum, j) => {
    const base = j.connects_spent ?? 0;
    const boost = useTotalCost ? (j.boost_spend ?? 0) : 0;
    return sum + base + boost;
  }, 0);
  const totalCost = totalConnects * CONNECT_COST;

  return {
    label,
    applications,
    views,
    replies,
    calls,
    won,
    totalConnects,
    viewRate: safeDiv(views, applications),
    replyRate: safeDiv(replies, applications),
    callRate: safeDiv(calls, applications),
    winRate: safeDiv(won, applications),
    costPerView: safeDiv(totalCost, views),
    costPerReply: safeDiv(totalCost, replies),
    costPerCall: safeDiv(totalCost, calls),
    costPerWin: safeDiv(totalCost, won),
  };
}

export function computeBoostComparison(jobs: UpworkJob[]): { boosted: BoostComparisonMetrics; unboosted: BoostComparisonMetrics } {
  const boostedJobs = jobs.filter((j) => j.boosted);
  const unboostedJobs = jobs.filter((j) => !j.boosted);
  return {
    boosted: computeBoostSegment(boostedJobs, 'Boosted', true),
    unboosted: computeBoostSegment(unboostedJobs, 'Unboosted', false),
  };
}

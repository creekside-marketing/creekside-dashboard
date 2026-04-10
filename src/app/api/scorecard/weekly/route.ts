import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * GET /api/scorecard/weekly
 *
 * Returns pipeline activity from ClickUp Sales workspace, close rate by person
 * (Peterson vs Cade), MRR movement from weekly_scorecard, and estimated avg deal size.
 *
 * CANNOT: write data, modify tables, or access non-sales data.
 */

const CALL_STATUSES = ['call #1', 'call #2', 'call requested'];
const DISCUSSION_STATUSES = ['in discussion', 'follow up post-call', 'follow up pre-call', 'pursuing', 'email follow-up', 'follow up  pre-call'];
const WON_STATUSES = ['won'];
const LOST_STATUSES = ['lost (follow up)', 'lost (dnd)', 'unresponsive', 'unresponsive/lost'];
const SALES_SPACES = ['Sales', 'Sales Pipeline'];

interface ClickUpRow {
  status: string;
  assignees: string | null;
  date_created: string;
  date_closed: string | null;
  task_name: string;
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isCloser(assignees: string | null, name: string): boolean {
  if (!assignees) return false;
  return assignees.toLowerCase().includes(name.toLowerCase());
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Fetch all sales pipeline tasks from last 8 weeks + all-time for close rates
    const eightWeeksAgo = new Date();
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

    const [recentRes, allClosedRes, scorecardRes, recentClientsRes] = await Promise.all([
      // Recent pipeline activity (8 weeks)
      supabase
        .from('clickup_entries')
        .select('status, assignees, date_created, date_closed, task_name')
        .in('space_name', SALES_SPACES)
        .gte('date_created', eightWeeksAgo.toISOString()),

      // Closed deals for close rate calculation (rolling 12 months, capped at 500)
      supabase
        .from('clickup_entries')
        .select('status, assignees, date_created, date_closed, task_name')
        .in('space_name', SALES_SPACES)
        .in('status', [...WON_STATUSES, ...LOST_STATUSES])
        .limit(500),

      // Weekly scorecard MRR data
      supabase
        .from('weekly_scorecard')
        .select('week_of, new_mrr, lost_mrr, net_new_mrr, projected_mrr')
        .order('week_of', { ascending: false })
        .limit(8),

      // Recently onboarded clients for avg deal size
      supabase
        .from('reporting_clients')
        .select('client_name, monthly_revenue')
        .eq('status', 'active')
        .not('monthly_revenue', 'is', null),
    ]);

    if (recentRes.error) throw new Error(`clickup_entries query failed: ${recentRes.error.message}`);
    if (allClosedRes.error) throw new Error(`closed deals query failed: ${allClosedRes.error.message}`);

    const recentTasks = (recentRes.data ?? []) as ClickUpRow[];
    const allClosed = (allClosedRes.data ?? []) as ClickUpRow[];

    // ── Weekly pipeline breakdown ──────────────────────────────────────
    const weekMap: Record<string, {
      weekOf: string;
      callsScheduled: number;
      inDiscussion: number;
      won: number;
      lost: number;
      totalCreated: number;
    }> = {};

    for (const task of recentTasks) {
      const createdWeek = getWeekStart(new Date(task.date_created));
      if (!weekMap[createdWeek]) {
        weekMap[createdWeek] = { weekOf: createdWeek, callsScheduled: 0, inDiscussion: 0, won: 0, lost: 0, totalCreated: 0 };
      }
      weekMap[createdWeek].totalCreated++;
      const s = task.status.toLowerCase();
      if (CALL_STATUSES.includes(s)) weekMap[createdWeek].callsScheduled++;
      if (DISCUSSION_STATUSES.includes(s)) weekMap[createdWeek].inDiscussion++;

      // Bucket won/lost by date_closed (when the deal actually resolved), not date_created
      const closedWeek = task.date_closed
        ? getWeekStart(new Date(task.date_closed))
        : createdWeek;
      if (WON_STATUSES.includes(s)) {
        if (!weekMap[closedWeek]) {
          weekMap[closedWeek] = { weekOf: closedWeek, callsScheduled: 0, inDiscussion: 0, won: 0, lost: 0, totalCreated: 0 };
        }
        weekMap[closedWeek].won++;
      }
      if (LOST_STATUSES.includes(s)) {
        if (!weekMap[closedWeek]) {
          weekMap[closedWeek] = { weekOf: closedWeek, callsScheduled: 0, inDiscussion: 0, won: 0, lost: 0, totalCreated: 0 };
        }
        weekMap[closedWeek].lost++;
      }
    }

    const weeks = Object.values(weekMap)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf))
      .slice(0, 8);

    const currentWeekStart = getWeekStart(new Date());
    const currentWeek = weeks.find((w) => w.weekOf === currentWeekStart) ?? {
      weekOf: currentWeekStart,
      callsScheduled: 0,
      inDiscussion: 0,
      won: 0,
      lost: 0,
      totalCreated: 0,
    };

    // ── Close rate by person (all-time) ────────────────────────────────
    function calcCloseRate(name: string) {
      const personDeals = allClosed.filter((t) => isCloser(t.assignees, name));
      const won = personDeals.filter((t) => WON_STATUSES.includes(t.status.toLowerCase())).length;
      const lost = personDeals.filter((t) => LOST_STATUSES.includes(t.status.toLowerCase())).length;
      const total = won + lost;
      const rate = total > 0 ? (won / total) * 100 : 0;

      // Avg days to close for won deals
      const wonDeals = personDeals.filter(
        (t) => WON_STATUSES.includes(t.status.toLowerCase()) && t.date_closed
      );
      let avgDaysToClose = 0;
      if (wonDeals.length > 0) {
        const totalDays = wonDeals.reduce((sum, t) => {
          const created = new Date(t.date_created).getTime();
          const closed = new Date(t.date_closed!).getTime();
          return sum + (closed - created) / (1000 * 60 * 60 * 24);
        }, 0);
        avgDaysToClose = Math.round(totalDays / wonDeals.length);
      }

      return { won, lost, total, rate: Math.round(rate * 10) / 10, avgDaysToClose };
    }

    const closeRateByPerson = {
      peterson: calcCloseRate('Peterson'),
      cade: calcCloseRate('Kenneth Cade MacLean'),
    };

    // ── Avg deal size (estimated from reporting_clients) ───────────────
    const revenues = (recentClientsRes.data ?? [])
      .map((r: { monthly_revenue: number | null }) => Number(r.monthly_revenue) || 0)
      .filter((v: number) => v > 0);
    const avgDealSize = revenues.length > 0
      ? Math.round(revenues.reduce((a: number, b: number) => a + b, 0) / revenues.length)
      : 0;

    // ── Weekly scorecard MRR data ──────────────────────────────────────
    const scorecardWeeks = (scorecardRes.data ?? []).map((w: Record<string, unknown>) => ({
      weekOf: w.week_of as string,
      newMRR: Number(w.new_mrr) || 0,
      lostMRR: Number(w.lost_mrr) || 0,
      netMRR: Number(w.net_new_mrr) || 0,
      projectedMRR: Number(w.projected_mrr) || 0,
    }));

    return NextResponse.json({
      currentWeek,
      weeks,
      closeRateByPerson,
      avgDealSize,
      scorecardWeeks,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

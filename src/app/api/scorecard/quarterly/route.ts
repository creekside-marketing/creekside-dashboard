import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { PARTNER_NAMES, OPERATOR_MAP } from '@/lib/scorecard-constants';

/**
 * GET /api/scorecard/quarterly
 *
 * Returns client lifetime value stats, platform profitability,
 * and time-to-close metrics for the quarterly scorecard section.
 *
 * CANNOT: write data, modify tables, or access non-financial data.
 */

interface ClientRow {
  id: string;
  name: string;
  start_date: string | null;
  status: string;
}

interface RevenueRow {
  client_id: string;
  total_revenue: number;
  month_date: string;
}

interface ReportingRow {
  client_name: string;
  platform: string;
  monthly_revenue: number | null;
  platform_operator: string | null;
  status: string;
}

interface LaborRow {
  month_date: string;
  name: string;
  total_labor_cost: number;
}

interface ClickUpRow {
  status: string;
  assignees: string | null;
  date_created: string;
  date_closed: string | null;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    const [clientsRes, revAggRes, reportingRes, laborRes, clickupRes] = await Promise.all([
      // All clients with start_date
      supabase
        .from('clients')
        .select('id, name, start_date, status')
        .not('start_date', 'is', null),

      // Lifetime revenue by client — fetch all rows and aggregate in-memory
      supabase
        .from('revenue_by_client')
        .select('client_id, total_revenue, month_date')
        .not('client_id', 'is', null),

      // Active reporting_clients for platform profitability
      supabase
        .from('reporting_clients')
        .select('client_name, platform, monthly_revenue, platform_operator, status')
        .eq('status', 'active'),

      // Latest month of labor data
      supabase
        .from('labor_by_team_member')
        .select('month_date, name, total_labor_cost')
        .order('month_date', { ascending: false })
        .limit(100),

      // Won deals for time-to-close
      supabase
        .from('clickup_entries')
        .select('status, assignees, date_created, date_closed')
        .in('space_name', ['Sales', 'Sales Pipeline'])
        .eq('status', 'won')
        .not('date_closed', 'is', null),
    ]);

    if (clientsRes.error) throw new Error(`clients query failed: ${clientsRes.error.message}`);
    if (revAggRes.error) throw new Error(`revenue_by_client query failed: ${revAggRes.error.message}`);
    if (reportingRes.error) throw new Error(`reporting_clients query failed: ${reportingRes.error.message}`);

    const clients = (clientsRes.data ?? []) as ClientRow[];
    const revRows = (revAggRes.data ?? []) as RevenueRow[];
    const reportingRows = ((reportingRes.data ?? []) as ReportingRow[]).filter(
      (r) => !PARTNER_NAMES.has(r.client_name)
    );
    const laborRows = (laborRes.data ?? []) as LaborRow[];
    const wonDeals = (clickupRes.data ?? []) as ClickUpRow[];

    // ── Client Lifetime Value ───────────────────────────────────────────
    // Aggregate revenue rows in-memory by client_id
    const revByClientId: Record<string, { total: number; months: number }> = {};
    for (const r of revRows) {
      if (!revByClientId[r.client_id]) {
        revByClientId[r.client_id] = { total: 0, months: 0 };
      }
      revByClientId[r.client_id].total += Number(r.total_revenue) || 0;
      revByClientId[r.client_id].months++;
    }
    // Deduplicate months (multiple entries per month per client)
    const monthsByClient: Record<string, Set<string>> = {};
    for (const r of revRows) {
      if (!monthsByClient[r.client_id]) monthsByClient[r.client_id] = new Set();
      monthsByClient[r.client_id].add(r.month_date);
    }
    for (const [cid, months] of Object.entries(monthsByClient)) {
      if (revByClientId[cid]) revByClientId[cid].months = months.size;
    }

    const now = new Date();
    const ltvClients: {
      name: string;
      status: string;
      monthsRetained: number;
      lifetimeRevenue: number;
    }[] = [];

    for (const client of clients) {
      if (!client.start_date) continue;
      const rev = revByClientId[client.id];
      if (!rev) continue;

      const startDate = new Date(client.start_date);
      const monthsRetained = Math.max(
        1,
        Math.round(
          (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        )
      );

      ltvClients.push({
        name: client.name,
        status: client.status,
        monthsRetained,
        lifetimeRevenue: Math.round(rev.total),
      });
    }

    // Stats
    const activeWithLTV = ltvClients.filter((c) => c.status === 'active');
    const allWithLTV = ltvClients.filter((c) => c.lifetimeRevenue > 0);

    const avgMonthsRetained = allWithLTV.length > 0
      ? Math.round(allWithLTV.reduce((s, c) => s + c.monthsRetained, 0) / allWithLTV.length)
      : 0;

    const avgLTV = allWithLTV.length > 0
      ? Math.round(allWithLTV.reduce((s, c) => s + c.lifetimeRevenue, 0) / allWithLTV.length)
      : 0;

    const sortedLTVs = allWithLTV.map((c) => c.lifetimeRevenue).sort((a, b) => a - b);
    const medianLTV = sortedLTVs.length > 0
      ? sortedLTVs[Math.floor(sortedLTVs.length / 2)]
      : 0;

    const totalActiveLTV = activeWithLTV.reduce((s, c) => s + c.lifetimeRevenue, 0);

    const topClients = [...ltvClients]
      .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue)
      .slice(0, 10)
      .map((c) => ({
        name: c.name,
        status: c.status,
        monthsRetained: c.monthsRetained,
        lifetimeRevenue: c.lifetimeRevenue,
      }));

    // ── Platform Profitability ──────────────────────────────────────────
    const platformStats: Record<string, {
      clientNames: Set<string>;
      totalRevenue: number;
      operators: Set<string>;
    }> = {};

    for (const row of reportingRows) {
      const p = row.platform?.toLowerCase() ?? 'other';
      if (!platformStats[p]) platformStats[p] = { clientNames: new Set(), totalRevenue: 0, operators: new Set() };
      platformStats[p].clientNames.add(row.client_name);
      platformStats[p].totalRevenue += Number(row.monthly_revenue) || 0;
      if (row.platform_operator) platformStats[p].operators.add(row.platform_operator);
    }

    // Estimate operator costs per platform
    const laborMonths = [...new Set(laborRows.map((r) => r.month_date))].sort().reverse();
    const currentLaborMonth = laborMonths[0] ?? null;
    const currentLabor = currentLaborMonth
      ? laborRows.filter((r) => r.month_date === currentLaborMonth)
      : [];

    function getOperatorCost(opName: string): number {
      const fullName = OPERATOR_MAP[opName];
      if (!fullName) return 0;
      const entry = currentLabor.find(
        (l) => l.name.toLowerCase().includes(fullName.split(' ')[0].toLowerCase())
      );
      return entry ? Number(entry.total_labor_cost) : 0;
    }

    const platformProfitability = Object.entries(platformStats).map(([platform, stats]) => {
      // Estimate cost: sum operator costs, split by how many platforms each operator serves
      let estOperatorCost = 0;
      for (const opName of stats.operators) {
        const cost = getOperatorCost(opName);
        // Count how many platforms this operator works on
        const platformsForOp = Object.values(platformStats).filter((ps) => ps.operators.has(opName)).length;
        estOperatorCost += platformsForOp > 0 ? cost / platformsForOp : cost;
      }

      const margin = stats.totalRevenue - estOperatorCost;
      const marginPct = stats.totalRevenue > 0 ? (margin / stats.totalRevenue) * 100 : 0;

      return {
        platform: platform.charAt(0).toUpperCase() + platform.slice(1),
        clientCount: stats.clientNames.size,
        revenue: Math.round(stats.totalRevenue),
        estOperatorCost: Math.round(estOperatorCost),
        margin: Math.round(margin),
        marginPct: Math.round(marginPct * 10) / 10,
      };
    }).sort((a, b) => b.revenue - a.revenue);

    // ── Time to Close ───────────────────────────────────────────────────
    function calcTimeToClose(name: string) {
      const deals = wonDeals.filter(
        (d) => d.assignees?.toLowerCase().includes(name.toLowerCase())
      );
      if (deals.length === 0) return { avgDays: 0, dealCount: 0 };
      const totalDays = deals.reduce((sum, d) => {
        const created = new Date(d.date_created).getTime();
        const closed = new Date(d.date_closed!).getTime();
        return sum + (closed - created) / (1000 * 60 * 60 * 24);
      }, 0);
      return {
        avgDays: Math.round(totalDays / deals.length),
        dealCount: deals.length,
      };
    }

    const allTimeToClose = wonDeals.length > 0
      ? Math.round(
          wonDeals.reduce((sum, d) => {
            const created = new Date(d.date_created).getTime();
            const closed = new Date(d.date_closed!).getTime();
            return sum + (closed - created) / (1000 * 60 * 60 * 24);
          }, 0) / wonDeals.length
        )
      : 0;

    const acquisitionMetrics = {
      avgDaysToClose: allTimeToClose,
      totalDealsAnalyzed: wonDeals.length,
      byPerson: {
        peterson: calcTimeToClose('Peterson'),
        cade: calcTimeToClose('Kenneth Cade MacLean'),
      },
    };

    return NextResponse.json({
      ltv: {
        avgMonthsRetained,
        avgLTV,
        medianLTV,
        totalActiveLTV,
        clientsAnalyzed: allWithLTV.length,
        topClients,
      },
      platformProfitability,
      acquisitionMetrics,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

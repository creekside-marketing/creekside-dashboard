import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculatePlatformRevenue } from '@/lib/fee-engine';
import type { FeeConfig } from '@/lib/fee-engine';
import { PARTNER_NAMES, OPERATOR_MAP } from '@/lib/scorecard-constants';

/**
 * GET /api/scorecard/monthly
 *
 * Returns revenue by manager, operator margin by client, churn log,
 * and upsell candidates for the monthly scorecard section.
 *
 * CANNOT: write data, modify tables, or access non-financial data.
 */

interface ReportingRow {
  client_name: string;
  platform: string;
  monthly_budget: number | null;
  monthly_revenue: number | null;
  fee_config: FeeConfig | null;
  revenue_override: boolean;
  status: string;
  account_manager: string | null;
  platform_operator: string | null;
  client_id: string | null;
  client_category: string | null;
  churned_date: string | null;
  churn_reason: string | null;
}

interface RevenueRow {
  month_date: string;
  month: string;
  name: string;
  client_id: string | null;
  total_revenue: number;
}

interface LaborRow {
  month_date: string;
  name: string;
  total_labor_cost: number;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoStr = threeMonthsAgo.toISOString().slice(0, 10);

    const [clientsRes, revenueRes, laborRes, churnRes] = await Promise.all([
      supabase
        .from('reporting_clients')
        .select('client_name, platform, monthly_budget, monthly_revenue, fee_config, revenue_override, status, account_manager, platform_operator, client_id, client_category, churned_date, churn_reason')
        .eq('status', 'active'),

      supabase
        .from('revenue_by_client')
        .select('month_date, month, name, client_id, total_revenue')
        .gte('month_date', threeMonthsAgoStr)
        .order('month_date', { ascending: false }),

      supabase
        .from('labor_by_team_member')
        .select('month_date, name, total_labor_cost')
        .gte('month_date', threeMonthsAgoStr)
        .order('month_date', { ascending: false }),

      supabase
        .from('reporting_clients')
        .select('client_name, platform, monthly_budget, monthly_revenue, account_manager, churned_date, churn_reason')
        .eq('status', 'churned')
        .not('churned_date', 'is', null)
        .gte('churned_date', threeMonthsAgoStr)
        .order('churned_date', { ascending: false }),
    ]);

    if (clientsRes.error) throw new Error(`reporting_clients query failed: ${clientsRes.error.message}`);
    if (revenueRes.error) throw new Error(`revenue_by_client query failed: ${revenueRes.error.message}`);
    if (laborRes.error) throw new Error(`labor_by_team_member query failed: ${laborRes.error.message}`);

    const activeRows = ((clientsRes.data ?? []) as ReportingRow[]).filter(
      (r) => !PARTNER_NAMES.has(r.client_name)
    );
    const revenueRows = (revenueRes.data ?? []) as RevenueRow[];
    const laborRows = (laborRes.data ?? []) as LaborRow[];
    const churnRows = (churnRes.data ?? []) as ReportingRow[];

    // ── Revenue by Manager ──────────────────────────────────────────────
    // Estimated MRR from fee_config (current snapshot)
    const clientBudgets: Record<string, number> = {};
    for (const row of activeRows) {
      clientBudgets[row.client_name] = (clientBudgets[row.client_name] ?? 0) + (row.monthly_budget ?? 0);
    }

    const managerEstimated: Record<string, { clients: Set<string>; estimatedMRR: number }> = {};
    for (const row of activeRows) {
      const mgr = row.account_manager ?? 'Unassigned';
      if (!managerEstimated[mgr]) managerEstimated[mgr] = { clients: new Set(), estimatedMRR: 0 };
      managerEstimated[mgr].clients.add(row.client_name);

      let rowRevenue = 0;
      if (row.revenue_override && row.monthly_revenue != null) {
        rowRevenue = Number(row.monthly_revenue);
      } else if (row.fee_config && row.monthly_budget != null && row.monthly_budget > 0) {
        const totalBudget = clientBudgets[row.client_name] ?? Number(row.monthly_budget);
        rowRevenue = calculatePlatformRevenue(row.fee_config, Number(row.monthly_budget), totalBudget);
      } else if (row.monthly_revenue != null && Number(row.monthly_revenue) > 0) {
        rowRevenue = Number(row.monthly_revenue);
      }
      managerEstimated[mgr].estimatedMRR += rowRevenue;
    }

    // Actual revenue by manager (last 3 months from accounting)
    // Build client_id → manager lookup from reporting_clients
    const clientIdToManager: Record<string, string> = {};
    for (const row of activeRows) {
      if (row.client_id && row.account_manager) {
        clientIdToManager[row.client_id] = row.account_manager;
      }
    }

    // Group actual revenue by manager and month
    const actualByManagerMonth: Record<string, Record<string, number>> = {};
    for (const rev of revenueRows) {
      const mgr = (rev.client_id && clientIdToManager[rev.client_id]) || 'Unattributed';
      if (!actualByManagerMonth[mgr]) actualByManagerMonth[mgr] = {};
      actualByManagerMonth[mgr][rev.month_date] = (actualByManagerMonth[mgr][rev.month_date] ?? 0) + Number(rev.total_revenue);
    }

    const revenueByManager = Object.entries(managerEstimated)
      .filter(([mgr]) => mgr !== 'Unassigned')
      .map(([manager, data]) => ({
        manager,
        clientCount: data.clients.size,
        estimatedMRR: Math.round(data.estimatedMRR),
        actualRevenue: Object.entries(actualByManagerMonth[manager] ?? {})
          .map(([monthDate, total]) => ({ monthDate, total: Math.round(total) }))
          .sort((a, b) => b.monthDate.localeCompare(a.monthDate)),
      }))
      .sort((a, b) => b.estimatedMRR - a.estimatedMRR);

    // ── Operator Margin ─────────────────────────────────────────────────
    // Get the most recent month of labor data
    const laborMonths = [...new Set(laborRows.map((r) => r.month_date))].sort().reverse();
    const currentLaborMonth = laborMonths[0] ?? null;

    const operatorStats: Record<string, {
      clients: Set<string>;
      totalRevenue: number;
      operatorCost: number;
    }> = {};

    for (const row of activeRows) {
      if (!row.platform_operator || row.platform_operator === '') continue;
      const op = row.platform_operator;
      if (!operatorStats[op]) operatorStats[op] = { clients: new Set(), totalRevenue: 0, operatorCost: 0 };
      operatorStats[op].clients.add(row.client_name);

      let rowRevenue = 0;
      if (row.revenue_override && row.monthly_revenue != null) {
        rowRevenue = Number(row.monthly_revenue);
      } else if (row.fee_config && row.monthly_budget != null && row.monthly_budget > 0) {
        const totalBudget = clientBudgets[row.client_name] ?? Number(row.monthly_budget);
        rowRevenue = calculatePlatformRevenue(row.fee_config, Number(row.monthly_budget), totalBudget);
      } else if (row.monthly_revenue != null) {
        rowRevenue = Number(row.monthly_revenue);
      }
      operatorStats[op].totalRevenue += rowRevenue;
    }

    // Match operator costs from labor data
    if (currentLaborMonth) {
      const laborThisMonth = laborRows.filter((r) => r.month_date === currentLaborMonth);
      for (const [opName, stats] of Object.entries(operatorStats)) {
        const fullName = OPERATOR_MAP[opName];
        if (fullName) {
          const laborEntry = laborThisMonth.find(
            (l) => l.name.toLowerCase().includes(fullName.split(' ')[0].toLowerCase())
          );
          if (laborEntry) {
            stats.operatorCost = Number(laborEntry.total_labor_cost);
          }
        }
      }
    }

    const operatorMargin = Object.entries(operatorStats)
      .map(([operator, stats]) => {
        const margin = stats.totalRevenue - stats.operatorCost;
        const marginPct = stats.totalRevenue > 0 ? (margin / stats.totalRevenue) * 100 : 0;
        return {
          operator,
          clientCount: stats.clients.size,
          totalRevenue: Math.round(stats.totalRevenue),
          operatorCost: Math.round(stats.operatorCost),
          margin: Math.round(margin),
          marginPct: Math.round(marginPct * 10) / 10,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    // ── Churn Log ───────────────────────────────────────────────────────
    // Deduplicate by client_name (can have multiple platform rows)
    const EXCLUDE_FROM_CHURN = new Set(['test', 'Chriss Soh', 'Airport Self Storage']);
    const seenChurn = new Set<string>();
    const churnLog = churnRows
      .filter((r) => {
        if (EXCLUDE_FROM_CHURN.has(r.client_name)) return false;
        const key = r.client_name + r.churned_date;
        if (seenChurn.has(key)) return false;
        seenChurn.add(key);
        return true;
      })
      .map((r) => {
        // Sum revenue across all platform rows for this churned client
        const allRows = churnRows.filter((cr) => cr.client_name === r.client_name);
        const totalRevenueLost = allRows.reduce(
          (sum, cr) => sum + (Number(cr.monthly_revenue) || 0), 0
        );
        return {
          client: r.client_name,
          date: r.churned_date,
          revenueLost: Math.round(totalRevenueLost),
          reason: r.churn_reason ?? null,
          manager: r.account_manager ?? 'Unknown',
          platform: allRows.map((cr) => cr.platform).join(', '),
        };
      });

    // ── Upsell Candidates ───────────────────────────────────────────────
    const seenUpsell = new Set<string>();
    const upsellCandidates = activeRows
      .filter((r) => {
        if (r.client_category !== 'retainer') return false;
        if (seenUpsell.has(r.client_name)) return false;
        seenUpsell.add(r.client_name);
        return true;
      })
      .map((r) => {
        const allRows = activeRows.filter((ar) => ar.client_name === r.client_name);
        const totalRevenue = allRows.reduce((sum, ar) => sum + (Number(ar.monthly_revenue) || 0), 0);
        const totalBudget = allRows.reduce((sum, ar) => sum + (Number(ar.monthly_budget) || 0), 0);
        return {
          client: r.client_name,
          category: r.client_category,
          currentRevenue: Math.round(totalRevenue),
          platform: allRows.map((ar) => ar.platform).join(', '),
          budget: Math.round(totalBudget),
        };
      });

    return NextResponse.json({
      revenueByManager,
      operatorMargin,
      churnLog,
      upsellCandidates,
      laborMonth: currentLaborMonth,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

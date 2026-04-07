import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * GET /api/scorecard/pnl
 *
 * Returns the last 6 months from monthly_pnl, expense_breakdown,
 * and labor_by_team_member views for the scorecard P&L section.
 *
 * CANNOT: write data, modify views, or access non-financial tables.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    // Fetch all three views in parallel
    const [pnlRes, expenseRes, laborRes] = await Promise.all([
      supabase.rpc('execute_readonly_query', {
        query_text: `SELECT month_date, month, total_revenue, total_expenses, net_profit,
          profit_margin_pct, square_revenue, upwork_revenue, other_revenue,
          labor_cost, software_cost, processing_fees, marketing_cost, advertising_cost,
          transaction_count
        FROM monthly_pnl ORDER BY month_date DESC LIMIT 6`,
      }),
      supabase.rpc('execute_readonly_query', {
        query_text: `SELECT month_date, month, category, total, line_items
        FROM expense_breakdown ORDER BY month_date DESC, total DESC LIMIT 30`,
      }),
      supabase.rpc('execute_readonly_query', {
        query_text: `SELECT month_date, month, name, total_labor_cost, pay_entries
        FROM labor_by_team_member ORDER BY month_date DESC, total_labor_cost DESC LIMIT 30`,
      }),
    ]);

    // If rpc doesn't exist, fall back to direct view queries
    let pnlData, expenseData, laborData;

    if (pnlRes.error) {
      // Fall back to direct queries
      const [p, e, l] = await Promise.all([
        supabase.from('monthly_pnl').select('*').order('month_date', { ascending: false }).limit(6),
        supabase.from('expense_breakdown').select('*').order('month_date', { ascending: false }).limit(30),
        supabase.from('labor_by_team_member').select('*').order('month_date', { ascending: false }).limit(30),
      ]);

      if (p.error) {
        return NextResponse.json({ error: `monthly_pnl: ${p.error.message}` }, { status: 500 });
      }
      pnlData = p.data;
      expenseData = e.data ?? [];
      laborData = l.data ?? [];
    } else {
      pnlData = pnlRes.data;
      expenseData = expenseRes.data ?? [];
      laborData = laborRes.data ?? [];
    }

    // Sort P&L by month_date ascending for chronological display
    const pnl = (pnlData ?? [])
      .map((row: Record<string, unknown>) => ({
        monthDate: row.month_date as string,
        month: row.month as string,
        totalRevenue: Number(row.total_revenue) || 0,
        totalExpenses: Number(row.total_expenses) || 0,
        netProfit: Number(row.net_profit) || 0,
        profitMarginPct: Number(row.profit_margin_pct) || 0,
        laborCost: Number(row.labor_cost) || 0,
        softwareCost: Number(row.software_cost) || 0,
        processingFees: Number(row.processing_fees) || 0,
        marketingCost: Number(row.marketing_cost) || 0,
        advertisingCost: Number(row.advertising_cost) || 0,
        transactionCount: Number(row.transaction_count) || 0,
      }))
      .sort((a: { monthDate: string }, b: { monthDate: string }) =>
        a.monthDate.localeCompare(b.monthDate)
      );

    // Group expenses by month
    const expensesByMonth: Record<string, { category: string; total: number }[]> = {};
    for (const row of expenseData as Record<string, unknown>[]) {
      const key = row.month_date as string;
      if (!expensesByMonth[key]) expensesByMonth[key] = [];
      expensesByMonth[key].push({
        category: row.category as string,
        total: Number(row.total) || 0,
      });
    }

    // Group labor by month (top 5 per month)
    const laborByMonth: Record<string, { name: string; cost: number }[]> = {};
    for (const row of laborData as Record<string, unknown>[]) {
      const key = row.month_date as string;
      if (!laborByMonth[key]) laborByMonth[key] = [];
      if (laborByMonth[key].length < 5) {
        laborByMonth[key].push({
          name: row.name as string,
          cost: Number(row.total_labor_cost) || 0,
        });
      }
    }

    return NextResponse.json({ pnl, expensesByMonth, laborByMonth });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
